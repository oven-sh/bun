//! Socket readiness through `IOCTL_AFD_POLL` requests to AFD, the driver behind Winsock.

use core::cell::{Cell, RefCell, UnsafeCell};
use core::ffi::c_void;
use core::ptr::{self, NonNull};
use std::os::windows::io::{AsRawHandle as _, OwnedHandle};
use std::rc::Rc;

use bun_core::time::{NS_PER_MS, NS_PER_S};
use bun_sys::windows::StatusBlock;
use bun_windows_sys::{HANDLE, NT_ERROR, NTSTATUS, ULONG, Win32Error};

use crate::port::{Event, Port, key, now_ns};
use crate::slab::{Slab, Token};
use crate::sys::{self, Packet};

bitflags::bitflags! {
    /// `AFD_POLL_*` events. All are level-triggered.
    #[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
    pub struct Readiness: u32 {
        const RECEIVE = 0x1;
        const SEND = 0x4;
        /// The peer shut down its send side. Received data may still be unread.
        const DISCONNECT = 0x8;
        const ABORT = 0x10;
        const ACCEPT = 0x80;
        const CONNECT_FAIL = 0x100;
        /// The poll request itself failed. Reported regardless of interest; the poll is retried after one second.
        const POLL_FAILED = 1 << 31;
    }
}

/// Reported regardless of interest when the last handle to the socket is closed.
const AFD_POLL_LOCAL_CLOSE: ULONG = 0x20;

const MAX_BACKOFF_NS: u64 = NS_PER_S;

/// `AFD_POLL_INFO` for one socket.
#[repr(C)]
#[derive(Copy, Clone, Default)]
struct AfdPollInfo {
    timeout: i64,
    handle_count: ULONG,
    is_exclusive: ULONG,
    socket: usize,
    events: ULONG,
    status: ULONG,
}

#[derive(Clone)]
pub enum ReadinessHandler {
    /// Passed to the caller of [`Port::dispatch`] in an [`Event::Socket`].
    UserData(NonNull<c_void>),
    Callback(Rc<dyn Fn(Readiness)>),
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum PollStatus {
    #[default]
    Idle,
    /// Holds the submitted interest until the result is dispatched.
    Pending(Readiness),
    /// Waiting for `key::POLL_RETRY`.
    Backoff,
}

#[derive(Default)]
struct PollRequest {
    status: StatusBlock,
    info: UnsafeCell<AfdPollInfo>,
    /// The kernel owns `status` and `info` until the completion packet is dequeued.
    is_in_flight: Cell<bool>,
}

impl PollRequest {
    fn result(&self) -> Option<(NTSTATUS, AfdPollInfo)> {
        if self.is_in_flight.get() {
            return None;
        }
        // SAFETY: the request is not in flight, so the kernel does not write `info`.
        Some((self.status.get().0, unsafe { self.info.get().read() }))
    }
}

/// Set in the packet context of `requests[1]`.
const SECOND_REQUEST_BIT: usize = Token::SPARE_BIT;

fn encode_context(token: Token, request_index: usize) -> usize {
    token.to_raw() | (request_index * SECOND_REQUEST_BIT)
}

/// AFD notifies only one of two concurrent polls on a socket, so each poll is exclusive and completes the previous one.
#[derive(Default)]
struct SocketState {
    requests: [PollRequest; 2],
    current_request: Cell<usize>,
    base_socket: Cell<usize>,
    poll_group: Cell<usize>,
    is_shared: Cell<bool>,
    interest: Cell<Readiness>,
    poll_status: Cell<PollStatus>,
    is_update_queued: Cell<bool>,
    last_backoff_ns: Cell<u64>,
    backoff_exponent: Cell<u32>,
    handler: RefCell<Option<ReadinessHandler>>,
}

impl SocketState {
    /// The delay before retrying a poll that completed without events or failed for lack of memory.
    fn next_backoff_ns(&self) -> u64 {
        const RESET_THRESHOLD_NS: u64 = 250 * NS_PER_MS;
        const MAX_EXPONENT: u32 = 6;
        let data_events = Readiness::RECEIVE | Readiness::SEND | Readiness::ACCEPT;
        if !self.interest.get().intersects(data_events) {
            return MAX_BACKOFF_NS;
        }
        let now = now_ns();
        let elapsed_ns = now.saturating_sub(self.last_backoff_ns.replace(now));
        let exponent = if elapsed_ns < RESET_THRESHOLD_NS {
            self.backoff_exponent.get()
        } else {
            0
        };
        self.backoff_exponent.set((exponent + 1).min(MAX_EXPONENT));
        (NS_PER_MS << exponent) / 2
    }
}

/// The time to cancel a poll grows with the number of polls on its AFD handle.
const MAX_POLL_GROUP_SIZE: usize = 32;

struct PollGroup {
    device: Option<OwnedHandle>,
    socket_count: usize,
}

struct PollGroups {
    groups: Vec<PollGroup>,
    /// Indices of the groups that are not full. Has capacity for every group, so `release` does not allocate.
    available: Vec<usize>,
}

impl PollGroups {
    fn acquire(&mut self, port: &OwnedHandle) -> Result<usize, Win32Error> {
        if self.available.is_empty() {
            self.groups.push(PollGroup {
                device: None,
                socket_count: 0,
            });
            self.available.reserve(self.groups.len());
            self.available.push(self.groups.len() - 1);
        }
        let index = self.available[self.available.len() - 1];
        let group = &mut self.groups[index];
        if group.device.is_none() {
            let device = sys::open_afd_device()?;
            sys::bind_file(port, device.as_raw_handle(), key::SOCKET)?;
            sys::set_notification_modes(
                device.as_raw_handle(),
                sys::FILE_SKIP_COMPLETION_PORT_ON_SUCCESS | sys::FILE_SKIP_SET_EVENT_ON_HANDLE,
            )?;
            group.device = Some(device);
        }
        group.socket_count += 1;
        if group.socket_count == MAX_POLL_GROUP_SIZE {
            self.available.pop();
        }
        Ok(index)
    }

