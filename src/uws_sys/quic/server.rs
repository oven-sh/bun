//! packages/bun-usockets/src/quic.h.

use core::cell::{Cell, OnceCell, RefCell};
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::net::IpAddr;
use core::ptr::NonNull;
use std::rc::{Rc, Weak};

use bun_boringssl_sys::{OwnedSslCtx, SSL_CTX};
use bun_core::ZStr;
use bun_quic::http3::{Fields, Section};
use bun_quic::{
    Config, Context, Duration, Event, FieldLimits, Http3Config, Incoming, Instant, Layer, Side,
    StreamEvent, Version, http3_code, transport_code,
};
use bun_quic_tls::Session;

use super::engine::{Application, Engine, Socket, dispatch_events};
use super::io::{now, write_ip};
use super::{Connection, Header, Stream};
use crate::{BunSocketContextOptions, Loop};

const VERSIONS: &[Version] = &[Version::Draft29, Version::V1, Version::V2];
const MAX_IDLE_TIMEOUT_SECS: c_uint = 600;
/// `US_QUIC_MAX_REQUEST_FIELDS`.
const MAX_REQUEST_FIELDS: usize = 200;
const MAX_HEADER_SIZE: usize = 0xff_ffff;
/// As in Http2Context.h.
const MIN_TOLERATED_HEADER_SIZE: usize = 16 * 1024;

bun_opaque::opaque_ffi! {
    struct NameTree;
}

unsafe extern "C" {
    safe fn us_quic_create_server_ssl_ctx(
        options: &BunSocketContextOptions,
        default_ctx: Option<&SSL_CTX>,
    ) -> Option<OwnedSslCtx>;
    safe fn us_quic_create_server_names() -> ServerNames;
    fn us_quic_server_names_free(names: &NameTree);
    fn us_quic_server_names_add(names: &NameTree, name: *const c_char, ctx: OwnedSslCtx);
    fn us_quic_server_names_find(
        names: &NameTree,
        name: *const u8,
        len: usize,
    ) -> Option<OwnedSslCtx>;
}

#[repr(transparent)]
struct ServerNames(NonNull<NameTree>);

impl ServerNames {
    fn tree(&self) -> &NameTree {
        NameTree::opaque_ref(self.0.as_ptr())
    }

    fn find(&self, name: &[u8]) -> Option<OwnedSslCtx> {
        // SAFETY: `name` is valid for its length.
        unsafe { us_quic_server_names_find(self.tree(), name.as_ptr(), name.len()) }
    }
}

