//! Readiness of sockets, from the driver behind Winsock.

use core::cell::{Cell, RefCell, UnsafeCell};
use core::ffi::c_void;
use core::ptr::{self, NonNull};
use std::os::windows::io::{AsRawHandle as _, OwnedHandle};
use std::rc::Rc;

use bun_sys::windows::StatusBlock;
use bun_windows_sys::{HANDLE, NT_ERROR, NTSTATUS, ULONG, Win32Error};

use crate::port::{Event, Port, key, now_ns};
use crate::slab::{Slab, Token};
use crate::sys::{self, Packet};

bitflags::bitflags! {
    /// All of them are reported for as long as they hold.
    #[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
    pub struct Readiness: u32 {
        const RECEIVE = 0x1;
        const SEND = 0x4;
        /// The peer will send no more. What it has sent may still be unread.
        const DISCONNECT = 0x8;
        const ABORT = 0x10;
        const ACCEPT = 0x80;
        const CONNECT_FAIL = 0x100;
        /// The socket cannot be watched. It is reported unasked, and tried again after a second.
        const WATCH_FAILED = 1 << 31;
    }
}

/// Reported unasked when the last handle to the socket is closed.
const LOCAL_CLOSE: ULONG = 0x20;

/// `AFD_POLL_INFO` for one socket.
#[repr(C)]
#[derive(Copy, Clone, Default)]
struct PollInfo {
    timeout: i64,
    count: ULONG,
    is_exclusive: ULONG,
    socket: usize,
    events: ULONG,
    status: ULONG,
}

#[derive(Clone)]
pub enum Watcher {
    /// Handed to the caller of [`Port::dispatch`].
    Foreign(NonNull<c_void>),
    Callback(Rc<dyn Fn(Readiness)>),
}

#[derive(Copy, Clone, PartialEq, Eq, Default)]
enum State {
    #[default]
    Idle,
    /// Until the result is dispatched.
    Polling(Readiness),
    /// Until `key::POLL_AGAIN`.
    Resting,
}

#[derive(Default)]
struct Attempt {
    status: StatusBlock,
    info: UnsafeCell<PollInfo>,
    /// The system uses the other two until the packet is here.
    is_in_flight: Cell<bool>,
}

impl Attempt {
    fn result(&self) -> Option<(NTSTATUS, PollInfo)> {
        // SAFETY: the system is not using it.
        (!self.is_in_flight.get()).then(|| (self.status.get().0, unsafe { self.info.get().read() }))
    }
}

/// Set in the context of a packet for `attempts[1]`.
const SECOND_ATTEMPT: usize = Token::SPARE_BIT;

fn context(token: Token, attempt: usize) -> usize {
    token.to_raw() | (attempt * SECOND_ATTEMPT)
}

/// Of two polls of one socket only one hears of events. So they are exclusive: a newer one ends the one before.
#[derive(Default)]
struct Poll {
    attempts: [Attempt; 2],
    current: Cell<usize>,
    socket: Cell<usize>,
    group: Cell<usize>,
    interest: Cell<Readiness>,
    state: Cell<State>,
    is_changed: Cell<bool>,
    rested_at_ns: Cell<u64>,
    times_rested: Cell<u32>,
    watcher: RefCell<Option<Watcher>>,
}

impl Poll {
    /// After a poll that has ended with nothing to report, or that there was no memory for.
    fn rest_ns(&self) -> u64 {
        const MS: u64 = 1_000_000;
        let transfer = Readiness::RECEIVE | Readiness::SEND | Readiness::ACCEPT;
        if !self.interest.get().intersects(transfer) {
            return 1000 * MS;
        }
        let now = now_ns();
        let is_recurring = now.saturating_sub(self.rested_at_ns.replace(now)) < 250 * MS;
        let times = if is_recurring {
            self.times_rested.get()
        } else {
            0
        };
        self.times_rested.set((times + 1).min(6));
        (MS << times) / 2
    }
}

