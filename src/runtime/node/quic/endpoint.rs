//! Node's `internalBinding('quic').Endpoint` analog (node/src/quic/endpoint.{h,cc}).

use core::cell::{Cell, RefCell, RefMut};
use core::ffi::{c_int, c_void};
use core::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV6};
use core::ptr::null_mut;
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;

use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::smallvec::SmallVec;
use bun_io::KeepAlive;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{
    self as jsc, ArrayBuffer, JSGlobalObject, JSType, JSValue, JsCell, JsRef, JsResult, StringJsc,
};
use bun_ptr::BackRef;
use bun_quic::{
    Addresses, Algorithm, Batch, Config, Duration, FieldLimits, Http3Config, Incoming, Instant,
    PreferredAddress, Side, TokenBucket, Unrouted, Version,
};
use bun_uws as uws;
use bun_uws::quic::drivers::{Driver, Order, Registration};
use bun_uws::quic::io::{self, Binding, Outbox, now, or_loopback};

use crate::jsc_hooks::timer_all;
use crate::socket::SocketAddress;
use crate::timer::{EventLoopTimerTag, OwnedTimer};

use super::callbacks;
use super::now_ns;
use super::session::{
    Application, CRYPTO_ERROR_HANDSHAKE_FAILURE, CloseType, QuicSession, SessionEvent,
    address_to_js,
};
use super::tls::TlsConfig;

/// Mirrors Node's `Endpoint::State`.
#[repr(C)]
pub(crate) struct EndpointState {
    pub bound: u8,
    pub(crate) receiving: u8,
    pub(crate) listening: u8,
    pub(crate) closing: u8,
    pub(crate) busy: u8,
    pub(crate) max_connections_per_host: u16,
    pub(crate) max_connections_total: u16,
    pub(crate) pending_callbacks: u64,
}

pub(crate) const ENDPOINT_STATS_FIELDS: &[&str] = &[
    "CREATED_AT",
    "DESTROYED_AT",
    "BYTES_RECEIVED",
    "BYTES_SENT",
    "PACKETS_RECEIVED",
    "PACKETS_SENT",
    "SERVER_SESSIONS",
    "CLIENT_SESSIONS",
    "SERVER_BUSY_COUNT",
    "RETRY_COUNT",
    "RETRY_RATE_LIMITED",
    "VERSION_NEGOTIATION_COUNT",
    "VERSION_NEGOTIATION_RATE_LIMITED",
    "STATELESS_RESET_COUNT",
    "STATELESS_RESET_RATE_LIMITED",
    "IMMEDIATE_CLOSE_COUNT",
    "IMMEDIATE_CLOSE_RATE_LIMITED",
    "SESSION_CREATION_RATE_LIMITED",
    "PACKETS_BLOCKED",
];
const IDX_STATS_SERVER_BUSY_COUNT: usize = 8;
const IDX_STATS_STATELESS_RESET_COUNT: usize = 13;
const IDX_STATS_STATELESS_RESET_RATE_LIMITED: usize = 14;
const VERSIONS: &[Version] = &[Version::V1, Version::V2];
/// Matches Node's 1200-byte default.
const DEFAULT_DATAGRAM_FRAME_SIZE: u64 = 1200;
/// RFC 9000 §18.2.
const MIN_UDP_PAYLOAD_SIZE: u64 = 1200;
const RAW_CLIENT_MAX_STREAMS_UNI: u64 = 100;
const MAX_HEADER_LENGTH: usize = 0xff_ffff;
/// For a field section, of which what is beyond `maxHeaderLength` is dropped.
const MIN_TOLERATED_HEADER_LENGTH: usize = 128 * 1024;
/// node/src/quic/endpoint.h.
const DEFAULT_STATELESS_RESET_RATE: f64 = 100.0;
const DEFAULT_STATELESS_RESET_BURST: f64 = 200.0;
const VERNEG_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// After which the rest of the loop gets its turn.
const MAX_ROUNDS: usize = 16;
const MAX_REFILLS: usize = 8;
const MAX_REFILL_TIME: Duration = Duration::from_millis(2);

const IDX_STATS_CREATED_AT: usize = 0;
const IDX_STATS_DESTROYED_AT: usize = 1;
const IDX_STATS_BYTES_RECEIVED: usize = 2;
const IDX_STATS_BYTES_SENT: usize = 3;
const IDX_STATS_PACKETS_RECEIVED: usize = 4;
const IDX_STATS_PACKETS_SENT: usize = 5;
const IDX_STATS_SERVER_SESSIONS: usize = 6;
const IDX_STATS_CLIENT_SESSIONS: usize = 7;
const IDX_STATS_PACKETS_BLOCKED: usize = 18;

pub(crate) const CLOSECONTEXT_CLOSE: u8 = 0;
pub(crate) const CLOSECONTEXT_BIND_FAILURE: u8 = 1;
pub(crate) const CLOSECONTEXT_START_FAILURE: u8 = 2;
pub(crate) const CLOSECONTEXT_RECEIVE_FAILURE: u8 = 3;
pub(crate) const CLOSECONTEXT_SEND_FAILURE: u8 = 4;
pub(crate) const CLOSECONTEXT_LISTEN_FAILURE: u8 = 5;

const PREFERRED_ADDRESS_USE: u64 = 1;
/// Node's `DEFAULT_MAX_IDLE_TIMEOUT` (node/src/quic/transportparams.h), in the
/// seconds unit `transportParams.maxIdleTimeout` uses.
const DEFAULT_MAX_IDLE_TIMEOUT_SECS: u64 = 10;
pub(super) const MS_PER_SEC: u64 = 1_000;

pub(super) fn socket_address(address: SocketAddr) -> SocketAddress {
    match address.ip() {
        IpAddr::V4(ip) => SocketAddress::init_ipv4(ip.octets(), address.port()),
        IpAddr::V6(ip) => SocketAddress::init_ipv6(ip.octets(), address.port(), 0, 0),
    }
}

fn address_from_js(value: JSValue) -> Option<SocketAddr> {
    let address = value.as_class_ref::<SocketAddress>()?;
    Some(match address._addr.as_sin6() {
        Some(it) => SocketAddrV6::new(it.addr.into(), address.port(), 0, it.scope_id).into(),
        None => (address._addr.as_v4()?.to_ne_bytes(), address.port()).into(),
    })
}

type SniContexts = RefCell<Vec<(Vec<u8>, OwnedSslCtx)>>;

struct Server {
    config: Rc<Config>,
    tls: OwnedSslCtx,
    alpn: Rc<[u8]>,
    allows_early_data: bool,
}

pub(crate) struct QuicEndpoint {
    /// Borrowed views into JSC-owned ArrayBuffers (the wrapper owns both the
    /// ArrayBuffer and this struct, so the pointers are valid for our life).
    state: *mut EndpointState,
    stats: *mut u64,
    pub(super) closing: Cell<bool>,
    closed: Cell<bool>,

    socket: Cell<Option<uws::udp::OwnedSocket>>,
    binding: Cell<Option<Binding>>,
    bind_address: SocketAddr,
    local_addr: Cell<Option<SocketAddr>>,
    poll_ref: KeepAlive,
    pub(crate) this_value: JsCell<JsRef>,

