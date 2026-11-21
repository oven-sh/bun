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
use bun_sys::{Fd, FdExt as _};
use bun_windows_sys::{HANDLE, NT_ERROR, NTSTATUS, ULONG, ntdll};

use crate::notifier::Notifier;
use crate::port::{Port, Shared, key};
use crate::slab::{Slab, Token};
use crate::sys::{self, Packet, Timeout};

/// An open file. Whoever uses it last closes it.
pub struct Handle {
    raw: usize,
    fd: Fd,
}

impl Handle {
    /// Takes ownership of `fd`, which is not one of the standard streams.
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

/// The end of a request on an [`AsyncFile`].
pub struct Completion {
    pub status: NTSTATUS,
    pub transferred: usize,
    /// The one that was passed in, with what was read at its end.
    pub buffer: Vec<u8>,
}

pub(crate) type Outcome = Box<dyn Any + Send>;

enum Callback {
    Io(Box<dyn FnOnce(Completion)>),
    Signal(Box<dyn FnOnce()>),
    Outcome(Box<dyn FnOnce(Outcome)>),
}

/// What a request still waits for.
#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum Awaits {
    #[default]
    Dispatch,
    /// The system uses `status` and the bytes until the packet is here.
    Io,
    Signal,
    Outcome,
    Time,
}

#[derive(Default)]
struct Slot {
    status: StatusBlock,
    awaits: Cell<Awaits>,
    callback: Cell<Option<Callback>>,
    /// Until the request is abandoned.
    file: Cell<Option<Arc<Handle>>>,
    buffer: Cell<Vec<u8>>,
    /// How much of the spare capacity of `buffer` the system may fill.
    room: Cell<usize>,
    shared: Cell<Option<Rc<dyn AsRef<[u8]>>>>,
    outcome: Cell<Option<Outcome>>,
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

    /// For a request that the system is done with.
    fn take_completion(&self) -> Completion {
        let (status, information) = self.status.get();
        let transferred = if NT_ERROR(status) { 0 } else { information };
        let mut buffer = self.buffer.take();
        // SAFETY: the system wrote as many bytes as it reports to the `room` it was given.
        unsafe { bun_core::vec::commit_spare(&mut buffer, transferred.min(self.room.take())) };
        self.shared.take();
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
    callbacks: Cell<usize>,
}

impl Requests {
    pub(crate) const fn new() -> Requests {
        Requests {
            slab: RefCell::new(Slab::new()),
            callbacks: Cell::new(0),
        }
    }

    pub(crate) fn callback_count(&self) -> usize {
        self.callbacks.get()
    }

    fn get(&self, token: Token) -> Option<Rc<Slot>> {
        self.slab.borrow().get(token).cloned()
    }

    fn take_callback(&self, slot: &Slot) -> Option<Callback> {
        let callback = slot.callback.take()?;
        self.callbacks.update(|count| count - 1);
        Some(callback)
    }

    pub(crate) fn complete(&self, port: &Port, packet: Packet) {
        let Some(token) = Token::from_raw(packet.context) else {
            return;
        };
        let Some(slot) = self.get(token) else { return };
        let has_ended = match slot.awaits.get() {
            Awaits::Io => slot.status.get().0 != NTSTATUS::PENDING,
            Awaits::Outcome => false,
            Awaits::Dispatch | Awaits::Signal | Awaits::Time => packet.key == key::REQUEST,
        };
        if !has_ended {
            return;
        }
        let (completion, outcome) = (slot.take_completion(), slot.outcome.take());
        let callback = (self.take_callback(&slot)).filter(|_| !port.is_shut_down());
        self.slab.borrow_mut().release(token);
        match (callback, outcome) {
            (Some(Callback::Io(done)), _) => done(completion),
            (Some(Callback::Signal(done)), _) => done(),
            (Some(Callback::Outcome(done)), Some(outcome)) => done(outcome),
            _ => {}
        }
    }

    /// `false` if nobody waits for it any more.
    pub(crate) fn store(&self, token: Token, outcome: Outcome) -> bool {
        let slot = self.get(token);
        let Some(slot) = slot.filter(|slot| slot.awaits.get() == Awaits::Outcome) else {
            return false;
        };
        slot.outcome.set(Some(outcome));
        slot.awaits.set(Awaits::Dispatch);
        true
    }

    fn abandon(&self, token: Token) {
        let Some(slot) = self.get(token) else { return };
        let Some(_callback) = self.take_callback(&slot) else {
            return;
        };
        match slot.awaits.get() {
            // Closing the file is no cancellation while there is another handle to it.
            Awaits::Io => {
                if let Some(file) = slot.file.take() {
                    sys::cancel(file.raw(), &slot.status);
                }
            }
            Awaits::Signal if !slot.notifier.cancel() => {}
            Awaits::Signal | Awaits::Outcome | Awaits::Time | Awaits::Dispatch => {
                let _unused = (slot.take_completion(), slot.outcome.take());
                self.slab.borrow_mut().release(token);
            }
        }
    }