    fn release(&mut self, index: usize) {
        let group = &mut self.groups[index];
        if group.socket_count == MAX_POLL_GROUP_SIZE {
            self.available.push(index);
        }
        group.socket_count -= 1;
        if group.socket_count == 0 && self.available.last() != Some(&index) {
            group.device = None;
        }
    }

    fn device(&self, index: usize) -> HANDLE {
        let device = self.groups[index].device.as_ref();
        device
            .expect("a non-empty poll group has an open device")
            .as_raw_handle()
    }
}

pub(crate) struct Sockets {
    slab: RefCell<Slab<SocketState>>,
    poll_groups: RefCell<PollGroups>,
    update_queue: RefCell<Vec<Token>>,
    callback_count: Cell<usize>,
}

impl Sockets {
    pub(crate) const fn new() -> Sockets {
        Sockets {
            slab: RefCell::new(Slab::new()),
            poll_groups: RefCell::new(PollGroups {
                groups: Vec::new(),
                available: Vec::new(),
            }),
            update_queue: RefCell::new(Vec::new()),
            callback_count: Cell::new(0),
        }
    }

    pub(crate) fn callback_count(&self) -> usize {
        self.callback_count.get()
    }

    /// After `submit_updates`, the only updates left are waiting for an already queued completion packet.
    pub(crate) fn has_queued_updates(&self) -> bool {
        !self.update_queue.borrow().is_empty()
    }

    fn get(&self, token: Token) -> Option<Rc<SocketState>> {
        self.slab.borrow().get(token).cloned()
    }

    fn queue_update(&self, token: Token, state: &SocketState) {
        if !state.is_update_queued.replace(true) {
            self.update_queue.borrow_mut().push(token);
        }
    }

    fn find_request(&self, context: usize) -> Option<(Token, Rc<SocketState>, usize)> {
        let token = Token::from_raw(context & !SECOND_REQUEST_BIT)?;
        Some((
            token,
            self.get(token)?,
            usize::from(context & SECOND_REQUEST_BIT != 0),
        ))
    }

    fn maybe_release(&self, token: Token, state: &SocketState) {
        if !state.requests.iter().any(|req| req.is_in_flight.get()) {
            state.poll_status.set(PollStatus::Idle);
            self.poll_groups
                .borrow_mut()
                .release(state.poll_group.get());
            self.slab.borrow_mut().release(token);
        }
    }

