//! What the HTTP/3 server and client have in common.

use core::cell::{Cell, RefCell, RefMut};
use core::ffi::c_int;
use core::net::{Ipv4Addr, SocketAddr};
use std::rc::{Rc, Weak};

use bun_core::ZStr;
use bun_ptr::BackRef;
use bun_quic::http3::{Fields, Header};
use bun_quic::{
    Addresses, Context, Direction, Duration, Endpoint, Event, Handle, Incoming, Instant,
    StreamEvent, StreamId, Unrouted, Version,
};
use bun_quic_tls::BoringSsl;

use super::drivers::{Driver, Order, Registration};
use super::io::{self, Binding, Outbox, now};
use crate::{Loop, udp};

/// After which the rest of the loop gets its turn.
const MAX_ROUNDS: usize = 16;
const MAX_PASS_TIME: Duration = Duration::from_millis(4);

unsafe extern "C" {
    safe fn us_internal_enable_sweep_timer(loop_: &Loop);
    safe fn us_internal_disable_sweep_timer(loop_: &Loop);
}

pub(super) trait Application: Driver {
    fn engine(&self) -> &Engine;
    fn on_incoming(&self, now: Instant, incoming: Incoming<'_>);
    fn on_event(&self, connection: Connection, context: Context, event: Event);
    /// For what cannot be done from [`Self::on_event`].
    fn on_processed(&self);
}

pub(super) struct Engine {
    pub(super) loop_: &'static Loop,
    registration: Registration,
    accepted: Cell<&'static [Version]>,
    endpoint: RefCell<Endpoint>,
    outbox: RefCell<Outbox>,
    /// Also the closed ones.
    sockets: RefCell<Vec<Rc<Socket>>>,
    is_processing: Cell<bool>,
    /// When to call [`Application::on_processed`] at the latest.
    alarm: Cell<Option<Instant>>,
}

pub(super) struct Socket {
    /// While it is open.
    udp: Cell<Option<udp::OwnedSocket>>,
    binding: Cell<Option<Binding>>,
    local: Cell<SocketAddr>,
    pub(super) owner: BackRef<dyn Application>,
    pub(super) is_close_pending: Cell<bool>,
}

impl<T: Application> Driver for T {
    fn process(&self) {
        let engine = self.engine();
        if engine.is_processing.replace(true) {
            return;
        }
        let now = now();
        let deadline = engine.endpoint().handle_timeouts(now, io::now) + MAX_PASS_TIME;
        engine.outbox.borrow_mut().start_pass(now);
        for _ in 0..MAX_ROUNDS {
            let is_late = dispatch_events(self, deadline);
            engine.transmit();
            if is_late || !engine.endpoint().has_events() || engine.outbox.borrow().is_pass_over() {
                break;
            }
        }
        engine.is_processing.set(false);
        engine.registration.forget_timeout();
        self.on_processed();
    }

    fn flush(&self) {
        if self.engine().endpoint.borrow().wants_to_transmit() {
            self.process();
        }
    }

    fn timeout(&self) -> Option<Instant> {
        self.engine().timeout()
    }
}

/// Returns whether it has stopped because of `deadline`.
pub(super) fn dispatch_events(application: &impl Application, deadline: Instant) -> bool {
    let (engine, start) = (application.engine(), now());
    loop {
        let Some((handle, context, event)) = engine.endpoint().poll_event(start) else {
            return false;
        };
        if matches!(event, Event::Closed(_)) {
            #[cfg(not(windows))]
            engine.loop_.dec();
            us_internal_disable_sweep_timer(engine.loop_);
        }
        let takes_time = matches!(
            event,
            Event::Stream(_, _, StreamEvent::Headers(_) | StreamEvent::Data { .. })
        );
        application.on_event(engine.connection(handle), context, event);
        if takes_time && engine.is_overdue() {
            engine.endpoint().take_turns();
            if now() >= deadline {
                return true;
            }
            engine.transmit();
        }
    }
}

impl Engine {
    pub(super) fn new(
        loop_: &'static Loop,
        owner: Weak<dyn Driver>,
        accepted: &'static [Version],
    ) -> Self {
        Self {
            loop_,
            registration: Registration::new(loop_, owner, Order::Any),
            accepted: Cell::new(accepted),
            endpoint: RefCell::new(Endpoint::new(&BoringSsl)),
            outbox: RefCell::default(),
            sockets: RefCell::default(),
            is_processing: Cell::new(false),
            alarm: Cell::new(None),
        }
    }

    /// Not to be held on to while code of the application runs.
    #[inline]
    pub(super) fn endpoint(&self) -> RefMut<'_, Endpoint> {
        if !self.is_processing() {
            self.registration.wake();
        }
        self.endpoint.borrow_mut()
    }

    pub(super) fn connection_count(&self) -> usize {
        self.endpoint.borrow().connection_count()
    }