    pub(crate) fn abandon_all(&self) {
        let used: Vec<Token> = self.slab.borrow().used().map(|(token, _)| token).collect();
        for token in used {
            self.abandon(token);
        }
    }

    pub(crate) fn is_system_writing(&self) -> bool {
        (self.slab.borrow().used()).any(|(_, slot)| slot.awaits.get() == Awaits::Io)
    }

    #[cfg(test)]
    pub(crate) fn in_use(&self) -> usize {
        self.slab.borrow().used().count()
    }

    pub(crate) fn leak_in_flight(&self) {
        for (_, slot) in self.slab.borrow().used() {
            if slot.awaits.get() == Awaits::Io {
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
    fn new(port: &Rc<Port>, token: Token, slot: &Slot, awaits: Awaits, done: Callback) -> Request {
        slot.awaits.set(awaits);
        slot.callback.set(Some(done));
        port.requests.callbacks.update(|count| count + 1);
        let port = Rc::clone(port);
        Request { port, token }
    }

    /// Runs `done` in a later turn of the loop.
    pub fn defer(port: &Rc<Port>, done: impl FnOnce() + 'static) -> Request {
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        port.defer(Packet::new(key::REQUEST, token.to_raw()));
        let done = Callback::Signal(Box::new(done));
        Request::new(port, token, &slot, Awaits::Dispatch, done)
    }

    /// Runs `done` once `delay` is over.
    pub fn delay(port: &Rc<Port>, delay: Duration, done: impl FnOnce() + 'static) -> Request {
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        port.delay(key::REQUEST, token, delay.as_nanos() as u64);
        let done = Callback::Signal(Box::new(done));
        Request::new(port, token, &slot, Awaits::Time, done)
    }

    /// Runs `done` once `target` is signalled, which does not have to stay open.
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
        let done = Callback::Signal(Box::new(done));
        Ok(Request::new(port, token, &slot, Awaits::Signal, done))
    }

    /// Runs `done` with what another thread passes to the [`Remote`].
    pub fn remote<T: Send + 'static>(
        port: &Rc<Port>,
        done: impl FnOnce(T) + 'static,
    ) -> (Request, Remote<T>) {
        port.did_send();
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        let done = Callback::Outcome(Box::new(move |outcome: Outcome| {
            done(*outcome.downcast().expect("only a Remote<T> has the token"));
        }));
        let remote = Remote {
            port: Arc::clone(&port.shared),
            token,
            _outcome: PhantomData,
        };
        (
            Request::new(port, token, &slot, Awaits::Outcome, done),
            remote,
        )
    }

    /// In place of the callback, for a read that ended in the call that started it.
    pub fn take_immediate(self) -> Result<Completion, Request> {
        let requests = &self.port.requests;
        let slot = match requests.get(self.token) {
            Some(slot) if slot.awaits.get() == Awaits::Dispatch && slot.file.is_some() => slot,
            _ => return Err(self),
        };
        let (completion, _callback) = (slot.take_completion(), requests.take_callback(&slot));
        requests.slab.borrow_mut().release(self.token);
        self.port.take_back(self.token);
        Ok(completion)
    }

    /// Cancels a request on a pipe, and returns how it has ended in place of the callback.
    pub fn finish_now(self) -> Result<Completion, Request> {
        const MILLISECOND: Timeout = Timeout::After(10_000);
        let requests = &self.port.requests;
        let slot = match requests.get(self.token) {
            Some(slot) if slot.awaits.get() == Awaits::Io => slot,
            _ => return self.take_immediate(),
        };
        self.cancel();
        for _ in 0..1000 {
            if slot.status.get().0 != NTSTATUS::PENDING {
                let (completion, _done) = (slot.take_completion(), requests.take_callback(&slot));
                slot.awaits.set(Awaits::Signal);
                if slot.notifier.cancel() {
                    requests.slab.borrow_mut().release(self.token);
                }
                return Ok(completion);
            }
            self.port.fetch(MILLISECOND);
        }
        Err(self)
    }

    /// Asks the system to end a request on a file early. The callback runs either way.
    pub fn cancel(&self) {
        let Some(slot) = self.port.requests.get(self.token) else {
            return;
        };
        let file = slot.file.take();
        if let (Awaits::Io, Some(file)) = (slot.awaits.get(), &file) {
            sys::cancel(file.raw(), &slot.status);
        }
        slot.file.set(file);
    }
}

impl Drop for Request {
    fn drop(&mut self) {
        self.port.requests.abandon(self.token);
    }
}

/// Ends a [`Request::remote`], from any thread.
#[must_use]
pub struct Remote<T> {
    port: Arc<Shared>,
    token: Token,
    _outcome: PhantomData<fn(T)>,
}

impl<T: Send + 'static> Remote<T> {
    pub fn complete(self, outcome: T) {
        self.port.send(self.token, Box::new(outcome));
    }