    /// For both roles — Node allows that.
    quic: RefCell<bun_quic::Endpoint>,
    outbox: RefCell<Outbox>,
    server: JsCell<Option<Server>>,
    sni_contexts: Rc<SniContexts>,
    pub(super) server_verify_client: Cell<bool>,
    server_session_options: JsCell<Option<bun_jsc::Strong>>,
    stateless_resets: Option<RefCell<TokenBucket>>,

    processing: Cell<bool>,
    /// An iteration of the loop. What has been sent until then is received first, if it is for this process.
    followup_after: Cell<Option<u64>>,
    wake_at: Cell<Option<Instant>>,
    /// In the order of their addresses.
    sessions: JsCell<Vec<*mut QuicSession>>,
    /// The ones that the next pass has to see to.
    marked_sessions: JsCell<VecDeque<*mut QuicSession>>,
    sessions_per_host: RefCell<BTreeMap<IpAddr, usize>>,
    pending_new_sessions: JsCell<VecDeque<*mut QuicSession>>,
    pending_verneg: JsCell<Vec<(*mut QuicSession, [u8; VERNEG_PROBE_CID_LEN], Instant)>>,
    block_list: Cell<Option<*mut crate::node::net::block_list::BlockList>>,
    _block_list_js: Option<bun_jsc::Strong>,
    block_list_allow: Cell<bool>,
    pub(crate) event_loop_timer: OwnedTimer,
    pending_endpoint_close: Cell<bool>,
    close_context: Cell<u8>,
    /// Registered with the loop while this endpoint holds a socket.
    driver: JsCell<Option<(Rc<LoopDriver>, Registration)>>,
    driver_pending: Cell<bool>,
    /// Set while the pass runs from the microtask drain: session Closed events
    /// are requeued for the next loop point instead of dispatching mid-chain.
    pub(super) defer_closes: Cell<bool>,
    /// Native-entry depth, node's Session::SendPendingDataScope. Non-zero means
    /// a native callback (on_data, the driver) is on the stack and owns the
    /// flush when it unwinds.
    send_scope_depth: Cell<u32>,

    global: *const JSGlobalObject,
}

struct LoopDriver(BackRef<QuicEndpoint>);

impl Driver for LoopDriver {
    /// The writes a JS turn queued leave as one batch.
    fn process(&self) {
        self.0.run_driver_pass(false);
    }

    /// Session close events hold until the next loop point, so a running microtask chain never
    /// observes a session ending mid-chain (node's loop never interleaves that way).
    fn flush(&self) {
        self.0.run_driver_pass(true);
    }

    fn timeout(&self) -> Option<Instant> {
        match self.0.has_pass_pending() || self.0.followup_after.get().is_some() {
            true => Some(Instant::default()),
            false => self.0.timeout(),
        }
    }
}

impl QuicEndpoint {
    /// Not to be held on to while JavaScript runs or allocates.
    pub(super) fn quic(&self) -> RefMut<'_, bun_quic::Endpoint> {
        self.wake();
        self.quic.borrow_mut()
    }

    fn wake(&self) {
        match self.driver.get() {
            Some((_, registration)) if self.has_pass_pending() => registration.wake(),
            Some((_, registration)) => registration.forget_timeout(),
            None => {}
        }
    }

    pub(super) fn mark_driver_pending(&self) {
        self.driver_pending.set(true);
        self.wake();
    }

    /// `defer_closes` distinguishes the microtask-drain pass, which must not
    /// let a session end mid-chain, from the loop_pre/loop_post pass.
    fn run_driver_pass(&self, defer_closes: bool) {
        if self.has_pass_pending() || !defer_closes && self.is_pass_due() {
            self.driver_pending.set(false);
            self.defer_closes.set(defer_closes);
            self.process();
            self.defer_closes.set(false);
        }
    }

    /// A pass that is on the stack flushes at its end.
    fn has_pass_pending(&self) -> bool {
        self.driver_pending.get() && !self.scope_held()
    }

    fn plan_followup(&self) {
        (self.followup_after).set(Some(uws::Loop::get().iteration_number() + 1));
        self.wake();
    }

    /// Every pass forgets it.
    pub(super) fn plan_pass(&self, at: Instant) {
        self.wake_at.update(|it| Some(it.unwrap_or(at).min(at)));
        self.wake();
    }

    fn is_pass_due(&self) -> bool {
        (self.followup_after.get()).is_some_and(|it| it < uws::Loop::get().iteration_number())
            || self.timeout().is_some_and(|it| it <= now())
    }

    fn timeout(&self) -> Option<Instant> {
        let probes = self.pending_verneg.get().iter().map(|it| it.2);
        (probes
            .chain(self.wake_at.get())
            .chain(self.quic.borrow_mut().timeout()))
        .min()
    }

    fn global<'a>(&self) -> &'a JSGlobalObject {
        // SAFETY: the realm that created this endpoint outlives it.
        unsafe { &*self.global }
    }

    fn of<'a>(socket: *mut uws::udp::Socket) -> &'a Self {
        // SAFETY: it closes the socket before it goes away.
        unsafe { &*uws::udp::Socket::opaque_mut(socket).user().cast() }
    }
}

bun_event_loop::impl_timer_owner!(QuicEndpoint; from_timer_ptr => event_loop_timer);

extern "C" fn on_drain(_socket: *mut uws::udp::Socket) {
    for endpoint in registered_endpoints() {
        if endpoint.outbox.borrow().is_blocked() {
            endpoint.outbox.borrow_mut().unblock();
            endpoint.mark_driver_pending();
        }
    }
}

extern "C" fn on_close(socket: *mut uws::udp::Socket) {
    for endpoint in registered_endpoints() {
        if endpoint.binding.get().is_some_and(|it| it.socket == socket) {
            let _ = endpoint.socket.take().map(uws::udp::OwnedSocket::into_raw);
            endpoint.binding.set(None);
            endpoint.closing.set(true);
            endpoint.close_context.set(CLOSECONTEXT_RECEIVE_FAILURE);
            endpoint.abort_connections();
            endpoint.plan_followup();
        }
    }
    on_drain(socket);
}

thread_local! {
    /// A server may advertise another local endpoint's address as its
    /// preferred_address (RFC 9000 sec 9.6).
    static ENDPOINT_REGISTRY: RefCell<Vec<BackRef<QuicEndpoint>>> = const { RefCell::new(Vec::new()) };
}

/// They are live until JavaScript runs.
fn registered_endpoints() -> SmallVec<[BackRef<QuicEndpoint>; 4]> {
    ENDPOINT_REGISTRY.with_borrow(|v| SmallVec::from_slice(v))
}

/// Of a long header (RFC 8999 §5.1).
const HEADER_FORM_AND_FIXED_BITS: u8 = 0xc0;
const VERNEG_PROBE_CID_LEN: usize = 8;
/// RFC 9000 sec 14.1: servers may drop Initial-like datagrams smaller than
/// 1200 bytes, so the probe pads to the minimum.
const VERNEG_PROBE_LEN: usize = 1200;

