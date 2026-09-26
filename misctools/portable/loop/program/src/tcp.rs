//! TCP through uSockets: a listener on 127.0.0.1, a client that connects, sends, gets what it sent back
//! and compares it. Twice: a small message after which the client closes, and a large one, which takes
//! several writes and waits for the socket to be writable again, after which the server closes.

use core::ffi::{c_int, c_void};

use bun_uws_sys::CloseCode;
use bun_uws_sys::vtable::{self, Handler};
use bun_uws_sys::{ConnectResult, SocketGroup, SocketKind, us_socket_t};

use crate::Loop;
use crate::json::Report;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Client,
    Server,
}

/// One exchange, owned by `exchange` and found by the sockets through their groups.
struct Exchange {
    payload: Vec<u8>,
    closes_first: Side,

    client_sent: usize,
    client_writes: u32,
    client_was_writable: u32,
    client_received: Vec<u8>,
    client_saw_end: bool,
    client_closed: bool,
    client_failed: Option<i32>,

    server_opened: u32,
    server_received: usize,
    /// Received and not yet written back.
    server_pending: Vec<u8>,
    server_echoed: usize,
    server_writes: u32,
    server_was_writable: u32,
    server_saw_end: bool,
    server_closed: bool,
}

fn exchange_of(s: *mut us_socket_t) -> &'static mut Exchange {
    let owner = us_socket_t::opaque_mut(s).group().owner::<Exchange>();
    // SAFETY: both groups were made with the `Exchange` as their owner, and it outlives them. The loop
    // runs one callback at a time on this thread.
    unsafe { &mut *owner }
}

fn write(s: *mut us_socket_t, data: &[u8]) -> usize {
    us_socket_t::opaque_mut(s).write(data).max(0) as usize
}

fn close(s: *mut us_socket_t) {
    us_socket_t::opaque_mut(s).close(CloseCode::normal);
}

struct Client;

impl Client {
    fn send(s: *mut us_socket_t) {
        let exchange = exchange_of(s);
        while exchange.client_sent < exchange.payload.len() {
            let written = write(s, &exchange.payload[exchange.client_sent..]);
            exchange.client_writes += 1;
            exchange.client_sent += written;
            if written == 0 {
                // The socket takes no more now: `on_writable` goes on.
                return;
            }
        }
    }
}

impl Handler for Client {
    type Ext = ();
    const HAS_EXT: bool = false;
    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;

    fn on_open_no_ext(s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        Client::send(s);
    }

    fn on_writable_no_ext(s: *mut us_socket_t) {
        exchange_of(s).client_was_writable += 1;
        Client::send(s);
    }

    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        let exchange = exchange_of(s);
        exchange.client_received.extend_from_slice(data);
        if exchange.client_received.len() >= exchange.payload.len()
            && exchange.closes_first == Side::Client
        {
            close(s);
        }
    }

    fn on_end_no_ext(s: *mut us_socket_t) {
        exchange_of(s).client_saw_end = true;
        close(s);
    }

    fn on_close_no_ext(s: *mut us_socket_t, _code: i32, _reason: Option<*mut c_void>) {
        exchange_of(s).client_closed = true;
    }

    fn on_connect_error_no_ext(s: *mut us_socket_t, code: i32) {
        let exchange = exchange_of(s);
        exchange.client_failed = Some(code);
        exchange.client_closed = true;
    }
}

struct Server;

impl Server {
    fn echo(s: *mut us_socket_t) {
        let exchange = exchange_of(s);
        while !exchange.server_pending.is_empty() {
            let written = write(s, &exchange.server_pending);
            exchange.server_writes += 1;
            exchange.server_echoed += written;
            exchange.server_pending.drain(..written);
            if written == 0 {
                return;
            }
        }
        if exchange.closes_first == Side::Server && exchange.server_echoed == exchange.payload.len()
        {
            close(s);
        }
    }
}

impl Handler for Server {
    type Ext = ();
    const HAS_EXT: bool = false;
    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CLOSE: bool = true;

    fn on_open_no_ext(s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        exchange_of(s).server_opened += 1;
    }

    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        let exchange = exchange_of(s);
        exchange.server_received += data.len();
        exchange.server_pending.extend_from_slice(data);
        Server::echo(s);
    }

    fn on_writable_no_ext(s: *mut us_socket_t) {
        exchange_of(s).server_was_writable += 1;
        Server::echo(s);
    }

    fn on_end_no_ext(s: *mut us_socket_t) {
        exchange_of(s).server_saw_end = true;
        close(s);
    }

    fn on_close_no_ext(s: *mut us_socket_t, _code: i32, _reason: Option<*mut c_void>) {
        exchange_of(s).server_closed = true;
    }
}