    /// Whether the thread of the port has nothing to do but to wait.
    pub fn is_port_idle(&self) -> bool {
        self.port.is_parked()
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Delivery {
    NotBoundYet,
    /// A packet comes for a request that is pending when the call returns.
    Bound,
    Event,
}

/// Of one request. The system copies what a pipe has no room for into memory of its own.
pub const MAX_LEN: usize = 8 * 1024 * 1024;

/// The bytes that a request uses.
enum Bytes {
    Fill(Vec<u8>, usize),
    Drain(Vec<u8>, usize),
    DrainShared(Rc<dyn AsRef<[u8]>>, usize),
}

/// What becomes of a request that ends in the call that starts it.
#[derive(Copy, Clone)]
enum AtOnce {
    Defer,
    /// It takes its place between what it has caused here and what others do about it.
    Post,
    Return,
}

#[derive(Copy, Clone)]
enum Call {
    Read,
    Write,
    Listen,
    WaitForInstance,
    ReadChanges { filter: u32, is_recursive: bool },
}

/// A file that was opened for overlapped I/O. `Err` is a request that was refused, whose callback does not run.
pub struct AsyncFile {
    port: Rc<Port>,
    handle: Arc<Handle>,
    delivery: Cell<Delivery>,
}

impl AsyncFile {
    /// For a file that this process opened and keeps to itself once it has made a request.
    pub fn exclusive(port: &Rc<Port>, handle: Arc<Handle>) -> AsyncFile {
        AsyncFile::new(port, handle, Delivery::NotBoundYet)
    }

    /// For a file that others may have a handle to.
    pub fn shared(port: &Rc<Port>, handle: Arc<Handle>) -> AsyncFile {
        AsyncFile::new(port, handle, Delivery::Event)
    }

    fn new(port: &Rc<Port>, handle: Arc<Handle>, delivery: Delivery) -> AsyncFile {
        AsyncFile {
            port: Rc::clone(port),
            handle,
            delivery: Cell::new(delivery),
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
        let bytes = Bytes::Fill(buffer, max_len);
        self.submit(Call::Read, bytes, AtOnce::Defer, Box::new(done))
    }

    /// Writes some of `buffer[from..]`.
    pub fn write(
        &self,
        buffer: Vec<u8>,
        from: usize,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        let bytes = Bytes::Drain(buffer, from);
        self.submit(Call::Write, bytes, AtOnce::Post, Box::new(done))
    }

    /// `write`, but `Err` is also one that is done already.
    pub fn write_now(
        &self,
        buffer: Vec<u8>,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        let bytes = Bytes::Drain(buffer, 0);
        self.submit(Call::Write, bytes, AtOnce::Return, Box::new(done))
    }

    /// Writes some of `bytes[from..]`.
    pub fn write_shared(
        &self,
        bytes: Rc<dyn AsRef<[u8]>>,
        from: usize,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        let bytes = Bytes::DrainShared(bytes, from);
        self.submit(Call::Write, bytes, AtOnce::Post, Box::new(done))
    }

    /// `ConnectNamedPipe`
    pub fn listen(&self, done: impl FnOnce(Completion) + 'static) -> Result<Request, Completion> {
        let bytes = Bytes::Fill(Vec::new(), 0);
        self.submit(Call::Listen, bytes, AtOnce::Defer, Box::new(done))
    }

    /// `WaitNamedPipeW`, on the root of the file system of pipes. `request` is a `FILE_PIPE_WAIT_FOR_BUFFER`.
    pub fn wait_for_instance(
        &self,
        request: Vec<u8>,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        let bytes = Bytes::Drain(request, 0);
        self.submit(Call::WaitForInstance, bytes, AtOnce::Defer, Box::new(done))
    }

    /// `ReadDirectoryChangesW`, to `buffer` as in `read`.
    pub fn read_changes(
        &self,
        buffer: Vec<u8>,
        max_len: usize,
        filter: u32,
        is_recursive: bool,
        done: impl FnOnce(Completion) + 'static,
    ) -> Result<Request, Completion> {
        let bytes = Bytes::Fill(buffer, max_len);
        let call = Call::ReadChanges {
            filter,
            is_recursive,
        };
        self.submit(call, bytes, AtOnce::Defer, Box::new(done))
    }

    fn is_bound(&self) -> bool {
        if self.delivery.get() == Delivery::NotBoundYet {
            let (port, file) = (&self.port.shared.handle, self.handle.raw());
            let modes = sys::FILE_SKIP_COMPLETION_PORT_ON_SUCCESS;
            let is_bound = sys::bind(port, file, key::FILE)
                .and_then(|()| sys::set_notification_modes(file, modes))
                .is_ok();
            (self.delivery).set(if is_bound {
                Delivery::Bound
            } else {
                Delivery::Event
            });
        }
        self.delivery.get() == Delivery::Bound
    }

    fn submit(
        &self,
        call: Call,
        bytes: Bytes,
        at_once: AtOnce,
        done: Box<dyn FnOnce(Completion)>,
    ) -> Result<Request, Completion> {
        let port = &self.port;
        if let Call::Write = call {
            port.did_send();
        }
        let (token, slot) = port.requests.slab.borrow_mut().acquire();
        let (bytes, len) = match bytes {
            Bytes::Fill(mut buffer, max_len) => {
                let spare = buffer.spare_capacity_mut();
                let (bytes, len) = (spare.as_mut_ptr(), spare.len().min(max_len).min(MAX_LEN));
                slot.buffer.set(buffer);
                slot.room.set(len);
                (bytes.cast::<u8>(), len)
            }
            Bytes::Drain(buffer, from) => {
                let (bytes, len) = (buffer[from..].as_ptr(), buffer.len() - from);
                slot.buffer.set(buffer);
                (bytes.cast_mut(), len.min(MAX_LEN))
            }
            Bytes::DrainShared(shared, from) => {
                let rest = &(*shared).as_ref()[from..];
                let (bytes, len) = (rest.as_ptr(), rest.len());
                slot.shared.set(Some(shared));
                (bytes.cast_mut(), len.min(MAX_LEN))
            }
        };
        let give_back = || {
            let completion = slot.take_completion();
            port.requests.slab.borrow_mut().release(token);
            Err(completion)
        };
        let refuse = |status| {
            slot.status.set(status, 0);
            give_back()
        };

        if port.is_shut_down() {
            return refuse(NTSTATUS::CANCELLED);
        }
        let event = if self.is_bound() {
            None
        } else {
            match slot.notifier.prepare().and_then(|_| slot.event()) {
                Ok(event) => Some(event),
                Err(status) => return refuse(status),
            }
        };

        slot.status.set(NTSTATUS::PENDING, 0);
        let (file, io, null) = (self.handle.raw(), slot.status.as_ptr(), ptr::null_mut());
        let (signal, context) = match event {
            Some(event) => (event.as_raw_handle(), null),
            None => (null, ptr::without_provenance_mut(token.to_raw())),
        };
        let (bytes, len) = (bytes.cast::<c_void>(), len as ULONG);
        // SAFETY: the slot has the status block and the bytes, and keeps them until the request has ended.
        let status = unsafe {
            match call {
                Call::Read => {
                    ntdll::NtReadFile(file, signal, null, context, io, bytes, len, &0, ptr::null())
                }
                Call::Write => {
                    ntdll::NtWriteFile(file, signal, null, context, io, bytes, len, &0, ptr::null())
                }
                Call::Listen => {
                    const LISTEN: ULONG = 0x0011_0008;
                    ntdll::NtFsControlFile(
                        file, signal, null, context, io, LISTEN, null, 0, null, 0,
                    )
                }
                Call::WaitForInstance => {
                    const WAIT: ULONG = 0x0011_0018;
                    ntdll::NtFsControlFile(
                        file, signal, null, context, io, WAIT, bytes, len, null, 0,
                    )
                }
                Call::ReadChanges {
                    filter,
                    is_recursive,
                } => sys::NtNotifyChangeDirectoryFile(
                    file,
                    signal,
                    null,
                    context,
                    io,
                    bytes,
                    len,
                    filter,
                    is_recursive.into(),
                ),
            }
        };
        if NT_ERROR(status) || status == NTSTATUS::DATATYPE_MISALIGNMENT {
            return refuse(status);
        }

        let awaits = match event {
            _ if status != NTSTATUS::PENDING => Awaits::Dispatch,
            None => Awaits::Io,
            Some(event) => {
                match (slot.notifier).associate(&port.shared, event.as_handle(), token) {
                    Ok(()) => Awaits::Io,
                    Err(_) => {
                        sys::cancel(self.handle.raw(), &slot.status);
                        sys::wait_for(event);
                        Awaits::Dispatch
                    }
                }
            }
        };
        if awaits == Awaits::Dispatch {
            let packet = Packet::new(key::REQUEST, token.to_raw());
            match at_once {
                AtOnce::Defer => port.defer(packet),
                AtOnce::Post => port.post(packet),
                AtOnce::Return => return give_back(),
            }
        }
        slot.file.set(Some(Arc::clone(&self.handle)));
        Ok(Request::new(port, token, &slot, awaits, Callback::Io(done)))
    }
}