/// The time to cancel a poll grows with the number of polls on its handle.
const GROUP_SIZE: usize = 32;

struct Group {
    device: Option<OwnedHandle>,
    members: usize,
}

struct Groups {
    all: Vec<Group>,
    /// Has capacity for all of them, so that `leave` does not allocate.
    with_room: Vec<usize>,
}

impl Groups {
    fn join(&mut self, port: &OwnedHandle) -> Result<usize, Win32Error> {
        if self.with_room.is_empty() {
            self.all.push(Group {
                device: None,
                members: 0,
            });
            self.with_room.reserve(self.all.len());
            self.with_room.push(self.all.len() - 1);
        }
        let index = self.with_room[self.with_room.len() - 1];
        let group = &mut self.all[index];
        if group.device.is_none() {
            let device = sys::open_afd_device()?;
            sys::bind(port, device.as_raw_handle(), key::SOCKET)?;
            sys::set_notification_modes(
                device.as_raw_handle(),
                sys::FILE_SKIP_COMPLETION_PORT_ON_SUCCESS | sys::FILE_SKIP_SET_EVENT_ON_HANDLE,
            )?;
            group.device = Some(device);
        }
        group.members += 1;
        if group.members == GROUP_SIZE {
            self.with_room.pop();
        }
        Ok(index)
    }

    fn leave(&mut self, index: usize) {
        let group = &mut self.all[index];
        if group.members == GROUP_SIZE {
            self.with_room.push(index);
        }
        group.members -= 1;
        if group.members == 0 && self.with_room.last() != Some(&index) {
            group.device = None;
        }
    }

    fn device(&self, index: usize) -> HANDLE {
        let device = self.all[index].device.as_ref();
        device
            .expect("a group with members is open")
            .as_raw_handle()
    }
}

pub(crate) struct Sockets {
    slab: RefCell<Slab<Poll>>,
    groups: RefCell<Groups>,
    changed: RefCell<Vec<Token>>,
    callbacks: Cell<usize>,
}

impl Sockets {
    pub(crate) const fn new() -> Sockets {
        Sockets {
            slab: RefCell::new(Slab::new()),
            groups: RefCell::new(Groups {
                all: Vec::new(),
                with_room: Vec::new(),
            }),
            changed: RefCell::new(Vec::new()),
            callbacks: Cell::new(0),
        }
    }

    pub(crate) fn callback_count(&self) -> usize {
        self.callbacks.get()
    }

    /// After `submit_changed`: whether one has to wait for a packet that is queued.
    pub(crate) fn has_changed(&self) -> bool {
        !self.changed.borrow().is_empty()
    }

    fn get(&self, token: Token) -> Option<Rc<Poll>> {
        self.slab.borrow().get(token).cloned()
    }

    fn mark_changed(&self, token: Token, poll: &Poll) {
        if !poll.is_changed.replace(true) {
            self.changed.borrow_mut().push(token);
        }
    }

    fn find(&self, context: usize) -> Option<(Token, Rc<Poll>, usize)> {
        let token = Token::from_raw(context & !SECOND_ATTEMPT)?;
        Some((
            token,
            self.get(token)?,
            usize::from(context & SECOND_ATTEMPT != 0),
        ))
    }

    fn release_unless_in_flight(&self, token: Token, poll: &Poll) {
        if !poll.attempts.iter().any(|it| it.is_in_flight.get()) {
            poll.state.set(State::Idle);
            self.groups.borrow_mut().leave(poll.group.get());
            self.slab.borrow_mut().release(token);
        }
    }