    fn submit_poll(&self, token: Token, state: &SocketState, index: usize) {
        const IOCTL_AFD_POLL: ULONG = 0x0001_2024;
        const INFO_SIZE: ULONG = size_of::<AfdPollInfo>() as ULONG;

        let request = &state.requests[index];
        let interest = state.interest.get();
        let info = request.info.get();
        assert!(!request.is_in_flight.get());
        request.status.set(NTSTATUS::PENDING, 0);
        // SAFETY: the request is not in flight, and its slot stays allocated until the completion packet is dequeued.
        let status = unsafe {
            info.write(AfdPollInfo {
                timeout: i64::MAX,
                handle_count: 1,
                is_exclusive: (!state.is_shared.get()).into(),
                socket: state.base_socket.get(),
                events: interest.bits(),
                status: 0,
            });
            sys::NtDeviceIoControlFile(
                self.poll_groups.borrow().device(state.poll_group.get()),
                ptr::null_mut(),
                ptr::null_mut(),
                encode_context(token, index),
                request.status.as_ptr(),
                IOCTL_AFD_POLL,
                info.cast(),
                INFO_SIZE,
                info.cast(),
                INFO_SIZE,
            )
        };
        state.current_request.set(index);
        state.poll_status.set(PollStatus::Pending(interest));
        request.is_in_flight.set(status == NTSTATUS::PENDING);
        if status != NTSTATUS::PENDING {
            request.status.set(status, 0);
        }
    }

    fn cancel_poll(&self, state: &SocketState, request: &PollRequest) {
        sys::cancel_io(
            self.poll_groups.borrow().device(state.poll_group.get()),
            &request.status,
        );
    }

    /// Returns `false` if the request it needs is still in flight; retry once its packet is dequeued.
    fn try_update_poll(&self, port: &Port, token: Token, state: &SocketState) -> bool {
        let (pending_events, index) = match state.poll_status.get() {
            PollStatus::Pending(events) => (events, 1 - state.current_request.get()),
            PollStatus::Idle | PollStatus::Backoff => {
                (Readiness::empty(), state.current_request.get())
            }
        };
        if pending_events.contains(state.interest.get()) {
            return true;
        }
        let request = &state.requests[index];
        let previous = &state.requests[1 - index];
        if request.is_in_flight.get() {
            self.cancel_poll(state, request);
            return false;
        }
        // A new exclusive poll completes only the first pending poll that AFD finds.
        if previous.is_in_flight.get() {
            self.cancel_poll(state, previous);
        }
        self.submit_poll(token, state, index);
        let packet = Packet::new(key::SOCKET, encode_context(token, index));
        match request
            .result()
            .map(|(_, info)| Readiness::from_bits_truncate(info.events))
        {
            None => {}
            // In this iteration: after a write to a closed peer, `recv` no longer reports the graceful close.
            Some(ready) if ready.contains(Readiness::DISCONNECT) => port.defer(packet),
            // Before the next batch: the data may stop a sender, and `send` accepts any amount once buffer space is free.
            Some(ready) if ready.contains(Readiness::RECEIVE) => {
                port.defer_to_next_iteration(packet)
            }
            Some(_) => port.post(packet),
        }
        true
    }

    pub(crate) fn submit_updates(&self, port: &Port) {
        self.update_queue.borrow_mut().retain(|&token| {
            let Some(state) = self.get(token) else {
                return false;
            };
            let is_blocked = !self.try_update_poll(port, token, &state);
            state.is_update_queued.set(is_blocked);
            is_blocked
        });
    }

    /// Records a dequeued packet without allocating or freeing. Returns `false` if there is nothing to `complete`.
    pub(crate) fn accept_packet(&self, context: usize) -> bool {
        let Some((token, state, index)) = self.find_request(context) else {
            return false;
        };
        let request = &state.requests[index];
        if request.status.get().0 == NTSTATUS::PENDING {
            return false;
        }
        request.is_in_flight.set(false);
        if state.handler.borrow().is_none() {
            self.maybe_release(token, &state);
            return false;
        }
        index == state.current_request.get()
    }