fn on_data(socket: *mut uws::udp::Socket, packets: uws::udp::Packets<'_>) {
    let this = QuicEndpoint::of(socket);
    let Some(binding) = this.binding.get() else {
        return;
    };
    // Apply a stashed close before feeding: a closing peer discards new
    // streams rather than announcing them (RFC 9000 s10.2.1).
    if this.flush_pending_graceful() {
        this.drive_once();
    }
    // A graceful close a handler queues during this dispatch must not join the
    // same flight as the data the handlers wrote (sessions stash it; the next
    // depth-0 pass applies it).
    let _send_scope = this.send_scope();
    let now = now();
    let receive = |from: &Addresses, payload: &mut [u8]| {
        this.add_stat(IDX_STATS_PACKETS_RECEIVED, 1);
        this.add_stat(IDX_STATS_BYTES_RECEIVED, payload.len() as u64);
        if !this.peer_blocked(from.peer) && !this.handle_version_negotiation(payload) {
            this.receive(now, from, payload);
        }
    };
    let read = binding.for_each_datagram(packets, receive);
    let reads_on = this.outbox.borrow_mut().reads_on(&read, &this.quic());
    // The more is acknowledged, the more can be sent together.
    if reads_on {
        this.mark_driver_pending();
    } else {
        this.process();
    }
}

/// Node's SNI resolution order: exact hostname, then a `*.suffix` wildcard,
/// then the `*` default. Comparison is ASCII-case-insensitive (RFC 6066).
fn match_sni<'a>(entries: &'a [(Vec<u8>, OwnedSslCtx)], host: &[u8]) -> Option<&'a OwnedSslCtx> {
    let eq = |a: &[u8], b: &[u8]| a.eq_ignore_ascii_case(b);
    if let Some((_, ctx)) = entries.iter().find(|(h, _)| eq(h, host)) {
        return Some(ctx);
    }
    if let Some(dot) = bun_core::strings::index_of_char_usize(host, b'.') {
        let suffix = &host[dot..];
        if let Some((_, ctx)) = entries
            .iter()
            .find(|(h, _)| h.first() == Some(&b'*') && h.len() > 1 && eq(&h[1..], suffix))
        {
            return Some(ctx);
        }
    }
    entries
        .iter()
        .find(|(h, _)| h.as_slice() == b"*")
        .map(|(_, ctx)| ctx)
}

pub(super) fn read_u64_option(
    global: &JSGlobalObject,
    obj: JSValue,
    name: &str,
) -> JsResult<Option<u64>> {
    match obj
        .get(global, name)?
        .filter(|v| v.is_number() || v.is_big_int())
    {
        Some(v) if v.is_number() => Ok(Some(v.as_number().max(0.0) as u64)),
        Some(v) => Ok(Some(v.to_uint64_no_truncate())),
        None => Ok(None),
    }
}

fn config_from_js(
    global: &JSGlobalObject,
    options: JSValue,
    side: Side,
    is_http3: bool,
) -> JsResult<Config> {
    let (server, client) = (Config::server(), Config::client());
    let mut config = Config {
        versions: VERSIONS,
        progress_timeout: Duration::ZERO,
        keep_alive: bun_quic::KeepAlive::Never,
        // Node's `closed` promise on the peer resolves on receipt of CONNECTION_CLOSE.
        closes_silently: false,
        adapts_ack_frequency: false,
        wants_tickets: true,
        has_priorities: is_http3,
        sends_in_order: true,
        awaits_consumption: true,
        closes_when_sent: true,
        ..if side.is_server() { server } else { client }
    };
    let parameters = &mut config.parameters;
    let window = (parameters.initial_max_stream_data_bidi_local)
        .max(parameters.initial_max_stream_data_bidi_remote);
    parameters.initial_max_stream_data_bidi_local = window;
    parameters.initial_max_stream_data_bidi_remote = window;
    parameters.max_idle_timeout_millis = DEFAULT_MAX_IDLE_TIMEOUT_SECS * MS_PER_SEC;
    parameters.max_datagram_frame_size = DEFAULT_DATAGRAM_FRAME_SIZE;
    if !is_http3 {
        parameters.initial_max_stream_data_uni = window;
    }
    if side.is_client() && !is_http3 {
        parameters.initial_max_streams_uni = RAW_CLIENT_MAX_STREAMS_UNI;
    }
    if let Some(tp) = options
        .get(global, "transportParams")?
        .filter(|v| v.is_object())
    {
        apply_transport_params(global, tp, parameters, side)?;
    }
    if let Some(ms) = read_u64_option(global, options, "handshakeTimeout")? {
        config.handshake_timeout = Duration::from_millis(ms);
    }
    if let Some(ms) = read_u64_option(global, options, "keepAlive")? {
        config.keep_alive = bun_quic::KeepAlive::Every(Duration::from_millis(ms));
    }
    config.uses_preferred_address =
        read_u64_option(global, options, "preferredAddressPolicy")? == Some(PREFERRED_ADDRESS_USE);
    if let Some(cc) = options.get(global, "cc")?.filter(|v| v.is_string()) {
        let name = bun_core::String::from_js(cc, global)?;
        // Cubic is the closest there is to Reno.
        if name.eq_ascii(b"cubic") || name.eq_ascii(b"reno") {
            config.congestion = Algorithm::Cubic;
        }
    }
    if is_http3 {
        let mut http3 = http3_config_from_js(global, options)?;
        http3.datagrams &= config.parameters.max_datagram_frame_size > 0;
        config.http3 = Some(http3);
    }
    Ok(config)
}

fn apply_transport_params(
    global: &JSGlobalObject,
    tp: JSValue,
    parameters: &mut bun_quic::TransportParameters,
    side: Side,
) -> JsResult<()> {
    for (name, value) in [
        (
            "initialMaxStreamDataBidiLocal",
            &mut parameters.initial_max_stream_data_bidi_local,
        ),
        (
            "initialMaxStreamDataBidiRemote",
            &mut parameters.initial_max_stream_data_bidi_remote,
        ),
        (
            "initialMaxStreamDataUni",
            &mut parameters.initial_max_stream_data_uni,
        ),
        ("initialMaxData", &mut parameters.initial_max_data),
        (
            "initialMaxStreamsBidi",
            &mut parameters.initial_max_streams_bidi,
        ),
        (
            "initialMaxStreamsUni",
            &mut parameters.initial_max_streams_uni,
        ),
        (
            "maxDatagramFrameSize",
            &mut parameters.max_datagram_frame_size,
        ),
    ] {
        if let Some(v) = read_u64_option(global, tp, name)? {
            *value = v.min(u32::MAX.into());
        }
    }
    if let Some(secs) = read_u64_option(global, tp, "maxIdleTimeout")? {
        // Node's maxIdleTimeout is SECONDS: transportparams.cc:197 stores
        // `max_idle_timeout * NGTCP2_SECONDS`; the getter at :473 divides
        // it back out.
        parameters.max_idle_timeout_millis = secs.saturating_mul(MS_PER_SEC).min(u32::MAX.into());
    }
    match read_u64_option(global, tp, "maxUdpPayloadSize")? {
        None | Some(0) => {}
        Some(v @ ..MIN_UDP_PAYLOAD_SIZE) => {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The property 'options.transportParams.maxUdpPayloadSize' must be at least {MIN_UDP_PAYLOAD_SIZE}. Received {v}"
                    ),
                )
                .throw());
        }
        Some(v) => parameters.max_udp_payload_size = parameters.max_udp_payload_size.min(v),
    }
    if let Some(v) = tp.get(global, "disableActiveMigration")? {
        parameters.disable_active_migration = v.to_boolean();
    }
    let ipv4 = match (tp.get(global, "preferredAddressIpv4")?).and_then(address_from_js) {
        Some(SocketAddr::V4(address)) => Some(address),
        _ => None,
    };
    let ipv6 = match (tp.get(global, "preferredAddressIpv6")?).and_then(address_from_js) {
        Some(SocketAddr::V6(address)) => Some(address),
        _ => None,
    };
    if side.is_server() && (ipv4.is_some() || ipv6.is_some()) {
        parameters.preferred_address = Some(PreferredAddress::new(ipv4, ipv6));
    }
    Ok(())
}

