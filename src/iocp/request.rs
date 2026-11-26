use core::any::Any;
use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::c_void;
use core::marker::PhantomData;
use core::ptr;
use core::time::Duration;
use std::os::windows::io::{AsHandle as _, AsRawHandle as _, BorrowedHandle, OwnedHandle};
use std::rc::Rc;
use std::sync::Arc;

use bun_ptr::OptionCellExt as _;
use bun_sys::windows::StatusBlock;
use bun_sys::windows::system::physical_memory;
use bun_sys::{Fd, FdExt as _};
use bun_windows_sys::{HANDLE, NT_ERROR, NTSTATUS, ULONG, ntdll};

use crate::notifier::Notifier;
use crate::port::{Port, Shared, key};
use crate::slab::{Slab, Token};
use crate::sys::{self, Packet, Timeout};

/// An open file, closed when the last reference is dropped.
pub struct Handle {
    raw: usize,
    fd: Fd,
}

impl Handle {
    /// Takes ownership of `fd`, which must not be one of the standard streams.
    pub fn new(fd: Fd) -> Arc<Handle> {
        let raw = fd.native().expose_provenance();
        Arc::new(Handle { raw, fd })
    }

    pub fn from_owned(handle: OwnedHandle) -> Arc<Handle> {
        Handle::new(bun_sys::File::from(handle).into_raw())
    }

    pub fn raw(&self) -> HANDLE {
        ptr::with_exposed_provenance_mut(self.raw)
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        let _ = self.fd.close_allowing_standard_io(None);
    }
}

/// The result of a request on an [`OverlappedFile`].
pub struct Completion {
    pub status: NTSTATUS,
    pub transferred: usize,
    /// The buffer that was passed in, with any bytes read appended.
    pub buffer: Vec<u8>,
}

enum Callback {
    Io(Box<dyn FnOnce(Completion)>),
    Notify(Box<dyn FnOnce()>),
    Result(Box<dyn FnOnce(Box<dyn Any + Send>)>),
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum State {
    #[default]
    Ready,
    /// The kernel uses `status` and the buffer until the packet arrives.
    PendingIo,
    PendingSignal,
    PendingResult,
    Delayed,
}

#[derive(Default)]
struct Slot {
    status: StatusBlock,
    state: Cell<State>,
    callback: Cell<Option<Callback>>,
    /// `None` once the request is abandoned.
    file: Cell<Option<Arc<Handle>>>,
    buffer: Cell<Vec<u8>>,
    /// How much of the spare capacity of `buffer` the kernel may fill.
    read_capacity: Cell<usize>,
    shared_buffer: Cell<Option<Rc<dyn AsRef<[u8]>>>>,
    /// The kernel cancels such a write when the issuing thread exits, before it closes any file.
    is_thread_bound_write: Cell<bool>,
    is_hangup: Cell<bool>,
    event: OnceCell<OwnedHandle>,
    notifier: Notifier,
}

impl Slot {
    fn event(&self) -> Result<&OwnedHandle, NTSTATUS> {
        if let Some(event) = self.event.get() {
            return Ok(event);
        }
        let event = bun_sys::windows::CreateEventW();
        let event = event.map_err(|_| NTSTATUS::INSUFFICIENT_RESOURCES)?;
        Ok(self.event.get_or_init(|| event))
    }

    /// The kernel must be done with the request.
    fn take_completion(&self) -> Completion {
        let (status, information) = self.status.get();
        let transferred = if NT_ERROR(status) { 0 } else { information };
        let mut buffer = self.buffer.take();
        // SAFETY: the kernel initialized as many bytes as it reports, within the `read_capacity` that it was given.
        unsafe {
            bun_core::vec::commit_spare(&mut buffer, transferred.min(self.read_capacity.take()))
        };
        self.shared_buffer.take();
        self.file.take();
        Completion {
            status,
            transferred,
            buffer,
        }
    }
}

pub(crate) struct Requests {
    slab: RefCell<Slab<Slot>>,
    callback_count: Cell<usize>,
    /// Slots in `State::PendingIo` without a callback.
    abandoned_count: Cell<usize>,
}

impl Requests {
    pub(crate) const fn new() -> Requests {
        Requests {
            slab: RefCell::new(Slab::new()),
            callback_count: Cell::new(0),
            abandoned_count: Cell::new(0),
        }
    }