    pub(super) fn has_unsent(&self) -> bool {
        self.outbox.borrow().has_unsent()
    }

    /// Their packets may get to another server when they are sent again.
    pub(super) fn ignore_new_clients(&self) {
        self.accepted.set(&[]);
    }

    pub(super) fn find_map<T>(&self, f: impl Fn(&bun_quic::Connection) -> Option<T>) -> Option<T> {
        self.endpoint.borrow().connections().find_map(f)
    }

    pub(super) fn reset_alarm(&self, at: Instant) {
        self.alarm.set(Some(at));
        self.registration.forget_timeout();
    }

    /// Unless it is set already.
    pub(super) fn set_alarm(&self, after: Duration) {
        if self.alarm.get().is_none() {
            self.reset_alarm(now() + after);
        }
    }

    pub(super) fn take_alarm(&self) -> bool {
        let is_due = self.alarm.get().is_some_and(|it| it <= now());
        is_due && self.alarm.take().is_some()
    }

    /// For good.
    pub(super) fn stop_processing(&self) {
        self.is_processing.set(true);
    }

    #[inline]
    pub(super) fn is_processing(&self) -> bool {
        self.is_processing.get()
    }

    #[inline]
    fn connection(&self, handle: Handle) -> Connection {
        Connection {
            engine: BackRef::new(self),
            handle,
        }
    }

    /// For a new connection, which counts for the loop like a TCP socket does.
    pub(super) fn track(&self, handle: Handle) -> Connection {
        #[cfg(not(windows))]
        self.loop_.inc();
        us_internal_enable_sweep_timer(self.loop_);
        self.connection(handle)
    }

    pub(super) fn for_each_connection(&self, f: impl Fn(&mut bun_quic::Connection)) {
        let mut endpoint = self.endpoint();
        for handle in endpoint.handles() {
            endpoint.get_mut(handle).map(&f);
        }
    }

    #[inline]
    fn timeout(&self) -> Option<Instant> {
        if self.is_processing() {
            return None;
        }
        let (mut endpoint, outbox) = (self.endpoint.borrow_mut(), self.outbox.borrow());
        let can_send =
            !outbox.is_blocked() && (outbox.has_unsent() || endpoint.wants_to_transmit());
        match can_send || endpoint.has_events() {
            true => Some(Instant::default()),
            false => endpoint.timeout().into_iter().chain(self.alarm.get()).min(),
        }
    }

    #[inline]
    fn is_overdue(&self) -> bool {
        let is_busy = self.endpoint.borrow().waiting_with_events() > 1;
        self.outbox.borrow_mut().is_overdue(is_busy)
    }

    /// Without a word to the application.
    pub(super) fn start_transmitting(&self) {
        self.outbox.borrow_mut().start_pass(now());
        self.transmit();
    }

    pub(super) fn lift_limit(&self) {
        self.outbox.borrow_mut().lift_limit();
    }

    fn transmit(&self) {
        let sockets = self.sockets.borrow();
        let find = |local| {
            let mut open = sockets.iter().filter_map(|it| it.binding.get());
            open.find(|it| it.has(local))
        };
        (self.outbox.borrow_mut()).flush(&mut self.endpoint(), find, |_| {}, |_| {});
    }

    pub(super) fn sockets(&self) -> Vec<Rc<Socket>> {
        self.sockets.borrow().clone()
    }

    pub(super) fn bind(
        &self,
        owner: &(dyn Application + 'static),
        host: Option<&ZStr>,
        port: u16,
        flags: c_int,
    ) -> Option<Rc<Socket>> {
        let socket = Rc::new(Socket {
            udp: Cell::new(None),
            binding: Cell::new(None),
            local: Cell::new((Ipv4Addr::UNSPECIFIED, 0).into()),
            owner: BackRef::new(owner),
            is_close_pending: Cell::new(false),
        });
        let user = Rc::as_ptr(&socket).cast_mut().cast();
        let udp = udp::Socket::create(
            self.loop_, on_data, on_drain, on_close, None, host, port, flags, None, user,
        )?;
        let binding = Binding::new(udp.as_ptr());
        socket.udp.set(Some(udp));
        socket.binding.set(Some(binding));
        socket.local.set(binding.address);
        self.sockets.borrow_mut().push(Rc::clone(&socket));
        Some(socket)
    }
}

impl Socket {
    fn of<'a>(udp: *mut udp::Socket) -> &'a Self {
        // SAFETY: the engine keeps it, and closes `udp` before it goes away.
        unsafe { &*udp::Socket::opaque_mut(udp).user().cast() }
    }

    pub(super) fn is_open(&self) -> bool {
        self.binding.get().is_some()
    }

    pub(super) fn local(&self) -> SocketAddr {
        self.local.get()
    }