    pub(crate) fn complete(&self, port: &Port, context: usize, on_event: &impl Fn(Event)) {
        let Some((token, state, index)) = self.find_request(context) else {
            return;
        };
        // The socket may have been polled again since the packet was queued.
        if index != state.current_request.get()
            || !matches!(state.poll_status.get(), PollStatus::Pending(_))
        {
            return;
        }
        let Some((status, info)) = state.requests[index].result() else {
            return;
        };
        let Some(handler) = state.handler.borrow().clone() else {
            return;
        };
        state.poll_status.set(PollStatus::Idle);
        if info.handle_count == 0
            || matches!(
                status,
                NTSTATUS::CANCELLED | NTSTATUS::INSUFFICIENT_RESOURCES | NTSTATUS::NO_MEMORY
            )
        {
            state.poll_status.set(PollStatus::Backoff);
            port.delay(key::POLL_RETRY, token, state.next_backoff_ns());
            return;
        }
        let ready = if NT_ERROR(status) {
            state.poll_status.set(PollStatus::Backoff);
            port.delay(key::POLL_RETRY, token, MAX_BACKOFF_NS);
            Readiness::POLL_FAILED
        } else {
            if info.events & AFD_POLL_LOCAL_CLOSE != 0 {
                state.interest.take();
            }
            self.queue_update(token, &state);
            Readiness::from_bits_truncate(info.events) & state.interest.get()
        };
        if ready.is_empty() {
            return;
        }
        match handler {
            ReadinessHandler::UserData(user_data) => on_event(Event::Socket(user_data, ready)),
            ReadinessHandler::Callback(callback) => callback(ready),
        }
    }

    pub(crate) fn retry_poll(&self, context: usize) {
        if let Some(token) = Token::from_raw(context)
            && let Some(state) = self.get(token)
            && state.poll_status.get() == PollStatus::Backoff
        {
            self.queue_update(token, &state);
        }
    }

    fn deregister(&self, token: Token) {
        let Some(state) = self.get(token) else { return };
        let Some(handler) = state.handler.take() else {
            return;
        };
        if let ReadinessHandler::Callback(_) = handler {
            self.callback_count.update(|count| count - 1);
        }
        state.interest.take();
        for request in state.requests.iter().filter(|req| req.is_in_flight.get()) {
            self.cancel_poll(&state, request);
        }
        self.maybe_release(token, &state);
    }

    pub(crate) fn deregister_all(&self) {
        let tokens: Vec<Token> = self.slab.borrow().iter().map(|(token, _)| token).collect();
        for token in tokens {
            self.deregister(token);
        }
    }

    /// Valid only once every socket is deregistered.
    pub(crate) fn has_polls_in_flight(&self) -> bool {
        self.slab.borrow().iter().next().is_some()
    }

    pub(crate) fn leak_in_flight(&self) {
        for (_, state) in self.slab.borrow().iter() {
            let _ = Rc::into_raw(Rc::clone(state));
        }
    }
}

/// Reports a socket's readiness until dropped. Dropping it does not use the socket handle.
pub struct SocketRegistration {
    port: Rc<Port>,
    token: Token,
}

impl SocketRegistration {
    pub fn new(
        port: &Rc<Port>,
        socket: usize,
        handler: ReadinessHandler,
    ) -> Result<SocketRegistration, Win32Error> {
        if port.is_shutdown() {
            return Err(Win32Error::OPERATION_ABORTED);
        }
        let sockets = &port.sockets;
        let base_socket = sys::find_base_socket(socket)?;
        let poll_group = sockets
            .poll_groups
            .borrow_mut()
            .acquire(&port.shared.handle)?;
        let (token, state) = sockets.slab.borrow_mut().acquire();
        if let ReadinessHandler::Callback(_) = handler {
            sockets.callback_count.update(|count| count + 1);
        }
        state.base_socket.set(base_socket);
        state.poll_group.set(poll_group);
        state.is_shared.set(false);
        state.interest.take();
        state.is_update_queued.set(false);
        state.handler.replace(Some(handler));
        let port = Rc::clone(port);
        Ok(SocketRegistration { port, token })
    }

    pub fn set_interest(&self, interest: Readiness) {
        let sockets = &self.port.sockets;
        if let Some(state) = sockets.get(self.token)
            && state.handler.borrow().is_some()
            && !state.interest.replace(interest).contains(interest)
        {
            sockets.queue_update(self.token, &state);
        }
    }

    /// Stops this and other holders of the socket from completing each other's polls.
    pub fn set_shared(&self) {
        if let Some(state) = self.port.sockets.get(self.token) {
            state.is_shared.set(true);
        }
    }

    /// Affects only a [`ReadinessHandler::UserData`] registration.
    pub fn set_user_data(&self, user_data: NonNull<c_void>) {
        if let Some(state) = self.port.sockets.get(self.token)
            && let Some(ReadinessHandler::UserData(current)) = &mut *state.handler.borrow_mut()
        {
            *current = user_data;
        }
    }
}

impl Drop for SocketRegistration {
    fn drop(&mut self) {
        self.port.sockets.deregister(self.token);
    }
}