    pub(crate) fn callback_count(&self) -> usize {
        self.callback_count.get()
    }

    fn get(&self, token: Token) -> Option<Rc<Slot>> {
        self.slab.borrow().get(token).cloned()
    }

    fn take_callback(&self, slot: &Slot) -> Option<Callback> {
        slot.is_hangup.set(false);
        let callback = slot.callback.take()?;
        self.callback_count.update(|count| count - 1);
        Some(callback)
    }

    pub(crate) fn complete(&self, port: &Port, packet: Packet) {
        let Some(token) = Token::from_raw(packet.context) else {
            return;
        };
        let Some(slot) = self.get(token) else { return };
        let is_complete = match slot.state.get() {
            State::PendingIo => slot.status.get().0 != NTSTATUS::PENDING,
            State::PendingResult => false,
            State::Ready | State::PendingSignal | State::Delayed => packet.key != key::FILE,
        };
        if !is_complete {
            return;
        }
        let completion = slot.take_completion();
        let callback = self.take_callback(&slot);
        if callback.is_none() && slot.state.get() == State::PendingIo {
            self.abandoned_count.update(|count| count - 1);
        }
        self.slab.borrow_mut().release(token);
        match callback.filter(|_| !port.is_shutdown()) {
            Some(Callback::Io(done)) => done(completion),
            Some(Callback::Notify(done)) => done(),
            _ => {}
        }
    }

    /// Discards `result` if the request was dropped.
    pub(crate) fn complete_with_result(
        &self,
        port: &Port,
        token: Token,
        result: Box<dyn Any + Send>,
    ) {
        let slot = self.get(token);
        let Some(slot) = slot.filter(|slot| slot.state.get() == State::PendingResult) else {
            return;
        };
        let callback = self.take_callback(&slot);
        self.slab.borrow_mut().release(token);
        if let Some(Callback::Result(done)) = callback.filter(|_| !port.is_shutdown()) {
            done(result);
        }
    }

    /// Whether `packet` indicates that a writer may be gone.
    pub(crate) fn is_hangup(&self, packet: Packet) -> bool {
        let slot = Token::from_raw(packet.context).and_then(|token| self.get(token));
        slot.is_some_and(|slot| match (slot.state.get(), slot.status.get().0) {
            (State::PendingIo, NTSTATUS::CANCELLED) => false,
            (State::PendingIo, status) => NT_ERROR(status) && slot.file.is_some(),
            _ => slot.is_hangup.get(),
        })
    }

    fn abandon(&self, token: Token) {
        let Some(slot) = self.get(token) else { return };
        let Some(_callback) = self.take_callback(&slot) else {
            return;
        };
        match slot.state.get() {
            // Closing a handle does not cancel the I/O while another handle to the file is open.
            State::PendingIo => {
                self.abandoned_count.update(|count| count + 1);
                if let Some(file) = slot.file.take() {
                    sys::cancel_io(file.raw(), &slot.status);
                }
            }
            State::PendingSignal if !slot.notifier.try_cancel() => {}
            State::PendingSignal | State::PendingResult | State::Delayed | State::Ready => {
                let _unused = slot.take_completion();
                self.slab.borrow_mut().release(token);
            }
        }
    }

    pub(crate) fn abandon_all(&self) {
        let tokens: Vec<Token> = self.slab.borrow().iter().map(|(token, _)| token).collect();
        for token in tokens {
            self.abandon(token);
        }
    }

    pub(crate) fn has_abandoned(&self) -> bool {
        self.abandoned_count.get() > 0
    }

    pub(crate) fn thread_bound_write_count(&self) -> usize {
        let slab = self.slab.borrow();
        let pending_writes = slab.iter().filter(|(_, slot)| {
            slot.state.get() == State::PendingIo
                && slot.is_thread_bound_write.get()
                && slot.status.get().0 == NTSTATUS::PENDING
        });
        pending_writes.count()
    }

    #[cfg(test)]
    pub(crate) fn used_slot_count(&self) -> usize {
        self.slab.borrow().iter().count()
    }