impl Drop for ServerNames {
    fn drop(&mut self) {
        // SAFETY: we own it.
        unsafe { us_quic_server_names_free(self.tree()) }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Callbacks {
    on_open: unsafe extern "C" fn(*mut c_void, &Stream) -> *mut c_void,
    on_headers: unsafe extern "C" fn(*mut c_void, *const Header, c_uint, bool),
    on_data: unsafe extern "C" fn(*mut c_void, *const u8, c_uint, bool),
    on_writable: unsafe extern "C" fn(*mut c_void),
    on_close: unsafe extern "C" fn(*mut c_void),
}

struct Server {
    engine: Engine,
    config: Rc<Config>,
    tls: OwnedSslCtx,
    names: OnceCell<Rc<ServerNames>>,
    callbacks: Callbacks,
    user: *mut c_void,
    headers: Cell<Vec<Header>>,
    is_closing: Cell<bool>,
    /// In which turn of the loop it began to look like it.
    deserted_since: Cell<Option<u64>>,
    is_deserted: Cell<bool>,
    on_drained: Cell<Option<(OnDrained, *mut c_void)>>,
}

type OnDrained = unsafe extern "C" fn(*mut c_void, bool);

std::thread_local! {
    /// The sockets that are closed when the handler that asked for it has returned, or the last connection is gone.
    static PENDING_CLOSES: RefCell<Vec<Weak<Socket>>> = const { RefCell::new(Vec::new()) };
}

impl Application for Server {
    #[inline]
    fn engine(&self) -> &Engine {
        &self.engine
    }

    fn on_incoming(&self, now: Instant, incoming: Incoming<'_>) {
        let Some(mut tls) = Session::new(&self.tls, Side::Server) else {
            return self.engine.endpoint().refuse(incoming);
        };
        if let Some(names) = self.names.get().cloned() {
            tls.select_context_with(Box::new(move |name| names.find(name?)));
        }
        let config = Rc::clone(&self.config);
        let handle = (self.engine.endpoint()).accept(now, incoming, config, Box::new(tls));
        self.engine.track(handle);
    }

    #[inline]
    fn on_event(&self, connection: Connection, _: Context, event: Event) {
        if let Event::Stream(id, response, event) = event {
            self.on_stream_event(connection.stream(id), response, event);
        }
    }

    fn on_processed(&self) {
        let is_drained = self.is_closing.get()
            && self.engine.connection_count() == 0
            && !self.engine.has_unsent();
        if is_drained || PENDING_CLOSES.with_borrow(|it| !it.is_empty()) {
            for socket in self.engine.sockets() {
                if socket.is_close_pending.take() || is_drained {
                    socket.close();
                }
            }
            PENDING_CLOSES
                .with_borrow_mut(|it| it.retain(|it| it.upgrade().is_some_and(|it| it.is_open())));
        }
        let Some((on_drained, user)) = self.on_drained.get() else {
            return;
        };
        if is_drained {
            self.on_drained.set(None);
            self.engine.reset_alarm(Instant::NEVER);
        } else if self.is_deserted.get() || !self.has_only_deserted_connections() {
            return;
        }
        self.is_deserted.set(true);
        // SAFETY: they came together.
        unsafe { on_drained(user, is_drained) };
    }
}

impl Server {
    fn has_only_deserted_connections(&self) -> bool {
        let (engine, now) = (&self.engine, now());
        let later = engine.find_map(|it| Some(it.deserted_from()).filter(|&it| it > now));
        if later.is_some() || engine.has_unsent() {
            self.deserted_since.set(None);
            engine.reset_alarm(later.unwrap_or(Instant::NEVER));
            return false;
        }
        // The answers may be waiting in the socket.
        let turn = engine.loop_.iteration_number();
        let since = self.deserted_since.get().unwrap_or(turn);
        self.deserted_since.set(Some(since));
        let has_read = turn >= since + 2;
        engine.reset_alarm(if has_read { Instant::NEVER } else { now });
        has_read
    }

    #[inline]
    fn on_stream_event(&self, stream: Stream, response: *mut c_void, event: StreamEvent) {
        let callbacks = &self.callbacks;
        match event {
            StreamEvent::Headers(fields) => {
                if fields.section == Section::Head {
                    self.on_request(stream, &fields);
                }
                stream.connection.recycle(fields);
            }
            StreamEvent::Reset(_) | StreamEvent::Stopped(_) => {
                stream.reset_unfinished(http3_code::REQUEST_CANCELLED);
                stream.stop(http3_code::REQUEST_CANCELLED);
            }
            _ if response.is_null() => {}
            // SAFETY: `response` is from `on_open`, and `data` is as long as it says.
            StreamEvent::Data { data, is_last } => unsafe {
                (callbacks.on_data)(response, data.as_ptr(), data.len() as c_uint, is_last);
            },
            // SAFETY: `response` is from `on_open`.
            StreamEvent::Writable => unsafe { (callbacks.on_writable)(response) },
            // SAFETY: `response` is from `on_open`, and this is the last event.
            StreamEvent::Closed => unsafe { (callbacks.on_close)(response) },
            StreamEvent::Opened => {}
        }
    }

    #[inline]
    fn on_request(&self, stream: Stream, fields: &Fields) {
        let mut headers = self.headers.take();
        headers.clear();
        headers.extend(fields.iter().map(|it| Header::init(it.0, it.1)));
        // SAFETY: `user` came with the callbacks, and the headers point into `fields`.
        unsafe {
            let response = (self.callbacks.on_open)(self.user, &stream);
            stream.set_context(response);
            let (at, count) = (headers.as_ptr(), headers.len() as c_uint);
            (self.callbacks.on_headers)(response, at, count, fields.is_incomplete);
        }
        self.headers.set(headers);
    }
}

fn create_tls(
    options: &BunSocketContextOptions,
    default_ctx: Option<&SSL_CTX>,
) -> Option<OwnedSslCtx> {
    let ctx = us_quic_create_server_ssl_ctx(options, default_ctx)?;
    // SAFETY: nothing else has the new context.
    unsafe { bun_quic_tls::enable_alpn(&ctx) };
    Some(ctx)
}

#[unsafe(no_mangle)]
extern "C" fn us_create_quic_socket_context(
    loop_: &'static Loop,
    options: &BunSocketContextOptions,
    idle_timeout_secs: c_uint,
    max_header_size: usize,
    callbacks: &Callbacks,
    user: *mut c_void,
) -> *const Server {
    let Some(tls) = create_tls(options, None) else {
        return core::ptr::null();
    };
    let size = max_header_size.min(MAX_HEADER_SIZE);
    let mut config = Config {
        versions: VERSIONS,
        http3: Some(Http3Config {
            kept_fields: FieldLimits {
                size,
                count: MAX_REQUEST_FIELDS,
            },
            tolerated_fields: FieldLimits {
                size: (2 * size).max(MIN_TOLERATED_HEADER_SIZE),
                count: 2 * MAX_REQUEST_FIELDS,
            },
            field_overhead: 32,
            advertises_max_field_section_size: true,
            ..Http3Config::default()
        }),
        ..Config::server()
    };
    match Duration::from_secs(idle_timeout_secs.min(MAX_IDLE_TIMEOUT_SECS).into()) {
        Duration::ZERO => config.progress_timeout = Duration::ZERO,
        timeout => {
            config.parameters.max_idle_timeout_millis = timeout.as_millis();
            config.progress_timeout = config.progress_timeout.max(timeout);
        }
    }
    Rc::into_raw(Rc::new_cyclic(|this| Server {
        engine: Engine::new(loop_, Weak::<Server>::clone(this), VERSIONS),
        config: Rc::new(config),
        tls,
        names: OnceCell::new(),
        callbacks: *callbacks,
        user,
        headers: Cell::default(),
        is_closing: Cell::new(false),
        deserted_since: Cell::new(None),
        is_deserted: Cell::new(false),
        on_drained: Cell::new(None),
    }))
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_socket_context_shutdown(
    server: &Server,
    on_drained: OnDrained,
    user: *mut c_void,
) {
    if server.is_closing.replace(true) {
        return;
    }
    server.on_drained.set(Some((on_drained, user)));
    server.engine.ignore_new_clients();
    let sockets = server.engine.sockets();
    PENDING_CLOSES.with_borrow_mut(|it| it.extend(sockets.iter().map(Rc::downgrade)));
    let now = now();
    (server.engine).for_each_connection(|connection| match connection.is_ready() {
        true => connection.go_away(),
        false => {
            let code = transport_code::CONNECTION_REFUSED;
            connection.abort(now, Layer::Transport, code, &[]);
        }
    });
    if !server.engine.is_processing() {
        server.engine.start_transmitting();
        server.on_processed();
    }
}

/// # Safety
/// `server` is from [`us_create_quic_socket_context`], and is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_quic_socket_context_free(server: *const Server) {
    // SAFETY: the caller's.
    let server = unsafe { Rc::from_raw(server) };
    server.on_drained.set(None);
    server.engine.stop_processing();
    server.engine.sockets().iter().for_each(|it| it.close());
    (server.engine).for_each_connection(bun_quic::Connection::abort_silently);
    dispatch_events(&*server, Instant::NEVER);
}

/// # Safety
/// `name` is a string.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_quic_socket_context_add_server_name(
    server: &Server,
    name: *const c_char,
    options: &BunSocketContextOptions,
) -> bool {
    let Some(ctx) = create_tls(options, Some(&server.tls)) else {
        return false;
    };
    let names = (server.names).get_or_init(|| Rc::new(us_quic_create_server_names()));
    // SAFETY: the caller's.
    unsafe { us_quic_server_names_add(names.tree(), name, ctx) };
    true
}

/// # Safety
/// `host` is a string or null.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_quic_socket_context_listen(
    server: &Server,
    host: *const c_char,
    port: c_int,
    flags: c_int,
) -> *const Socket {
    let port = port as u16;
    // `stop(true)` promises that the port is free when it returns,
    release_port(port, |it| it.is_close_pending.get());
    // SAFETY: the caller's.
    let host = (!host.is_null()).then(|| unsafe { ZStr::from_c_ptr(host) });
    // TIME_WAIT, which it is there for, is a matter of TCP.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let flags = flags & !crate::LIBUS_LISTEN_REUSE_ADDR;
    let bind = || server.engine.bind(server, host, port, flags);
    let (socket, now) = (bind(), now());
    // and so does `stop()` on an idle server. If the port is shared, the old socket takes packets away.
    release_port(port, |it| {
        let is_busy = |it: &bun_quic::Connection| {
            let is_done = it.has_sent_everything() && !(socket.is_some() && it.is_delivering());
            (!is_done && it.deserted_from() > now).then_some(())
        };
        let is_in_the_way = socket.as_ref().is_none_or(|new| {
            let [a, b] = [&**new, it].map(|it| it.local().ip().to_canonical());
            let covers = |a: IpAddr, b: IpAddr| a.is_unspecified() && (a.is_ipv6() || b.is_ipv4());
            a == b || covers(a, b) || covers(b, a)
        });
        let engine = it.owner.engine();
        is_in_the_way && !engine.has_unsent() && engine.find_map(is_busy).is_none()
    });
    let socket = socket.or_else(bind);
    socket.map_or(core::ptr::null(), |it| Rc::as_ptr(&it))
}