fn http3_config_from_js(global: &JSGlobalObject, options: JSValue) -> JsResult<Http3Config> {
    let mut config = Http3Config {
        kept_fields: FieldLimits {
            size: MAX_HEADER_LENGTH,
            count: usize::MAX,
        },
        // nghttp3_http.c, `http_response_on_header`
        tolerates_te_anywhere: true,
        datagrams: true,
        ..Http3Config::default()
    };
    if let Some(app) = options
        .get(global, "application")?
        .filter(|v| v.is_object())
    {
        let boolean = |name| JsResult::Ok(app.get(global, name)?.filter(|v| v.is_boolean()));
        if let Some(v) = boolean("enableConnectProtocol")? {
            config.connect_protocol = v.to_boolean();
        }
        if let Some(v) = boolean("enableDatagrams")? {
            config.datagrams = v.to_boolean();
        }
        if let Some(v @ 1..) = read_u64_option(global, app, "maxHeaderPairs")? {
            config.kept_fields.count = v.min(u16::MAX.into()) as usize;
        }
        if let Some(v @ 1..) = read_u64_option(global, app, "maxHeaderLength")? {
            config.kept_fields.size = v.min(MAX_HEADER_LENGTH as u64) as usize;
        }
    }
    config.tolerated_fields = FieldLimits {
        size: (2 * config.kept_fields.size).max(MIN_TOLERATED_HEADER_LENGTH),
        count: usize::MAX,
    };
    Ok(config)
}

/// RFC 9412 §2: each Origin-Entry is a 16-bit length prefix followed by the ASCII origin.
fn origins_from_js(global: &JSGlobalObject, tls: JSValue) -> JsResult<Vec<u8>> {
    let mut payload = Vec::new();
    if let Some(origins) = tls.get(global, "origins")?.filter(|v| v.is_array()) {
        for i in 0..origins.get_length(global)? as u32 {
            let v = origins.get_index(global, i)?;
            if !v.is_string() {
                continue;
            }
            let bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
            if let Ok(len @ 1..) = u16::try_from(bytes.len()) {
                payload.extend_from_slice(&len.to_be_bytes());
                payload.extend_from_slice(&bytes);
            }
        }
    }
    Ok(payload)
}

fn application_of(config: &Config) -> Application {
    match config.http3 {
        Some(_) => Application::Http3,
        None => Application::Default,
    }
}

pub(super) fn alloc_exposed_array_buffer(
    global: &JSGlobalObject,
    holder: JSValue,
    name: &[u8],
    size: usize,
) -> JsResult<*mut u8> {
    let zeroes = vec![0u8; size];
    let buf = ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global, &zeroes)?;
    let Some(view) = buf.as_array_buffer(global) else {
        return Err(global.throw(format_args!("Failed to allocate QUIC state buffer")));
    };
    holder.put(global, name, buf);
    Ok(view.ptr)
}

impl QuicEndpoint {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        options: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let mut bind_address = (Ipv4Addr::LOCALHOST, 0).into();
        let mut block_list = None;
        let mut block_list_js = None;
        let mut block_list_allow = false;
        let mut disable_stateless_reset = false;
        let mut stateless_reset_burst = DEFAULT_STATELESS_RESET_BURST;
        let mut stateless_reset_rate = DEFAULT_STATELESS_RESET_RATE;
        let options = options.to_js();
        if options.is_object() {
            let global = cx.global();
            if let Some(address) = options.get(global, "address")?.and_then(address_from_js) {
                bind_address = address;
            }
            if let Some(bl_js) = options.get(global, "blockList")?.filter(|v| v.is_object()) {
                if let Some(bl) =
                    crate::generated_bindgen::block_list::js_BlockList::from_js(&bl_js)
                {
                    block_list = Some(bl.as_ptr());
                    block_list_js = Some(bun_jsc::Strong::create(bl_js, global));
                }
            }
            if let Some(policy) = options
                .get(global, "blockListPolicy")?
                .filter(|v| v.is_string())
            {
                let policy = bun_core::String::from_js(policy, global)?.to_owned_slice();
                block_list_allow = policy == b"allow";
            }
            if let Some(v) = options
                .get(global, "disableStatelessReset")?
                .filter(|v| v.is_boolean())
            {
                disable_stateless_reset = v.to_boolean();
            }
            if let Some(v) = options
                .get(global, "statelessResetBurst")?
                .filter(|v| v.is_number())
            {
                stateless_reset_burst = v.as_number();
            }
            if let Some(v) = options
                .get(global, "statelessResetRate")?
                .filter(|v| v.is_number())
            {
                stateless_reset_rate = v.as_number().min(f64::MAX);
            }
        }

        let this = QuicEndpoint {
            state: null_mut(),
            stats: null_mut(),
            closing: Cell::new(false),
            closed: Cell::new(false),
            socket: Cell::new(None),
            binding: Cell::new(None),
            bind_address,
            local_addr: Cell::new(None),
            poll_ref: KeepAlive::init(),
            this_value: JsCell::new(JsRef::empty()),
            quic: RefCell::new(bun_quic::Endpoint::new(&bun_quic_tls::BoringSsl)),
            outbox: RefCell::default(),
            server: JsCell::new(None),
            sni_contexts: Rc::default(),
            server_verify_client: Cell::new(false),
            server_session_options: JsCell::new(None),
            stateless_resets: (!disable_stateless_reset)
                .then(|| TokenBucket::new(stateless_reset_rate, stateless_reset_burst).into()),
            processing: Cell::new(false),
            followup_after: Cell::new(None),
            wake_at: Cell::new(None),
            sessions: JsCell::new(Vec::new()),
            marked_sessions: JsCell::new(VecDeque::new()),
            sessions_per_host: RefCell::default(),
            pending_new_sessions: JsCell::new(VecDeque::new()),
            pending_verneg: JsCell::new(Vec::new()),
            block_list: Cell::new(block_list),
            _block_list_js: block_list_js,
            block_list_allow: Cell::new(block_list_allow),
            event_loop_timer: OwnedTimer::init_paused(EventLoopTimerTag::QuicEndpoint),
            pending_endpoint_close: Cell::new(false),
            close_context: Cell::new(CLOSECONTEXT_CLOSE),
            driver: JsCell::new(None),
            driver_pending: Cell::new(false),
            defer_closes: Cell::new(false),
            send_scope_depth: Cell::new(0),
            global: cx.global(),
        };
        let this_value = structure.create(&cx.heap, this);
        let js_value = this_value.to_js();
        let raw: *mut Self = this_value.payload_ptr().as_ptr();
        let global = cx.global();