    pub(crate) fn leak_in_flight(&self) {
        for (_, slot) in self.slab.borrow().iter() {
            if slot.state.get() == State::PendingIo {
                let _ = Rc::into_raw(Rc::clone(slot));
            }
        }
    }
}

/// Dropping it cancels the request, and its callback does not run.
#[must_use]
pub struct Request {
    port: Rc<Port>,
    token: Token,
}

impl Request {
    fn new(port: &Rc<Port>, token: Token, slot: &Slot, state: State, done: Callback) -> Request {
        slot.state.set(state);
        slot.callback.set(Some(done));
        port.requests.callback_count.update(|count| count + 1);
        let port = Rc::clone(port);
        Request { port, token }
    }

    /// Runs `done` from [`Port::dispatch`].
    pub fn defer(port: &Rc<Port>, done: impl FnOnce() + 'static) -> Request {
        Request::defer_with_key(port, key::REQUEST, done)
    }

    /// Like `defer`, for a `done` that reports data that was already read.
    pub fn defer_read_completion(port: &Rc<Port>, done: impl FnOnce() + 'static) -> Request {
        Request::defer_with_key(port, key::DEFERRED_READ, done)
    }

    /// Orders the callback after deferred reads, like that of failed I/O.
    pub fn mark_hangup(self) -> Request {
        if let Some(slot) = self.port.requests.get(self.token) {
            slot.is_hangup.set(true);
        }
        self
    }

    fn defer_with_key(port: &Rc<Port>, key: usize, done: impl FnOnce() + 'static) -> Request {
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        port.defer(Packet::new(key, token.to_raw()));
        let done = Callback::Notify(Box::new(done));
        Request::new(port, token, &slot, State::Ready, done)
    }

    /// Runs `done` once `delay` has elapsed.
    pub fn delay(port: &Rc<Port>, delay: Duration, done: impl FnOnce() + 'static) -> Request {
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        port.delay(key::REQUEST, token, delay.as_nanos() as u64);
        let done = Callback::Notify(Box::new(done));
        Request::new(port, token, &slot, State::Delayed, done)
    }

    /// Runs `done` once `target` is signaled. The handle does not have to stay open.
    pub fn wait(
        port: &Rc<Port>,
        target: BorrowedHandle<'_>,
        done: impl FnOnce() + 'static,
    ) -> Result<Request, NTSTATUS> {
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        if let Err(status) = slot.notifier.associate(&port.shared, target, token) {
            port.requests.slab.borrow_mut().release(token);
            return Err(status);
        }
        let done = Callback::Notify(Box::new(done));
        Ok(Request::new(port, token, &slot, State::PendingSignal, done))
    }

    /// Runs `done` with the result that another thread passes to the [`Completer`].
    pub fn with_completer<T: Send + 'static>(
        port: &Rc<Port>,
        done: impl FnOnce(T) + 'static,
    ) -> (Request, Completer<T>) {
        port.note_send();
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        let done = Callback::Result(Box::new(move |result: Box<dyn Any + Send>| {
            let result = result
                .downcast::<T>()
                .expect("only a Completer<T> has the token");
            done(*result);
        }));
        let completer = Completer {
            shared: Arc::clone(&port.shared),
            token,
            _result: PhantomData,
        };
        let request = Request::new(port, token, &slot, State::PendingResult, done);
        (request, completer)
    }

    /// For a read that completed synchronously. On `Ok` the callback does not run.
    pub fn take_sync_completion(self) -> Result<Completion, Request> {
        let requests = &self.port.requests;
        let slot = match requests.get(self.token) {
            Some(slot) if slot.state.get() == State::Ready && slot.file.is_some() => slot,
            _ => return Err(self),
        };
        let completion = slot.take_completion();
        let _callback = requests.take_callback(&slot);
        requests.slab.borrow_mut().release(self.token);
        self.port.pop_deferred_read(self.token);
        Ok(completion)
    }

    /// Only affects a read that has just completed synchronously.
    pub fn defer_to_next_iteration(&self) {
        if let Some(packet) = self.port.pop_deferred_read(self.token) {
            self.port.defer_to_next_iteration(packet);
        }
    }

    /// For a request that may have completed since the last dequeue. On `Ok` the callback does not run.
    pub fn try_take_completion(self) -> Result<Completion, Request> {
        let requests = &self.port.requests;
        let slot = match requests.get(self.token) {
            Some(slot) if slot.state.get() == State::PendingIo => slot,
            _ => return self.take_sync_completion(),
        };
        while slot.status.get().0 == NTSTATUS::PENDING {
            if !self.port.prefetch_packets(Timeout::Zero) {
                return Err(self);
            }
        }
        let completion = slot.take_completion();
        let _callback = requests.take_callback(&slot);
        slot.state.set(State::PendingSignal);
        if slot.notifier.try_cancel() {
            requests.slab.borrow_mut().release(self.token);
        }
        Ok(completion)
    }