fn release_port(port: u16, is_over: impl Fn(&Socket) -> bool) {
    for socket in PENDING_CLOSES.with_borrow(Vec::clone) {
        if let Some(socket) =
            (socket.upgrade()).filter(|it| it.local().port() == port && is_over(it))
        {
            us_quic_listen_socket_close(&socket);
            socket.close();
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_listen_socket_close(socket: &Socket) {
    if !socket.is_open() {
        return;
    }
    let (engine, now) = (socket.owner.engine(), now());
    engine.for_each_connection(|connection| {
        let code = transport_code::NO_ERROR;
        connection.abort(now, Layer::Transport, code, b"user aborted connection");
    });
    engine.lift_limit();
    if !engine.is_processing() {
        socket.owner.process();
        return socket.close();
    }
    socket.is_close_pending.set(true);
    let sockets = engine.sockets();
    let this = sockets
        .iter()
        .find(|it| core::ptr::eq(Rc::as_ptr(it), socket));
    PENDING_CLOSES.with_borrow_mut(|it| it.extend(this.map(Rc::downgrade)));
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_listen_socket_port(socket: &Socket) -> c_int {
    socket.local().port().into()
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_listen_socket_local_address(socket: &Socket, ip: &mut [u8; 16]) -> c_int {
    write_ip(socket.local().ip(), ip)
}

/// # Safety
/// `data` is valid for `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_quic_stream_write(stream: &Stream, data: *const u8, len: usize) -> usize {
    // SAFETY: the caller's.
    stream.write(unsafe { bun_core::ffi::slice(data, len) })
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_want_read(stream: &Stream, is_wanted: bool) {
    stream.set_paused(!is_wanted);
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_want_write(stream: &Stream) {
    stream.want_write();
}

/// # Safety
/// There are `count` headers, and they are valid.
#[unsafe(no_mangle)]
unsafe extern "C" fn us_quic_stream_send_headers(
    stream: &Stream,
    headers: *const Header,
    count: c_uint,
    is_end: bool,
) {
    // SAFETY: the caller's.
    let headers = unsafe { bun_core::ffi::slice(headers, count as usize) };
    // SAFETY: likewise.
    stream.send_headers(headers.iter().map(|it| unsafe { it.to_field() }), is_end);
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_shutdown(stream: &Stream) {
    stream.finish();
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_shutdown_read(stream: &Stream) {
    stream.stop(http3_code::NO_ERROR);
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_close(stream: &Stream) {
    stream.reset_unfinished(http3_code::INTERNAL_ERROR);
    stream.stop(http3_code::NO_ERROR);
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_timeout(stream: &Stream, secs: c_uint) {
    let timeout = Duration::from_secs(secs.into());
    (stream.connection).update(|it| it.allow_silence(timeout));
}

#[unsafe(no_mangle)]
extern "C" fn us_quic_stream_remote_address(
    stream: &Stream,
    ip: &mut [u8; 16],
    port: &mut c_int,
) -> c_int {
    let peer = stream.connection.get(|it| it.addresses().peer);
    *port = peer.map_or(0, |it| it.port().into());
    peer.map_or(0, |it| write_ip(it.ip().to_canonical(), ip))
}