        let state_ptr = alloc_exposed_array_buffer(
            global,
            js_value,
            b"state",
            core::mem::size_of::<EndpointState>(),
        )?;
        let stats_ptr = alloc_exposed_array_buffer(
            global,
            js_value,
            b"stats",
            ENDPOINT_STATS_FIELDS.len() * core::mem::size_of::<u64>(),
        )?;
        js_value.put(global, b"stateByteOffset", JSValue::js_number(0.0));
        js_value.put(global, b"statsByteOffset", JSValue::js_number(0.0));
        // SAFETY: `state`/`stats` are write-once before any other access.
        unsafe {
            (*raw).state = state_ptr.cast();
            (*raw).stats = stats_ptr.cast();
            (*raw).write_stat(IDX_STATS_CREATED_AT, now_ns());
        }

        Ok(this_value)
    }

    fn state_mut(&self) -> *mut EndpointState {
        self.state
    }
    /// Run `f` against the shared state buffer. The buffer is a JSC
    /// ArrayBuffer owned by the JS wrapper: it is allocated at construction
    /// before any other method can run, outlives `self` (the wrapper keeps
    /// both alive), and is only touched from the JS thread — so the single
    /// raw access below is in-bounds and unaliased.
    fn with_state<R>(&self, f: impl FnOnce(&mut EndpointState) -> R) -> R {
        // SAFETY: see doc comment.
        unsafe { f(&mut *self.state_mut()) }
    }
    /// Upgrade a session pointer to a reference, verifying it is still in
    /// the `sessions` registry — `unregister_session` always precedes the
    /// session's teardown and `Drop`, so a registered pointer is live on the
    /// JS thread.
    fn live_session(&self, p: *mut QuicSession) -> Option<&QuicSession> {
        // SAFETY: see doc comment.
        (self.sessions.get().binary_search(&p).ok()).map(|_| unsafe { &*p })
    }
    pub(super) fn mark(&self, session: &QuicSession) {
        if !session.is_marked.replace(true) {
            let session = core::ptr::from_ref(session).cast_mut();
            self.marked_sessions.with_mut(|v| v.push_back(session));
        }
    }
    fn marked_sessions(&self) -> impl Iterator<Item = &QuicSession> {
        let marked = (0..).map_while(|at| self.marked_sessions.get().get(at).copied());
        marked.filter_map(|it| self.live_session(it))
    }
    fn register_session(&self, session: &QuicSession) -> *mut QuicSession {
        let session = core::ptr::from_ref(session).cast_mut();
        self.sessions.with_mut(|v| {
            let at = v.partition_point(|&it| it < session);
            v.insert(at, session);
        });
        session
    }
    fn write_stat(&self, idx: usize, value: u64) {
        if !self.stats.is_null() && idx < ENDPOINT_STATS_FIELDS.len() {
            // SAFETY: `stats` is a live `[u64; N]` view.
            unsafe { *self.stats.add(idx) = value };
        }
    }
    fn add_stat(&self, idx: usize, value: u64) {
        if !self.stats.is_null() && idx < ENDPOINT_STATS_FIELDS.len() {
            // SAFETY: as above.
            unsafe { *self.stats.add(idx) = (*self.stats.add(idx)).wrapping_add(value) };
        }
    }

    fn peer_blocked(&self, peer: SocketAddr) -> bool {
        let Some(bl) = self.block_list.get() else {
            return false;
        };
        // SAFETY: the Strong in `_block_list_js` keeps the wrapper (and
        // native object) alive for the endpoint's lifetime.
        let is_listed = unsafe { (*bl).check_sockaddr(&socket_address(peer)._addr) };
        let blocked = is_listed != self.block_list_allow.get();
        if blocked {
            self.add_stat(IDX_STATS_PACKETS_BLOCKED, 1);
        }
        blocked
    }

    /// Returns `Ok(false)` when the bind fails: Node does not throw here.
    fn ensure_bound(
        &self,
        global: &JSGlobalObject,
        this_value: JsWrapper<'_, Self>,
    ) -> JsResult<bool> {
        if self.local_addr.get().is_some() {
            return Ok(true);
        }
        let mut err: c_int = 0;
        let host = match self.bind_address {
            SocketAddr::V6(it) if it.scope_id() != 0 => format!("{}%{}", it.ip(), it.scope_id()),
            it => it.ip().to_string(),
        };
        let socket = uws::udp::Socket::create(
            uws::Loop::get(),
            on_data,
            on_drain,
            on_close,
            None,
            Some(&bun_core::ZBox::from_bytes(host.as_bytes())),
            self.bind_address.port(),
            0,
            Some(&mut err),
            core::ptr::from_ref(self).cast_mut().cast::<c_void>(),
        );
        let Some(socket) = socket else {
            this_value.set_js_ref_strong(global);
            self.finish_close();
            self.pending_endpoint_close.set(false);
            self.deliver_endpoint_close(global, CLOSECONTEXT_BIND_FAILURE, err);
            return Ok(false);
        };
        let binding = Binding::new(socket.as_ptr());
        self.socket.set(Some(socket));
        self.binding.set(Some(binding));
        self.local_addr.set(Some(binding.address));
        let driver = Rc::new(LoopDriver(BackRef::new(self)));
        let registration = Registration::new(
            uws::Loop::get(),
            Rc::<LoopDriver>::downgrade(&driver),
            Order::Fixed,
        );
        self.driver.set(Some((driver, registration)));
        self.with_state(|s| {
            s.bound = 1;
            s.receiving = 1;
        });
        this_value.set_js_ref_strong(global);
        self.update_keepalive();
        ENDPOINT_REGISTRY.with_borrow_mut(|v| v.push(BackRef::new(self)));
        Ok(true)
    }

    fn update_keepalive(&self) {
        if self.closed.get() || self.local_addr.get().is_none() {
            return;
        }
        let listening = self.with_state(|s| s.listening) != 0;
        let busy = listening || self.closing.get() || !self.sessions.get().is_empty();
        let ctx = bun_io::js_vm_ctx();
        if busy {
            self.poll_ref.ref_(ctx);
        } else {
            self.poll_ref.unref(ctx);
        }
    }

    fn flush_pending_graceful(&self) -> bool {
        let sessions = self.marked_sessions();
        sessions.filter(|it| it.flush_pending_graceful()).count() > 0
    }

    /// A writer only hands over so much at a time, which may be less than there is room for.
    fn process(&self) {
        if self.closed.get() || self.processing.get() {
            return;
        }
        // Every callback runs user JS that can synchronously destroy
        // sessions and (via close()) drop the endpoint's wrapper Strong;
        // hold one for the duration so `self` survives GC.
        let _keep_alive = bun_jsc::Strong::create(self.this_value.get().get(), self.global());
        let (deadline, defers_closes) = (now() + MAX_REFILL_TIME, self.defer_closes.get());
        for _ in 0..=MAX_REFILLS {
            self.process_once();
            if self.closed.get()
                || !self.marked_sessions().any(QuicSession::owes_drain)
                || self.outbox.borrow().is_pass_over()
                || now() > deadline
            {
                break;
            }
            self.defer_closes.set(true);
        }
        self.defer_closes.set(defers_closes);
    }

    fn process_once(&self) {
        // A depth-0 pass runs after the previous flight left the socket: safe
        // point for graceful closes stashed during a dispatch.
        if !self.scope_held() {
            self.flush_pending_graceful();
        }
        let send_scope = self.send_scope();
        self.followup_after.set(None);
        self.wake_at.set(None);
        self.drive_once();

        let global = self.global();
        while let Some(session) = self.pending_new_sessions.with_mut(VecDeque::pop_front) {
            let Some(session) = self.live_session(session) else {
                continue;
            };
            let handle = session.handle();
            callbacks::run(
                global,
                "onSessionNew",
                self.this_value.get().get(),
                &[handle],
            );
        }
        for _ in 0..self.marked_sessions.get().len() {
            let session = self.marked_sessions.with_mut(VecDeque::pop_front);
            if let Some(session) = session.and_then(|it| self.live_session(it)) {
                session.is_marked.set(false);
                session.process_events(global);
            }
        }
        self.sweep_verneg_probes();
        self.update_keepalive();
        if self.closing.get() && self.is_drained() && !self.closed.get() {
            self.finish_close();
        }
        drop(send_scope);
        // Writes made by the dispatch above could not flush inline (the scope
        // was held). Send them at the pass's outer edge, where node's
        // SendPendingDataScope flushes, not a loop turn later.
        if self.driver_pending.take() {
            self.drive_once();
        }
        if self.marked_sessions().any(QuicSession::has_events) {
            self.plan_followup();
        }
    }

    fn is_drained(&self) -> bool {
        self.sessions.get().is_empty() && self.quic().connection_count() == 0
    }

    /// Whether a native dispatch (on_data, process) is on the stack.
    pub(super) fn scope_held(&self) -> bool {
        self.send_scope_depth.get() != 0
    }

    pub(super) fn schedule_process(&self) {
        if self.closed.get() {
            return;
        }
        self.plan_followup();
        // Flush at the outermost native exit (node's SendPendingDataScope):
        // a response must leave before a later handler's close, or the control
        // stream's priority puts GOAWAY ahead of the data.
        if !self.scope_held() {
            self.drive_once();
        }
        // The loop driver dispatches what the flush queued at the next loop point.
        self.mark_driver_pending();
    }

    pub(crate) fn on_timer_fire(this: *mut Self) {
        // SAFETY: the timer heap only holds timers of live endpoints.
        let this_ref = unsafe { &*this };
        if this_ref.pending_endpoint_close.replace(false) {
            this_ref.deliver_endpoint_close(this_ref.global(), this_ref.close_context.get(), 0);
        }
    }

    fn receive(&self, now: Instant, from: &Addresses, datagram: &mut [u8]) {
        let accepted = self.server.get().as_ref().map_or(&[][..], |_| VERSIONS);
        let unrouted = self.quic().receive(now, from, datagram, accepted);
        match unrouted {
            Some(Unrouted::Incoming(incoming)) => {
                if let Err(err) = self.accept(now, from.peer, incoming) {
                    crate::dispatch::fold(Err(err));
                }
            }
            Some(Unrouted::Stray(stray)) => self.on_stray(now, from, stray),
            None => {}
        }
    }

    fn on_stray(&self, now: Instant, from: &Addresses, stray: &mut [u8]) {
        for other in registered_endpoints() {
            if !core::ptr::eq(other.get(), self)
                && !other.peer_blocked(from.peer)
                && other.quic().receive(now, from, stray, &[]).is_none()
            {
                return other.mark_driver_pending();
            }
        }
        let Some(mut bucket) = self.stateless_resets.as_ref().map(RefCell::borrow_mut) else {
            return;
        };
        if !bucket.take(now, 1) {
            self.add_stat(IDX_STATS_STATELESS_RESET_RATE_LIMITED, 1);
        } else if self.quic().reset(now, from, stray) {
            self.add_stat(IDX_STATS_STATELESS_RESET_COUNT, 1);
        } else {
            bucket.put_back(1);
        }
    }

    /// Node announces server sessions at Initial receipt — before the
    /// handshake — so `onsession` precedes the client's `opened`.
    fn accept(&self, now: Instant, peer: SocketAddr, incoming: Incoming<'_>) -> JsResult<()> {
        let Some(server) = self.server.get().as_ref().filter(|_| !self.closing.get()) else {
            self.quic().refuse(incoming);
            return Ok(());
        };
        let (busy, max_conns) = self.with_state(|s| (s.busy, s.max_connections_total));
        if busy != 0
            || (1..=self.sessions.get().len()).contains(&max_conns.into())
            || !self.has_room_for(peer.ip().to_canonical())
        {
            self.quic().refuse(incoming);
            self.add_stat(IDX_STATS_SERVER_BUSY_COUNT, 1);
            return Ok(());
        }
        let Some(mut tls) = bun_quic_tls::Session::new(&server.tls, Side::Server) else {
            return Ok(());
        };
        tls.accept(Rc::clone(&server.alpn));
        let contexts = Rc::clone(&self.sni_contexts);
        tls.select_context_with(Box::new(move |name| {
            match_sni(&contexts.borrow(), name?).cloned()
        }));
        let (global, config) = (self.global(), Rc::clone(&server.config));
        let (session, _handle) = QuicSession::create(
            global,
            self,
            self.this_value.get().get(),
            true,
            application_of(&config),
        )?;
        let conn = self.quic().accept(now, incoming, config, Box::new(tls));
        session.bind(conn);
        let session_ptr = self.register_session(session);
        (self.pending_new_sessions).with_mut(|v| v.push_back(session_ptr));
        self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
        self.apply_server_session_options(global, session)
    }

    fn has_room_for(&self, host: IpAddr) -> bool {
        let count = self.sessions_per_host.borrow().get(&host).copied();
        let max = self.with_state(|s| s.max_connections_per_host);
        !(1..=count.unwrap_or(0)).contains(&max.into())
    }

    /// For a client whose address is validated. Returns false if it is one too many.
    pub(super) fn count_session(&self, session: &QuicSession, peer: SocketAddr) -> bool {
        let host = peer.ip().to_canonical();
        let has_room = self.has_room_for(host);
        session.host.set(Some(host));
        *self.sessions_per_host.borrow_mut().entry(host).or_default() += 1;
        has_room
    }

    /// RFC 9000 §6.1 makes the reply optional, and a probe is not sent again.
    fn sweep_verneg_probes(&self) {
        let now = now();
        let expired: Vec<_> =
            (self.pending_verneg).with_mut(|v| v.extract_if(.., |it| it.2 <= now).collect());
        for session in expired.iter().filter_map(|it| self.live_session(it.0)) {
            session.push_event(SessionEvent::Closed(Some((
                CloseType::Transport,
                CRYPTO_ERROR_HANDSHAKE_FAILURE,
                b"handshake failed".to_vec(),
            ))));
            self.plan_followup();
        }
    }

    fn send_scope(&self) -> SendScope<'_> {
        self.send_scope_depth.update(|depth| depth + 1);
        SendScope(self)
    }

    /// Sends what there is to send, and queues the events for JavaScript.
    pub(super) fn drive_once(&self) {
        if self.closed.get() || self.processing.replace(true) {
            return;
        }
        let _send_scope = self.send_scope();
        let now = now();
        self.quic().handle_timeouts(now, io::now);
        self.outbox.borrow_mut().start_pass(now);
        for _ in 0..MAX_ROUNDS {
            self.collect_events();
            self.transmit();
            if !self.quic().has_events() || self.outbox.borrow().is_pass_over() {
                break;
            }
        }
        if self.quic().has_events() || self.outbox.borrow().is_pass_over() {
            self.plan_followup();
        }
        self.processing.set(false);
    }

    /// For between two callbacks of `session`.
    pub(super) fn drive_if_overdue(&self, session: &QuicSession) {
        let is_busy = self.marked_sessions.get().len() > session.is_marked.get().into();
        if self.driver_pending.get() && self.outbox.borrow_mut().is_overdue(is_busy) {
            self.drive_once();
        }
    }

    fn collect_events(&self) {
        let now = now();
        loop {
            let Some((_, session, event)) = self.quic().poll_event(now) else {
                return;
            };
            // SAFETY: a session takes itself out before it can be collected.
            if let Some(session) = unsafe { session.cast::<QuicSession>().as_ref() } {
                session.on_event(event);
            }
        }
    }

    fn transmit(&self) {
        let binding = |local| {
            let of = |it: &QuicEndpoint| it.binding.get().filter(|it| it.has(local));
            of(self).or_else(|| registered_endpoints().iter().find_map(|it| of(it)))
        };
        let count = |batch: &Batch| {
            self.add_stat(IDX_STATS_PACKETS_SENT, batch.len() as u64);
            self.add_stat(IDX_STATS_BYTES_SENT, batch.bytes().len() as u64);
        };
        let visit = |conn: &bun_quic::Connection| {
            // SAFETY: a session takes itself out before it can be collected.
            if let Some(session) = unsafe { conn.context.cast::<QuicSession>().as_ref() } {
                session.on_activity(conn);
            }
        };
        (self.outbox.borrow_mut()).flush(&mut self.quic(), binding, visit, count);
    }

    pub(super) fn unregister_session(&self, session: &QuicSession) {
        if let Some(host) = session.host.take()
            && let Entry::Occupied(mut count) = self.sessions_per_host.borrow_mut().entry(host)
        {
            *count.get_mut() -= 1;
            if *count.get() == 0 {
                count.remove();
            }
        }
        let session = core::ptr::from_ref(session).cast_mut();
        let Ok(at) = self.sessions.get().binary_search(&session) else {
            return;
        };
        self.sessions.with_mut(|v| v.remove(at));
        self.pending_new_sessions
            .with_mut(|v| v.retain(|&s| s != session));
        self.pending_verneg
            .with_mut(|v| v.retain(|&(s, _, _)| s != session));
        self.plan_followup();
    }

    fn release_native(&self) -> bool {
        if self.closed.replace(true) {
            return false;
        }
        self.driver.set(None);
        self.event_loop_timer.disarm();
        ENDPOINT_REGISTRY.with_borrow_mut(|v| v.retain(|it| !core::ptr::eq(it.get(), self)));
        self.binding.set(None);
        self.socket.set(None);
        true
    }

    fn abort_connections(&self) {
        let mut quic = self.quic();
        for conn in quic.handles() {
            quic.get_mut(conn).map(bun_quic::Connection::abort_silently);
        }
    }

    fn teardown(&self) -> bool {
        if !self.release_native() {
            return false;
        }
        self.abort_connections();
        self.collect_events();
        self.server.set(None);
        self.sni_contexts.borrow_mut().clear();
        self.server_session_options.set(None);
        self.with_state(|s| {
            s.closing = 1;
            s.bound = 0;
            s.receiving = 0;
            s.listening = 0;
        });
        self.write_stat(IDX_STATS_DESTROYED_AT, now_ns());
        true
    }

    fn finish_close(&self) {
        if !self.teardown() {
            return;
        }
        // Defer onEndpointClose to the next turn (Node closes asynchronously).
        self.poll_ref.ref_(bun_io::js_vm_ctx());
        self.pending_endpoint_close.set(true);
        let next = bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, 1);
        timer_all().update(OwnedTimer::node(&raw const self.event_loop_timer), &next);
    }

    fn apply_server_session_options(
        &self,
        global: &JSGlobalObject,
        session: &QuicSession,
    ) -> JsResult<()> {
        if let Some(options) = self
            .server_session_options
            .get()
            .as_ref()
            .map(bun_jsc::Strong::get)
        {
            session.apply_options(global, options)?;
        }
        Ok(())
    }

    fn deliver_endpoint_close(&self, global: &JSGlobalObject, context: u8, status: c_int) {
        self.poll_ref.disable();
        callbacks::run(
            global,
            "onEndpointClose",
            self.this_value.get().get(),
            &[
                JSValue::js_number(context as f64),
                JSValue::js_number(status as f64),
            ],
        );
        self.this_value.with_mut(|r| r.downgrade());
    }

    pub(crate) fn listen(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        if self.closed.get() || self.closing.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        if !self.ensure_bound(global, this_value)? {
            return Ok(());
        }
        if self.server.get().is_none() {
            let options = options.to_js();
            if options.is_object() {
                self.server_session_options
                    .set(Some(bun_jsc::Strong::create(options, global)));
            }
            let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
            let tls_config = TlsConfig::from_js(global, tls, true)?;
            let Some(is_http3) = tls_config.is_http3() else {
                return Err(global
                    .err(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "options.alpn cannot mix HTTP/3 and non-HTTP/3 protocols on one endpoint; use a separate QuicEndpoint for each"
                        ),
                    )
                    .throw());
            };
            let mut config = config_from_js(global, options, Side::Server, is_http3)?;
            if tls.is_object() {
                if let Some(http3) = &mut config.http3 {
                    http3.origins = origins_from_js(global, tls)?;
                }
                if let Some(sni) = tls.get(global, "sni")?.filter(|v| v.is_object()) {
                    let built =
                        Self::build_sni_contexts(global, sni, tls_config.enable_early_data)?;
                    *self.sni_contexts.borrow_mut() = built;
                }
            }
            self.server_verify_client.set(tls_config.verify_client);
            self.server.set(Some(Server {
                config: Rc::new(config),
                tls: (tls_config.create_context())
                    .map_err(|e| global.throw(format_args!("tls: {e}")))?,
                alpn: tls_config.alpn.into(),
                allows_early_data: tls_config.enable_early_data,
            }));
        }
        // SAFETY: state buffer is live.
        self.with_state(|s| s.listening = 1);
        self.update_keepalive();
        Ok(())
    }

    pub(crate) fn connect(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        address: JsLocal<'_>,
        options: JsLocal<'_>,
        session_ticket: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.closed.get() || self.closing.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        if !self.ensure_bound(global, this_value)? {
            return Ok(JSValue::UNDEFINED);
        }
        let address = address.to_js();
        let options = options.to_js();
        let session_ticket = session_ticket.to_js();
        let Some(remote) = address_from_js(address) else {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"address\" argument must be an instance of SocketAddress"),
                )
                .throw());
        };
        if let Some(version) = read_u64_option(global, options, "version")?
            .map(|v| v as u32)
            .filter(|&v| VERSIONS.iter().all(|it| it.number() != v))
        {
            let min_version = read_u64_option(global, options, "minVersion")?
                .map_or(Version::V1.number(), |v| v as u32);
            return self.connect_verneg_probe(
                global,
                this_value.to_js(),
                remote,
                version,
                min_version,
            );
        }
        let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
        let tls_config = TlsConfig::from_js(global, tls, false)?;
        let is_http3 = tls_config.is_http3() == Some(true);
        let config = config_from_js(global, options, Side::Client, is_http3)?;
        let ctx =
            (tls_config.create_context()).map_err(|e| global.throw(format_args!("tls: {e}")))?;
        let (Some(tls), Some(local)) = (
            bun_quic_tls::Session::new(&ctx, Side::Client),
            self.local_addr.get(),
        ) else {
            return Ok(JSValue::UNDEFINED);
        };
        if let Some(name) = tls_config.servername.as_deref().filter(|it| it.len() > 1)
            && !(tls.ssl()).set_servername(bun_core::ZStr::from_slice_with_nul(name))
        {
            return Ok(JSValue::UNDEFINED);
        }
        let ticket = (session_ticket.as_array_buffer(global))
            .filter(|_| tls_config.enable_early_data)
            .map(|buf| buf.byte_slice().to_vec())
            .unwrap_or_default();
        let (session, handle) = QuicSession::create(
            global,
            self,
            this_value.to_js(),
            false,
            application_of(&config),
        )?;
        if let Err(e) = session.apply_options(global, options) {
            session.teardown(global);
            return Err(e);
        }
        let mut peer = remote;
        peer.set_ip(match or_loopback(peer.ip()).to_canonical() {
            IpAddr::V4(ip) if local.is_ipv6() => ip.to_ipv6_mapped().into(),
            ip => ip,
        });
        let addresses = Addresses { local, peer };
        let conn = (self.quic()).connect(now(), Rc::new(config), addresses, Box::new(tls), &ticket);
        session.bind(conn);
        session.apply_peer_datagram_budget();
        self.register_session(session);
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        self.schedule_process();
        Ok(handle)
    }

    fn connect_verneg_probe(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        remote: SocketAddr,
        version: u32,
        min_version: u32,
    ) -> JsResult<JSValue> {
        let (session, handle) =
            QuicSession::create(global, self, this_value, false, Application::None)?;
        let mut ids = [[0; VERNEG_PROBE_CID_LEN]; 2];
        bun_boringssl_sys::rand_bytes(ids.as_flattened_mut());
        let mut probe = vec![HEADER_FORM_AND_FIXED_BITS];
        probe.extend_from_slice(&version.to_be_bytes());
        for id in ids {
            probe.push(VERNEG_PROBE_CID_LEN as u8);
            probe.extend_from_slice(&id);
        }
        probe.resize(VERNEG_PROBE_LEN, 0);
        session.verneg.set(Some((version, min_version)));
        session.remote_addr.set(Some(remote));
        let session = self.register_session(session);
        self.pending_verneg
            .with_mut(|v| v.push((session, ids[1], now() + VERNEG_PROBE_TIMEOUT)));
        self.wake();
        self.update_keepalive();
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        if let Some(binding) = self.binding.get() {
            let remote = socket_address(remote);
            uws::udp::Socket::opaque_mut(binding.socket).send(
                &[probe.as_ptr()],
                &[probe.len()],
                &[(&raw const remote._addr).cast()],
            );
            self.add_stat(IDX_STATS_PACKETS_SENT, 1);
            self.add_stat(IDX_STATS_BYTES_SENT, probe.len() as u64);
        }
        Ok(handle)
    }

    /// The VN packet's DCID echoes the probe's SCID — RFC 8999 sec 6.
    fn handle_version_negotiation(&self, payload: &[u8]) -> bool {
        const LEN: u8 = VERNEG_PROBE_CID_LEN as u8;
        let [0x80..=0xff, 0, 0, 0, 0, LEN, rest @ ..] = payload else {
            return false;
        };
        let Some((dcid, [LEN, rest @ ..])) = rest.split_first_chunk() else {
            return false;
        };
        let session = self.pending_verneg.with_mut(|v| {
            let at = v.iter().position(|(_, probe_scid, _)| probe_scid == dcid);
            at.map(|i| v.swap_remove(i).0)
        });
        let Some(session) = session.and_then(|it| self.live_session(it)) else {
            return false;
        };
        let versions = rest.get(VERNEG_PROBE_CID_LEN..).unwrap_or_default();
        let versions = versions.as_chunks().0.iter().copied();
        session.push_event(SessionEvent::VersionNegotiation {
            server_versions: versions.map(u32::from_be_bytes).collect(),
        });
        self.schedule_process();
        true
    }

    pub(crate) fn close_gracefully(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) {
        if self.closed.get() || self.closing.get() {
            return;
        }
        self.closing.set(true);
        self.with_state(|s| {
            s.closing = 1;
            s.listening = 0;
        });
        if self.this_value.get().is_empty() {
            this_value.set_js_ref_strong(cx.global());
        }
        if self.is_drained() {
            self.finish_close();
        } else {
            (self.sessions.get().iter())
                .filter_map(|&it| self.live_session(it))
                .for_each(QuicSession::expect_end);
            self.update_keepalive();
            self.schedule_process();
        }
    }

    pub(crate) fn release_socket(&self, _: &mut JsScope<'_>) {
        self.pending_endpoint_close.set(false);
        self.teardown();
        self.poll_ref.disable();
    }

    pub(crate) fn address(&self, cx: &mut JsScope<'_>) -> JSValue {
        address_to_js(cx.global(), self.local_addr.get())
    }
    pub(crate) fn mark_busy(&self, busy: bool) {
        // SAFETY: state buffer is live.
        self.with_state(|s| s.busy = busy as u8);
    }
    fn build_sni_contexts(
        global: &JSGlobalObject,
        entries: JSValue,
        allows_early_data: bool,
    ) -> JsResult<Vec<(Vec<u8>, OwnedSslCtx)>> {
        let keys = entries.keys(global)?;
        let len = keys.get_length(global)? as u32;
        let mut out = Vec::with_capacity(len as usize);
        for i in 0..len {
            let key = keys.get_index(global, i)?;
            let host = bun_core::String::from_js(key, global)?.to_owned_slice();
            let value = entries
                .get(global, host.as_slice())?
                .unwrap_or(JSValue::UNDEFINED);
            if !value.is_object() {
                continue;
            }
            let mut config = TlsConfig::from_js(global, value, true)?;
            config.enable_early_data &= allows_early_data;
            match config.create_context() {
                Ok(ctx) => out.push((host, ctx)),
                Err(e) => {
                    return Err(global
                        .err(jsc::ErrorCode::INVALID_ARG_VALUE, format_args!("tls: {e}"))
                        .throw());
                }
            }
        }
        Ok(out)
    }

    pub(crate) fn set_sni_contexts(
        &self,
        cx: &mut JsScope<'_>,
        entries: JsLocal<'_>,
        replace: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        if self.closed.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        let entries = entries.to_js();
        let replace = replace.to_js();
        if !entries.is_object() {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"entries\" argument must be of type object"),
                )
                .throw());
        }
        let server = self.server.get().as_ref();
        let allows_early_data = server.is_some_and(|it| it.allows_early_data);
        let built = Self::build_sni_contexts(global, entries, allows_early_data)?;
        let mut map = self.sni_contexts.borrow_mut();
        if replace.to_boolean() {
            map.clear();
        }
        for (host, ctx) in built {
            if let Some(slot) = map.iter_mut().find(|(h, _)| h.eq_ignore_ascii_case(&host)) {
                slot.1 = ctx;
            } else {
                map.push((host, ctx));
            }
        }
        Ok(())
    }
}

struct SendScope<'a>(&'a QuicEndpoint);

impl Drop for SendScope<'_> {
    fn drop(&mut self) {
        self.0.send_scope_depth.update(|depth| depth - 1);
        self.0.wake();
    }
}

impl Drop for QuicEndpoint {
    fn drop(&mut self) {
        self.release_native();
    }
}