    pub fn is_pending_io(&self) -> bool {
        let slot = self.port.requests.get(self.token);
        slot.is_some_and(|slot| slot.state.get() == State::PendingIo)
    }

    /// Asks the kernel to cancel pending file I/O. The callback runs either way.
    pub fn cancel(&self) {
        let Some(slot) = self.port.requests.get(self.token) else {
            return;
        };
        let file = slot.file.take();
        if slot.state.get() == State::PendingIo
            && let Some(file) = &file
        {
            sys::cancel_io(file.raw(), &slot.status);
        }
        slot.file.set(file);
    }
}

impl Drop for Request {
    fn drop(&mut self) {
        self.port.requests.abandon(self.token);
    }
}

/// Completes a [`Request::with_completer`], from any thread.
#[must_use]
pub struct Completer<T> {
    shared: Arc<Shared>,
    token: Token,
    _result: PhantomData<fn(T)>,
}

impl<T: Send + 'static> Completer<T> {
    pub fn complete(self, result: T) {
        self.shared.push_result(self.token, Box::new(result));
    }

    pub fn is_port_parked(&self) -> bool {
        self.shared.is_parked()
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum NotificationMethod {
    Undecided,
    /// A packet is queued only for a request that returned `STATUS_PENDING`.
    Port,
    Event,
}

const MAX_REQUEST_LEN: usize = i32::MAX as usize;
const CHUNK_LEN: usize = 8 * 1024 * 1024;

enum IoBuffer {
    Destination {
        buffer: Vec<u8>,
        max_len: usize,
    },
    Source {
        buffer: Vec<u8>,
        start: usize,
    },
    SharedSource {
        buffer: Rc<dyn AsRef<[u8]>>,
        start: usize,
    },
}

/// How to report a request that completes synchronously.
#[derive(Copy, Clone)]
enum SyncCompletion {
    Defer,
    DeferToNextIteration,
    /// Orders it after the packets that the request itself caused, and before any reply to it.
    Post,
    Return,
}

#[derive(Copy, Clone)]
enum Operation {
    Read,
    Write,
    Listen,
    WaitForInstance,
    ReadChanges { filter: u32, is_recursive: bool },
}

/// A file opened for overlapped I/O. `Err` is a request that failed to start, whose callback does not run.
pub struct OverlappedFile {
    port: Rc<Port>,
    handle: Arc<Handle>,
    notification_method: Cell<NotificationMethod>,
    max_write_len: Cell<usize>,
}

impl OverlappedFile {
    /// For a file that this process opened and does not share once it has issued a request.
    pub fn new_exclusive(port: &Rc<Port>, handle: Arc<Handle>) -> OverlappedFile {
        OverlappedFile::new(port, handle, NotificationMethod::Undecided)
    }

    /// For a file that others may have a handle to.
    pub fn new_shared(port: &Rc<Port>, handle: Arc<Handle>) -> OverlappedFile {
        OverlappedFile::new(port, handle, NotificationMethod::Event)
    }

    fn new(
        port: &Rc<Port>,
        handle: Arc<Handle>,
        notification_method: NotificationMethod,
    ) -> OverlappedFile {
        OverlappedFile {
            port: Rc::clone(port),
            handle,
            notification_method: Cell::new(notification_method),
            max_write_len: Cell::new(MAX_REQUEST_LEN),
        }
    }

    pub fn port(&self) -> &Rc<Port> {
        &self.port
    }

    pub fn handle(&self) -> &Arc<Handle> {
        &self.handle
    }

    /// Appends at most `max_len` bytes to `buffer`, within its capacity.
    pub fn read(
        &self,
        buffer: Vec<u8>,
        max_len: usize,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        self.submit(
            Operation::Read,
            IoBuffer::Destination { buffer, max_len },
            SyncCompletion::Defer,
            Box::new(done),
        )
    }

    /// Reads a chunk of `len` available bytes that are slow to process, so timers run before the last chunk's `done`.
    pub fn read_large(
        &self,
        len: usize,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        let sync_completion = if len > CHUNK_LEN {
            SyncCompletion::Defer
        } else {
            SyncCompletion::DeferToNextIteration
        };
        let buffer = IoBuffer::Destination {
            buffer: Vec::with_capacity(len.min(CHUNK_LEN)),
            max_len: len,
        };
        self.submit(Operation::Read, buffer, sync_completion, Box::new(done))
    }

    /// Writes some of `buffer[start..]`.
    pub fn write(
        &self,
        buffer: Vec<u8>,
        start: usize,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        self.submit(
            Operation::Write,
            IoBuffer::Source { buffer, start },
            SyncCompletion::Post,
            Box::new(done),
        )
    }

    /// Like `write`, but a write that completes synchronously is also returned as `Err`.
    pub fn try_write(
        &self,
        buffer: Vec<u8>,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        self.submit(
            Operation::Write,
            IoBuffer::Source { buffer, start: 0 },
            SyncCompletion::Return,
            Box::new(done),
        )
    }

    /// Writes some of `buffer[start..]`.
    pub fn write_shared(
        &self,
        buffer: Rc<dyn AsRef<[u8]>>,
        start: usize,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        self.submit(
            Operation::Write,
            IoBuffer::SharedSource { buffer, start },
            SyncCompletion::Post,
            Box::new(done),
        )
    }

    pub fn set_max_write_len(&self, max_len: usize) {
        self.max_write_len.set(max_len.min(MAX_REQUEST_LEN));
    }

    /// NPFS copies a pending write into nonpaged pool.
    fn clamp_write_len(&self, len: usize) -> usize {
        let len = len.min(self.max_write_len.get());
        if len <= CHUNK_LEN {
            return len;
        }
        let available = physical_memory().map_or(0, |memory| memory.available as usize);
        len.min((available / 4).max(CHUNK_LEN))
    }

    /// `ConnectNamedPipe`
    pub fn listen(&self, done: impl FnOnce(Completion) + 'static) -> Result<Request, Completion> {
        let buffer = IoBuffer::Destination {
            buffer: Vec::new(),
            max_len: 0,
        };
        self.submit(
            Operation::Listen,
            buffer,
            SyncCompletion::Defer,
            Box::new(done),
        )
    }

    /// `WaitNamedPipeW`, on the root of the named pipe file system. `buffer` is a `FILE_PIPE_WAIT_FOR_BUFFER`.
    pub fn wait_for_instance(
        &self,
        buffer: Vec<u8>,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        self.submit(
            Operation::WaitForInstance,
            IoBuffer::Source { buffer, start: 0 },
            SyncCompletion::Defer,
            Box::new(done),
        )
    }

    /// `ReadDirectoryChangesW`. Fills `buffer` like `read`.
    pub fn read_changes(
        &self,
        buffer: Vec<u8>,
        max_len: usize,
        filter: u32,
        is_recursive: bool,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        self.submit(
            Operation::ReadChanges {
                filter,
                is_recursive,
            },
            IoBuffer::Destination { buffer, max_len },
            SyncCompletion::Defer,
            Box::new(done),
        )
    }

    fn try_bind(&self) -> bool {
        if self.notification_method.get() == NotificationMethod::Undecided {
            let file = self.handle.raw();
            let modes = sys::FILE_SKIP_COMPLETION_PORT_ON_SUCCESS;
            let is_bound = sys::bind_file(&self.port.shared.handle, file, key::FILE)
                .and_then(|()| sys::set_notification_modes(file, modes))
                .is_ok();
            self.notification_method.set(if is_bound {
                NotificationMethod::Port
            } else {
                NotificationMethod::Event
            });
        }
        self.notification_method.get() == NotificationMethod::Port
    }

    fn submit(
        &self,
        operation: Operation,
        buffer: IoBuffer,
        sync_completion: SyncCompletion,
        done: Box<dyn FnOnce(Completion)>,
    ) -> Result<Request, Completion> {
        let port = &self.port;
        if let Operation::Write = operation {
            port.note_send();
        }
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        let (data, len) = match buffer {
            IoBuffer::Destination {
                mut buffer,
                max_len,
            } => {
                let spare = buffer.spare_capacity_mut();
                let data = spare.as_mut_ptr();
                let len = spare.len().min(max_len).min(MAX_REQUEST_LEN);
                slot.buffer.set(buffer);
                slot.read_capacity.set(len);
                (data.cast::<u8>(), len)
            }
            IoBuffer::Source { buffer, start } => {
                let data = buffer[start..].as_ptr();
                let len = buffer.len() - start;
                slot.buffer.set(buffer);
                (data.cast_mut(), self.clamp_write_len(len))
            }
            IoBuffer::SharedSource { buffer, start } => {
                let bytes = &(*buffer).as_ref()[start..];
                let data = bytes.as_ptr();
                let len = bytes.len();
                slot.shared_buffer.set(Some(buffer));
                (data.cast_mut(), self.clamp_write_len(len))
            }
        };
        let return_completion = || {
            let completion = slot.take_completion();
            port.requests.slab.borrow_mut().release(token);
            Err(completion)
        };
        let fail = |status| {
            slot.status.set(status, 0);
            return_completion()
        };

        if port.is_shutdown() {
            return fail(NTSTATUS::CANCELLED);
        }
        let event = if self.try_bind() {
            None
        } else {
            match slot.notifier.prepare().and_then(|_| slot.event()) {
                Ok(event) => Some(event),
                Err(status) => return fail(status),
            }
        };

        slot.status.set(NTSTATUS::PENDING, 0);
        let file = self.handle.raw();
        let status_block = slot.status.as_ptr();
        let null = ptr::null_mut();
        let (event_handle, apc_context) = match event {
            Some(event) => (event.as_raw_handle(), null),
            None => (null, ptr::without_provenance_mut(token.to_raw())),
        };
        let data = data.cast::<c_void>();
        let len = len as ULONG;
        // SAFETY: the slot owns the status block and the buffer, and keeps them until the request completes.
        let status = unsafe {
            match operation {
                Operation::Read => ntdll::NtReadFile(
                    file,
                    event_handle,
                    null,
                    apc_context,
                    status_block,
                    data,
                    len,
                    &0,
                    ptr::null(),
                ),
                Operation::Write => ntdll::NtWriteFile(
                    file,
                    event_handle,
                    null,
                    apc_context,
                    status_block,
                    data,
                    len,
                    &0,
                    ptr::null(),
                ),
                Operation::Listen => {
                    const FSCTL_PIPE_LISTEN: ULONG = 0x0011_0008;
                    ntdll::NtFsControlFile(
                        file,
                        event_handle,
                        null,
                        apc_context,
                        status_block,
                        FSCTL_PIPE_LISTEN,
                        null,
                        0,
                        null,
                        0,
                    )
                }
                Operation::WaitForInstance => {
                    const FSCTL_PIPE_WAIT: ULONG = 0x0011_0018;
                    ntdll::NtFsControlFile(
                        file,
                        event_handle,
                        null,
                        apc_context,
                        status_block,
                        FSCTL_PIPE_WAIT,
                        data,
                        len,
                        null,
                        0,
                    )
                }
                Operation::ReadChanges {
                    filter,
                    is_recursive,
                } => sys::NtNotifyChangeDirectoryFile(
                    file,
                    event_handle,
                    null,
                    apc_context,
                    status_block,
                    data,
                    len,
                    filter,
                    is_recursive.into(),
                ),
            }
        };
        if NT_ERROR(status) || status == NTSTATUS::DATATYPE_MISALIGNMENT {
            return fail(status);
        }

        let state = match event {
            _ if status != NTSTATUS::PENDING => State::Ready,
            None => State::PendingIo,
            Some(event) => {
                let target = event.as_handle();
                match slot.notifier.associate(&port.shared, target, token) {
                    Ok(()) => State::PendingIo,
                    Err(_) => {
                        sys::cancel_io(self.handle.raw(), &slot.status);
                        sys::wait_for_object(event);
                        State::Ready
                    }
                }
            }
        };
        if state == State::Ready {
            let key = match operation {
                Operation::Read => key::DEFERRED_READ,
                _ => key::REQUEST,
            };
            let packet = Packet::new(key, token.to_raw());
            match sync_completion {
                SyncCompletion::Defer => port.defer(packet),
                SyncCompletion::DeferToNextIteration => port.defer_to_next_iteration(packet),
                SyncCompletion::Post => port.post(packet),
                SyncCompletion::Return => return return_completion(),
            }
        }
        slot.file.set(Some(Arc::clone(&self.handle)));
        slot.is_thread_bound_write
            .set(event.is_some() && matches!(operation, Operation::Write));
        Ok(Request::new(port, token, &slot, state, Callback::Io(done)))
    }
}