fn exchange(
    report: &mut Report,
    event_loop: &Loop,
    step: &str,
    bytes: usize,
    closes_first: Side,
) -> bool {
    let mut state = Exchange {
        payload: (0..bytes)
            .map(|index| (index * 31 + index / 251) as u8)
            .collect(),
        closes_first,
        client_sent: 0,
        client_writes: 0,
        client_was_writable: 0,
        client_received: Vec::new(),
        client_saw_end: false,
        client_closed: false,
        client_failed: None,
        server_opened: 0,
        server_received: 0,
        server_pending: Vec::new(),
        server_echoed: 0,
        server_writes: 0,
        server_was_writable: 0,
        server_saw_end: false,
        server_closed: false,
    };
    let state_pointer = &raw mut state;
    let mut server_group = SocketGroup::default();
    let mut client_group = SocketGroup::default();
    server_group.init(
        event_loop.uws(),
        Some(vtable::make::<Server>()),
        state_pointer.cast(),
    );
    client_group.init(
        event_loop.uws(),
        Some(vtable::make::<Client>()),
        state_pointer.cast(),
    );

    let mut listen_error: c_int = 0;
    let listener = server_group.listen(
        SocketKind::Dynamic,
        None,
        Some(c"127.0.0.1"),
        0,
        0,
        0,
        &mut listen_error,
    );
    let port = if listener.is_null() {
        None
    } else {
        // SAFETY: a listener that `listen` returned, until it is closed below.
        unsafe { &mut *listener }.get_local_port()
    };
    let mut connected = false;
    if let Some(port) = port {
        connected = match client_group.connect(
            SocketKind::Dynamic,
            None,
            c"127.0.0.1",
            c_int::from(port),
            None,
            0,
            0,
        ) {
            ConnectResult::Socket(_) | ConnectResult::Connecting(_) => true,
            ConnectResult::Failed => false,
        };
    }
    if connected {
        // SAFETY: the callbacks that write the state run inside of `run_until`, on this thread.
        event_loop.run_until(|| unsafe {
            (*state_pointer).client_closed
                && ((*state_pointer).server_closed || (*state_pointer).client_failed.is_some())
        });
    }
    if !listener.is_null() {
        // SAFETY: as above.
        unsafe { &mut *listener }.close();
    }
    // SAFETY: the groups were made above and have no socket left.
    unsafe {
        SocketGroup::destroy(&raw mut server_group);
        SocketGroup::destroy(&raw mut client_group);
    }

    let echoed = state.client_received == state.payload;
    let ok = port.is_some()
        && connected
        && state.client_failed.is_none()
        && echoed
        && state.server_opened == 1
        && state.client_closed
        && state.server_closed;
    report.begin(step);
    report.boolean("listening", port.is_some());
    report.boolean("connected", connected && state.client_failed.is_none());
    report.number("bytes", bytes as i64);
    report.number("sent", state.client_sent as i64);
    report.number("server_received", state.server_received as i64);
    report.number("received", state.client_received.len() as i64);
    report.boolean("echoed", echoed);
    report.boolean("several_writes", state.client_writes > 1);
    report.boolean(
        "waited_to_write",
        state.client_was_writable + state.server_was_writable > 0,
    );
    report.string(
        "closes_first",
        if closes_first == Side::Client {
            b"client"
        } else {
            b"server"
        },
    );
    report.boolean("client_saw_end", state.client_saw_end);
    report.boolean("server_saw_end", state.server_saw_end);
    report.boolean("client_closed", state.client_closed);
    report.boolean("server_closed", state.server_closed);
    if ok {
        report.end_ok();
    } else {
        report.boolean("ok", false);
        report.end_line();
    }
    ok
}

pub(crate) fn steps(report: &mut Report, event_loop: &Loop) -> bool {
    let small = exchange(report, event_loop, "tcp echo", 4096, Side::Client);
    let large = exchange(
        report,
        event_loop,
        "tcp echo, large",
        16 << 20,
        Side::Server,
    );
    small && large
}