    fn submit(&self, token: Token, poll: &Poll, index: usize) {
        const IOCTL_AFD_POLL: ULONG = 0x0001_2024;
        const SIZE: ULONG = size_of::<PollInfo>() as ULONG;

        let (attempt, interest) = (&poll.attempts[index], poll.interest.get());
        let info = attempt.info.get();
        assert!(!attempt.is_in_flight.get());
        attempt.status.set(NTSTATUS::PENDING, 0);
        // SAFETY: the system is not using the attempt, and the slot stays until its packet is here.
        let status = unsafe {
            info.write(PollInfo {
                timeout: i64::MAX,
                count: 1,
                is_exclusive: 1,
                socket: poll.socket.get(),
                events: interest.bits(),
                status: 0,
            });
            sys::NtDeviceIoControlFile(
                self.groups.borrow().device(poll.group.get()),
                ptr::null_mut(),
                ptr::null_mut(),
                context(token, index),
                attempt.status.as_ptr(),
                IOCTL_AFD_POLL,
                info.cast(),
                SIZE,
                info.cast(),
                SIZE,
            )
        };
        poll.current.set(index);
        poll.state.set(State::Polling(interest));
        attempt.is_in_flight.set(status == NTSTATUS::PENDING);
        if status != NTSTATUS::PENDING {
            attempt.status.set(status, 0);
        }
    }

    fn cancel(&self, poll: &Poll, attempt: &Attempt) {
        sys::cancel(
            self.groups.borrow().device(poll.group.get()),
            &attempt.status,
        );
    }

    /// `false` if it has to wait for a packet that is queued.
    fn submit_interest(&self, port: &Port, token: Token, poll: &Poll) -> bool {
        let (asked, index) = match poll.state.get() {
            State::Polling(asked) => (asked, 1 - poll.current.get()),
            State::Idle | State::Resting => (Readiness::empty(), poll.current.get()),
        };
        if asked.contains(poll.interest.get()) {
            return true;
        }
        let (attempt, older) = (&poll.attempts[index], &poll.attempts[1 - index]);
        if attempt.is_in_flight.get() {
            self.cancel(poll, attempt);
            return false;
        }
        // A newer one only ends the first that it finds.
        if older.is_in_flight.get() {
            self.cancel(poll, older);
        }
        self.submit(token, poll, index);
        let packet = Packet::new(key::SOCKET, context(token, index));
        match attempt
            .result()
            .map(|(_, info)| Readiness::from_bits_truncate(info.events))
        {
            None => {}
            // Once we have written to a peer that is gone, `recv` does not tell any more that it left in good order.
            Some(ready) if ready.contains(Readiness::DISCONNECT) => port.defer(packet),
            // It may be a reason to send no more, and `send` takes any amount once another socket has made some room.
            Some(ready) if ready.contains(Readiness::RECEIVE) => port.defer_to_next_turn(packet),
            Some(_) => port.post(packet),
        }
        true
    }

    pub(crate) fn submit_changed(&self, port: &Port) {
        self.changed.borrow_mut().retain(|&token| {
            let Some(poll) = self.get(token) else {
                return false;
            };
            poll.is_changed
                .set(!self.submit_interest(port, token, &poll));
            poll.is_changed.get()
        });
    }

    /// For a packet from the system. `false` if there is nothing to `complete`. It neither allocates nor frees.
    pub(crate) fn receive(&self, context: usize) -> bool {
        let Some((token, poll, index)) = self.find(context) else {
            return false;
        };
        let attempt = &poll.attempts[index];
        if attempt.status.get().0 == NTSTATUS::PENDING {
            return false;
        }
        attempt.is_in_flight.set(false);
        if poll.watcher.borrow().is_none() {
            self.release_unless_in_flight(token, &poll);
            return false;
        }
        index == poll.current.get()
    }

