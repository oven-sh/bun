//! For all HTTP/3 connections that a loop makes, which share one UDP socket.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::net::{IpAddr, SocketAddr};
use core::ptr::NonNull;
use std::rc::{Rc, Weak};

use bun_boringssl_sys::{OwnedSslCtx, SSL};
use bun_core::{ZBox, ZStr, zstr};
use bun_quic::{
    Addresses, Config, Context, Duration, Event, FieldLimits, Http3Config, Incoming, Instant, Side,
    Version,
};
use bun_quic_tls::Session;

use super::Connection;
use super::engine::{Application, Engine, Socket};
use super::io::{Address, now, or_loopback};
use crate::Loop;

/// As for HTTP/2.
const MAX_HEADER_SIZE: usize = 256 * 1024;

unsafe extern "C" {
    safe fn us_quic_create_client_ssl_ctx() -> Option<OwnedSslCtx>;
    fn us_quic_is_server_authorized(ssl: &SSL, hostname: *const c_char) -> bool;
    fn us_quic_parse_address(host: *const c_char, out: &mut Address) -> bool;
    fn us_quic_resolved_address(lookup: *mut c_void, index: c_uint, out: &mut Address) -> bool;
    safe fn us_quic_is_routable(address: &Address) -> bool;
    fn Bun__addrinfo_get(
        loop_: &Loop,
        host: *const c_char,
        port: u16,
        lookup: &mut *mut c_void,
    ) -> c_int;
    fn Bun__addrinfo_freeRequest(lookup: *mut c_void, is_useless: c_int);
}

pub struct Client {
    engine: Engine,
    config: Rc<Config>,
    tls: OwnedSslCtx,
    on_event: fn(Connection, Context, Event),
    on_alarm: fn(),
}

pub struct Origin<'a> {
    /// Without brackets.
    pub hostname: &'a [u8],
    pub port: u16,
    pub reject_unauthorized: bool,
}

pub enum Connecting {
    Started(Connection),
    /// For [`Client::connect_resolved`].
    Resolving(Lookup),
}

/// A reference to an entry of the DNS cache.
pub struct Lookup {
    request: NonNull<c_void>,
    is_useful: bool,
}

impl Lookup {
    pub fn request(&self) -> *mut c_void {
        self.request.as_ptr()
    }
}

impl Drop for Lookup {
    fn drop(&mut self) {
        // SAFETY: we own the reference.
        unsafe { Bun__addrinfo_freeRequest(self.request(), (!self.is_useful).into()) }
    }
}

impl Application for Client {
    #[inline]
    fn engine(&self) -> &Engine {
        &self.engine
    }

    fn on_incoming(&self, _: Instant, _: Incoming<'_>) {}

    #[inline]
    fn on_event(&self, connection: Connection, context: Context, event: Event) {
        (self.on_event)(connection, context, event);
    }

    fn on_processed(&self) {
        if self.engine.take_alarm() {
            (self.on_alarm)();
        }
    }
}

impl Client {
    pub fn new(
        loop_: &'static Loop,
        on_event: fn(Connection, Context, Event),
        on_alarm: fn(),
    ) -> Option<Rc<Self>> {
        let config = Config {
            versions: &[Version::V1],
            http3: Some(Http3Config {
                kept_fields: FieldLimits {
                    size: MAX_HEADER_SIZE,
                    count: usize::MAX,
                },
                tolerated_fields: FieldLimits {
                    size: 2 * MAX_HEADER_SIZE,
                    count: usize::MAX,
                },
                field_overhead: 32,
                advertises_max_field_section_size: true,
                encodes_with_dynamic_table: true,
                ..Http3Config::default()
            }),
            gives_up_early: true,
            ..Config::client()
        };
        let tls = us_quic_create_client_ssl_ctx()?;
        Some(Rc::new_cyclic(|this| Self {
            engine: Engine::new(loop_, Weak::<Self>::clone(this), &[]),
            config: Rc::new(config),
            tls,
            on_event,
            on_alarm,
        }))
    }

    /// Unless it is set already.
    pub fn set_alarm(&self, secs: u32) {
        self.engine.set_alarm(Duration::from_secs(secs.into()));
    }

    pub fn connect(&self, origin: &Origin, context: Context) -> Option<Connecting> {
        let (host, mut address) = (ZBox::from_bytes(origin.hostname), Address::default());
        // SAFETY: `host` is a string.
        if unsafe { us_quic_parse_address(host.as_ptr(), &mut address) } {
            let ip = SocketAddr::from(address).ip();
            let connection = self.connect_to((ip, origin.port).into(), origin, context);
            return connection.map(Connecting::Started);
        }
        let (loop_, mut request) = (self.engine.loop_, core::ptr::null_mut());
        // SAFETY: `host` is a string.
        let result = unsafe { Bun__addrinfo_get(loop_, host.as_ptr(), origin.port, &mut request) };
        let lookup = Lookup {
            request: NonNull::new(request)?,
            is_useful: false,
        };
        match result {
            0 => (self.connect_resolved(lookup, origin, context)).map(Connecting::Started),
            _ => Some(Connecting::Resolving(lookup)),
        }
    }

    pub fn connect_resolved(
        &self,
        mut lookup: Lookup,
        origin: &Origin,
        context: Context,
    ) -> Option<Connection> {
        let addresses = (0..).map_while(|at| {
            let mut address = Address::default();
            // SAFETY: we have a reference to the request, which is complete.
            unsafe { us_quic_resolved_address(lookup.request(), at, &mut address) }
                .then_some(address)
        });
        let connection = addresses.map(SocketAddr::from).find_map(|mut peer| {
            peer.set_port(origin.port);
            us_quic_is_routable(&peer.into()).then_some(())?;
            self.connect_to(peer, origin, context)
        });
        lookup.is_useful = connection.is_some();
        connection
    }

    fn socket(&self) -> Option<Rc<Socket>> {
        let bind = |host: &ZStr| self.engine.bind(self, Some(host), 0, 0);
        (self.engine.sockets().pop().filter(|it| it.is_open()))
            .or_else(|| bind(zstr!("::")))
            .or_else(|| bind(zstr!("0.0.0.0")))
    }

    fn connect_to(
        &self,
        mut peer: SocketAddr,
        origin: &Origin,
        context: Context,
    ) -> Option<Connection> {
        let local = self.socket()?.local();
        peer.set_ip(or_loopback(peer.ip()));
        match peer.ip() {
            IpAddr::V4(ip) if local.is_ipv6() => peer.set_ip(ip.to_ipv6_mapped().into()),
            IpAddr::V6(_) if local.is_ipv4() => return None,
            _ => {}
        }
        let mut tls = Session::new(&self.tls, Side::Client)?;
        let (host, is_strict) = (
            ZBox::from_bytes(origin.hostname),
            origin.reject_unauthorized,
        );
        // Also an address, against RFC 6066 §3, as some servers do not find their certificate otherwise.
        if !tls.ssl().set_servername(&host) {
            return None;
        }
        tls.offer(Version::V1.http3_alpn())?;
        tls.verify_with(Box::new(move |ssl| {
            // SAFETY: `host` is a string.
            !is_strict || unsafe { us_quic_is_server_authorized(ssl, host.as_ptr()) }
        }));
        let (config, addresses) = (Rc::clone(&self.config), Addresses { local, peer });
        let handle = (self.engine.endpoint()).connect(now(), config, addresses, Box::new(tls), &[]);
        let connection = self.engine.track(handle);
        connection.update(|it| it.context = context);
        Some(connection)
    }
}