    pub(super) fn close(&self) {
        self.udp.set(None);
    }
}

/// The answers wait until all polls of this turn have been dispatched.
fn on_data(udp: *mut udp::Socket, packets: udp::Packets<'_>) {
    let socket = Socket::of(udp);
    let (engine, now) = (socket.owner.engine(), now());
    let Some(binding) = socket.binding.get() else {
        return;
    };
    let receive = |from: &Addresses, datagram: &mut [u8]| {
        let accepted = engine.accepted.get();
        let unrouted = (engine.endpoint.borrow_mut()).receive(now, from, datagram, accepted);
        if let Some(Unrouted::Incoming(incoming)) = unrouted {
            socket.owner.on_incoming(now, incoming);
        }
    };
    let read = binding.for_each_datagram(packets, receive);
    engine.registration.forget_timeout();
    (engine.outbox.borrow_mut()).reads_on(&read, &engine.endpoint.borrow());
}

extern "C" fn on_drain(udp: *mut udp::Socket) {
    let engine = Socket::of(udp).owner.engine();
    engine.outbox.borrow_mut().unblock();
    engine.registration.wake();
}

extern "C" fn on_close(udp: *mut udp::Socket) {
    let socket = Socket::of(udp);
    let _ = socket.udp.take().map(udp::OwnedSocket::into_raw);
    socket.binding.set(None);
    on_drain(udp);
}

/// The methods do nothing once it is closed.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Connection {
    engine: BackRef<Engine>,
    handle: Handle,
}

impl Connection {
    #[inline]
    pub(super) fn get<T>(&self, f: impl FnOnce(&bun_quic::Connection) -> T) -> Option<T> {
        self.engine.endpoint.borrow().get(self.handle).map(f)
    }

    #[inline]
    pub(super) fn update<T>(&self, f: impl FnOnce(&mut bun_quic::Connection) -> T) -> Option<T> {
        self.engine.endpoint().get_mut(self.handle).map(f)
    }

    #[inline]
    pub fn stream(self, id: StreamId) -> Stream {
        Stream {
            connection: self,
            id,
        }
    }

    /// [`Event::StreamsAvailable`] tells when it is worth another try.
    pub fn open(self, context: Context, can_be_repeated: bool) -> Option<Stream> {
        let id = self.update(|it| {
            if !can_be_repeated && it.is_stale(now()) {
                it.ask_for_answer();
                return None;
            }
            it.open(Direction::Bidirectional, context)
        })??;
        Some(self.stream(id))
    }

    pub fn available_streams(&self) -> u64 {
        (self.get(|it| it.available_streams(Direction::Bidirectional))).unwrap_or(0)
    }

    /// Neither side is closing or going away.
    pub fn is_usable(&self) -> bool {
        self.get(|it| !it.is_closing() && it.peer_go_away().is_none()) == Some(true)
    }

    pub fn close(&self) {
        self.update(|it| it.close(now()));
    }

    pub fn stop_streams_without_context(&self, code: u64) {
        self.update(|it| it.stop_streams_without_context(code));
    }

    #[inline]
    pub fn recycle(&self, fields: Fields) {
        self.engine.endpoint.borrow_mut().recycle(fields);
    }
}

/// `us_quic_stream_t`. The methods do nothing once it is closed.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Stream {
    pub(super) connection: Connection,
    id: StreamId,
}

bun_core::assert_ffi_layout!(Stream, 24, 8; id @ 16);

impl Stream {
    #[inline]
    pub fn set_context(&self, context: Context) {
        (self.connection).update(|it| it.set_stream_context(self.id, context));
    }

    #[inline]
    pub fn send_headers<'a>(&self, headers: impl Iterator<Item = Header<'a>>, is_end: bool) {
        let Connection { engine, handle } = &self.connection;
        engine.endpoint().send_headers(*handle, self.id, headers);
        if is_end {
            self.finish();
        }
    }

    pub fn has_received(&self) -> bool {
        let info = self.connection.get(|it| it.stream_info(self.id));
        info.flatten().is_some_and(|it| it.has_received)
    }

    /// Returns how many bytes it took.
    #[inline]
    pub fn write(&self, data: &[u8]) -> usize {
        let len = self.connection.update(|it| it.write(self.id, data));
        len.flatten().unwrap_or(0)
    }

    pub fn want_write(&self) {
        self.connection.update(|it| it.want_write(self.id));
    }

    pub fn set_paused(&self, is_paused: bool) {
        (self.connection).update(|it| it.set_paused(self.id, is_paused));
    }

    #[inline]
    pub fn finish(&self) {
        self.connection.update(|it| it.finish(self.id));
    }

    #[inline]
    pub fn stop(&self, code: u64) {
        self.connection.update(|it| it.stop(self.id, code));
    }

    pub fn reset_unless_delivered(&self, code: u64) {
        (self.connection).update(|it| it.reset_unless_delivered(self.id, code));
    }

    pub fn reset_unfinished(&self, code: u64) {
        (self.connection).update(|it| it.reset_unfinished(self.id, code));
    }
}