    pub(crate) fn complete(&self, port: &Port, context: usize, on_event: &impl Fn(Event)) {
        let Some((token, poll, index)) = self.find(context) else {
            return;
        };
        // It may have been polled again since.
        let (true, State::Polling(_), Some((status, info)), Some(watcher)) = (
            index == poll.current.get(),
            poll.state.get(),
            poll.attempts[index].result(),
            poll.watcher.borrow().clone(),
        ) else {
            return;
        };
        poll.state.set(State::Idle);
        let ready = if info.count == 0
            || matches!(
                status,
                NTSTATUS::CANCELLED | NTSTATUS::INSUFFICIENT_RESOURCES | NTSTATUS::NO_MEMORY
            ) {
            poll.state.set(State::Resting);
            return port.delay(key::POLL_AGAIN, token, poll.rest_ns());
        } else if NT_ERROR(status) {
            const SECOND_NS: u64 = 1_000_000_000;
            poll.state.set(State::Resting);
            port.delay(key::POLL_AGAIN, token, SECOND_NS);
            Readiness::WATCH_FAILED
        } else {
            if info.events & LOCAL_CLOSE != 0 {
                poll.interest.take();
            }
            self.mark_changed(token, &poll);
            Readiness::from_bits_truncate(info.events) & poll.interest.get()
        };
        if ready.is_empty() {
            return;
        }
        match watcher {
            Watcher::Foreign(address) => on_event(Event::Socket(address, ready)),
            Watcher::Callback(callback) => callback(ready),
        }
    }

    pub(crate) fn poll_again(&self, context: usize) {
        if let Some(token) = Token::from_raw(context)
            && let Some(poll) = self.get(token)
            && poll.state.get() == State::Resting
        {
            self.mark_changed(token, &poll);
        }
    }

    fn abandon(&self, token: Token) {
        let Some(poll) = self.get(token) else { return };
        let Some(watcher) = poll.watcher.take() else {
            return;
        };
        if let Watcher::Callback(_) = watcher {
            self.callbacks.update(|count| count - 1);
        }
        poll.interest.take();
        for attempt in poll.attempts.iter().filter(|it| it.is_in_flight.get()) {
            self.cancel(&poll, attempt);
        }
        self.release_unless_in_flight(token, &poll);
    }

    pub(crate) fn abandon_all(&self) {
        let used: Vec<Token> = self.slab.borrow().used().map(|(token, _)| token).collect();
        for token in used {
            self.abandon(token);
        }
    }

    /// After `abandon_all`.
    pub(crate) fn is_system_writing(&self) -> bool {
        self.slab.borrow().used().next().is_some()
    }

    pub(crate) fn leak_in_flight(&self) {
        for (_, poll) in self.slab.borrow().used() {
            let _ = Rc::into_raw(Rc::clone(poll));
        }
    }
}

/// Reports the readiness of a socket until it is dropped, which does not touch the socket.
pub struct SocketWatch {
    port: Rc<Port>,
    token: Token,
}

impl SocketWatch {
    pub fn new(
        port: &Rc<Port>,
        socket: usize,
        watcher: Watcher,
    ) -> Result<SocketWatch, Win32Error> {
        if port.is_shut_down() {
            return Err(Win32Error::OPERATION_ABORTED);
        }
        let sockets = &port.sockets;
        let socket = sys::base_socket(socket)?;
        let group = (sockets.groups.borrow_mut()).join(&port.shared.handle)?;
        let (token, poll) = sockets.slab.borrow_mut().acquire();
        if let Watcher::Callback(_) = watcher {
            sockets.callbacks.update(|count| count + 1);
        }
        poll.socket.set(socket);
        poll.group.set(group);
        poll.interest.take();
        poll.is_changed.set(false);
        poll.watcher.replace(Some(watcher));
        let port = Rc::clone(port);
        Ok(SocketWatch { port, token })
    }

    pub fn set_interest(&self, interest: Readiness) {
        let sockets = &self.port.sockets;
        if let Some(poll) = sockets.get(self.token)
            && poll.watcher.borrow().is_some()
            && !poll.interest.replace(interest).contains(interest)
        {
            sockets.mark_changed(self.token, &poll);
        }
    }

    /// For a [`Watcher::Foreign`] that has moved.
    pub fn set_address(&self, address: NonNull<c_void>) {
        if let Some(poll) = self.port.sockets.get(self.token)
            && let Some(Watcher::Foreign(old)) = &mut *poll.watcher.borrow_mut()
        {
            *old = address;
        }
    }
}

impl Drop for SocketWatch {
    fn drop(&mut self) {
        self.port.sockets.abandon(self.token);
    }
}
