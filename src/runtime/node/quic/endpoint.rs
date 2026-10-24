//! `QuicEndpoint` native handle (lsquic-backed) — Node's
//! `internalBinding('quic').Endpoint` analog (node/src/quic/endpoint.{h,cc}).

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{null, null_mut};
use std::rc::Rc;

use bun_collections::smallvec::SmallVec;
use bun_io::KeepAlive;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{
    self as jsc, ArrayBuffer, JSGlobalObject, JSType, JSValue, JsCell, JsRef, JsResult, StringJsc,
};
use bun_lsquic_sys as lsquic;
use bun_uws as uws;
use bun_uws::quic::PassPoint;

use crate::socket::udp_socket::get_us_error;

use super::callbacks;
use super::ffi::{ctx_ref, lsquic_callback};
use super::now_ns;
use super::session::{self, QuicSession, SOCKADDR_IN_LEN, SOCKADDR_IN6_LEN, StoredAddr};
use super::stream;
use super::tls::{TlsConfig, TlsContext};

bun_core::declare_scope!(quic, hidden);

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
/// QUIC transport error code for CONNECTION_REFUSED (RFC 9000 §20.1).
const QUIC_TRANSPORT_CONNECTION_REFUSED: core::ffi::c_uint = 0x2;
/// QUIC v1 wire version (RFC 9000).
const QUIC_VERSION_1: u32 = 0x0000_0001;
/// QUIC v2 wire version (RFC 9369 §3).
const QUIC_VERSION_2: u32 = 0x6b33_43cf;
/// Longest connection ID QUIC v1/v2 allow (RFC 9000 §17.2).
const MAX_CID_LEN: usize = 20;
/// Byte offset of the DCID length in a long-header packet: form/type byte +
/// 4-byte version (RFC 8999 §5.1).
const LONG_HEADER_DCID_LEN_OFFSET: usize = 5;
/// Shortest parseable long header: form byte + version + dcid_len + ≥1 CID
/// byte (RFC 8999 §5.1).
const LONG_HEADER_MIN_LEN: usize = 7;
/// Matches Node's 1200-byte default.
const DEFAULT_DATAGRAM_FRAME_SIZE: u64 = 1200;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS handshake_failure(40).
const CRYPTO_ERROR_HANDSHAKE_FAILURE: u64 = 0x0100 + 40;
const VERNEG_PROBE_TIMEOUT_NS: u64 = 10_000_000_000;

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
const DEFAULT_MAX_IDLE_TIMEOUT_SECS: c_uint = 10;
pub(super) const MS_PER_SEC: u64 = 1_000;
/// lsquic.h `es_cc_algo` values.
const CC_ALGO_CUBIC: c_uint = 1;
const CC_ALGO_BBR: c_uint = 2;

/// Copy a sockaddr sized by its family (sockaddr_in = 16, sockaddr_in6 = 28)
/// so an AF_INET address never over-reads past its allocation.
pub(super) fn stored_addr_from_sockaddr(ptr: *const c_void) -> StoredAddr {
    use crate::socket::socket_address::inet;
    if ptr.is_null() {
        return StoredAddr::default();
    }
    // SAFETY: caller passes a live sockaddr; the family field is within the
    // smallest sockaddr variant on every supported platform.
    let family = unsafe {
        #[cfg(any(target_os = "macos", target_os = "freebsd", target_os = "ios"))]
        {
            *ptr.cast::<u8>().add(1) as u16
        }
        #[cfg(not(any(target_os = "macos", target_os = "freebsd", target_os = "ios")))]
        {
            u16::from_ne_bytes([*ptr.cast::<u8>(), *ptr.cast::<u8>().add(1)])
        }
    };
    let len = if family == inet::AF_INET6 as u16 {
        SOCKADDR_IN6_LEN
    } else {
        SOCKADDR_IN_LEN
    };
    StoredAddr::from_raw(ptr.cast(), len)
}

struct BindConfig {
    host: Vec<u8>,
    port: u16,
    /// `LIBUS_*` flags for `ipv6Only` and `reusePort`.
    flags: c_int,
    /// 0 keeps the OS default for these three, as in Node.
    receive_buffer_size: i32,
    send_buffer_size: i32,
    ttl: i32,
}

impl Default for BindConfig {
    fn default() -> Self {
        BindConfig {
            host: b"127.0.0.1\0".to_vec(),
            port: 0,
            flags: uws::LIBUS_LISTEN_DEFAULT,
            receive_buffer_size: 0,
            send_buffer_size: 0,
            ttl: 0,
        }
    }
}

impl BindConfig {
    /// Returns the errno of the first option the OS rejects. Node reports that as a bind failure too.
    fn apply_socket_options(&self, socket: &mut uws::udp::Socket) -> Result<(), c_int> {
        let check = |rc: c_int| match get_us_error::<true>(rc, bun_sys::Tag::setsockopt) {
            Some(err) => Err(c_int::from(err.errno)),
            None => Ok(()),
        };
        let mut applied: c_int = 0;
        if self.receive_buffer_size > 0 {
            check(socket.buffer_size(true, self.receive_buffer_size, &mut applied))?;
        }
        if self.send_buffer_size > 0 {
            check(socket.buffer_size(false, self.send_buffer_size, &mut applied))?;
        }
        if self.ttl > 0 {
            check(socket.set_unicast_ttl(self.ttl))?;
        }
        Ok(())
    }
}

pub(crate) struct QuicEndpoint {
    vtable_ptr: *const lsquic::NqVtable,
    /// The vtable storage itself; `vtable_ptr` and `ea_stream_if_ctx` point
    /// into this box, so it must outlive both engines.
    vtable: JsCell<Option<Box<lsquic::NqVtable>>>,
    /// Borrowed views into JSC-owned ArrayBuffers (the wrapper owns both the
    /// ArrayBuffer and this struct, so the pointers are valid for our life).
    state: *mut EndpointState,
    stats: *mut u64,
    closing: Cell<bool>,
    closed: Cell<bool>,

    /// Null until the endpoint binds or closes. Owns both engines and `udp`.
    driver: Cell<*mut uws::quic::Driver>,
    /// Null unless bound. The `peer_ctx` of this endpoint's connections.
    udp: Cell<*mut uws::quic::Udp>,
    bind_config: JsCell<BindConfig>,
    local_addr: Cell<StoredAddr>,
    poll_ref: JsCell<KeepAlive>,
    this_value: JsCell<JsRef>,

    /// At most one server engine, and one client engine for each distinct settings struct.
    engines: JsCell<Vec<Rc<Engine>>>,
    server_tls: JsCell<Option<TlsContext>>,
    sni_contexts: JsCell<Vec<(Vec<u8>, TlsContext)>>,
    server_alpn_wire: JsCell<Vec<u8>>,
    pub(super) server_verify_client: Cell<bool>,
    server_session_options: JsCell<Option<bun_jsc::Strong>>,
    disable_stateless_reset: Cell<bool>,
    stateless_reset_burst: Cell<u32>,
    stateless_reset_rate: Cell<f64>,
    /// Pre-encoded HTTP/3 ORIGIN frame payload (RFC 9412). lsquic borrows
    /// the bytes for the engine's lifetime — set before engine creation,
    /// never mutated afterwards.
    origin_blob: JsCell<Vec<u8>>,

    /// When `process` has to run again whatever lsquic wants, on the `now_ns` clock. `u64::MAX` is never.
    next_pass_at_ns: Cell<u64>,
    follow_up: Cell<FollowUp>,
    sessions: JsCell<Vec<*mut QuicSession>>,
    pending_new_sessions: JsCell<Vec<*mut QuicSession>>,
    pending_verneg: JsCell<Vec<(*mut QuicSession, [u8; VERNEG_PROBE_CID_LEN], u64)>>,
    block_list: Cell<Option<*mut crate::node::net::block_list::BlockList>>,
    block_list_js: JsCell<Option<bun_jsc::Strong>>,
    block_list_allow: Cell<bool>,
    pending_endpoint_close: Cell<bool>,
    /// Set while the pass runs from the microtask drain: session Closed events
    /// are requeued for the next loop point instead of dispatching mid-chain.
    pub(super) defer_closes: Cell<bool>,
    /// Native-entry depth, node's Session::SendPendingDataScope. Non-zero means
    /// a native callback (on_data, the timer) is on the stack and owns the
    /// flush when it unwinds -- JS it dispatches (onSessionNew and friends) must
    /// not re-enter lsquic mid-callback.
    send_scope_depth: Cell<u32>,

    global: Cell<*const JSGlobalObject>,
}

/// A handler's `schedule_process` asks for a pass after the loop's next poll. It applies a close the handler asked for, once a peer on this loop has read the handler's own flight.
#[derive(Clone, Copy, PartialEq, Eq)]
enum FollowUp {
    None,
    Requested,
    AfterNextPoll,
}

impl QuicEndpoint {
    /// Creates the driver on first use, so an endpoint that's never used costs the loop nothing.
    fn driver(&self) -> &uws::quic::Driver {
        if self.driver.get().is_null() {
            // SAFETY: `free_driver` runs before this endpoint is freed.
            self.driver.set(unsafe {
                uws::quic::Driver::create(
                    uws::Loop::get(),
                    driver_pass,
                    core::ptr::from_ref(self).cast_mut().cast(),
                )
            });
        }
        uws::quic::Driver::opaque_ref(self.driver.get())
    }

    fn free_driver(&self) {
        let driver = self.driver.replace(null_mut());
        if !driver.is_null() {
            // SAFETY: `driver` came from `Driver::create`, and the field no longer has it.
            unsafe { uws::quic::Driver::free(driver) };
        }
    }

    /// Returns the µs until the next pass is due, or -1.
    fn next_pass_us(&self) -> c_int {
        if self.closed.get() {
            return if self.pending_endpoint_close.get() {
                0
            } else {
                -1
            };
        }
        let lsquic_us = self.driver().next_tick_us();
        let own_us = match self.next_pass_at_ns.get() {
            u64::MAX => return lsquic_us,
            at => (at.saturating_sub(now_ns()) / 1000).min(c_int::MAX as u64) as c_int,
        };
        if lsquic_us < 0 {
            own_us
        } else {
            own_us.min(lsquic_us)
        }
    }

    /// Asks for a `process` at `at_ns` on the `now_ns` clock, if none is due sooner.
    pub(super) fn request_pass_at(&self, at_ns: u64) {
        self.next_pass_at_ns
            .set(self.next_pass_at_ns.get().min(at_ns));
    }

    fn run_driver_pass(&self, point: PassPoint) -> c_int {
        // A session must not end in the middle of a microtask chain.
        let draining = point == PassPoint::AfterMicrotasks;
        let global_ptr = self.global.get();
        // A pass that's already on the stack flushes at its end.
        if self.send_scope_depth.get() != 0 || global_ptr.is_null() {
            return 0;
        }
        // SAFETY: `global_ptr` is the realm that created this endpoint and outlives it.
        let global = unsafe { &*global_ptr };
        let follow_up_is_due = match (point, self.follow_up.get()) {
            (PassPoint::BeforePoll, FollowUp::Requested) => {
                self.follow_up.set(FollowUp::AfterNextPoll);
                false
            }
            (PassPoint::AfterPoll, FollowUp::AfterNextPoll) => {
                self.follow_up.set(FollowUp::None);
                true
            }
            _ => false,
        };
        if self.closed.get() {
            if !draining && self.pending_endpoint_close.replace(false) {
                self.deliver_endpoint_close(global, CLOSECONTEXT_CLOSE, 0);
            }
        } else if follow_up_is_due || self.driver().is_pending() || self.next_pass_us() == 0 {
            self.defer_closes.set(draining);
            self.process(global);
            self.defer_closes.set(false);
        }
        if self.follow_up.get() != FollowUp::None && !self.closed.get() {
            return 0;
        }
        self.next_pass_us()
    }
}

unsafe extern "C" fn driver_pass(driver: *mut uws::quic::Driver, point: PassPoint) -> c_int {
    let owner = uws::quic::Driver::opaque_ref(driver).owner();
    // SAFETY: the owner is the endpoint, which frees the driver before it's freed itself.
    unsafe { &*owner.cast::<QuicEndpoint>() }.run_driver_pass(point)
}

extern "C" fn on_recv_error(_socket: *mut uws::udp::Socket, _errno: c_int, _is_errqueue: c_int) {}

thread_local! {
    /// A server may advertise another local endpoint's address as its
    /// preferred_address (RFC 9000 sec 9.6).
    static ENDPOINT_REGISTRY: core::cell::RefCell<Vec<*mut QuicEndpoint>> =
        const { core::cell::RefCell::new(Vec::new()) };
}

const ENDPOINT_REGISTRY_INLINE_CAP: usize = 4;

/// Header byte 0 bit 7 (RFC 8999 sec 5.1): 1 = long header, 0 = short.
const HEADER_FORM_LONG: u8 = 0x80;
/// Minimum stateless reset size (RFC 9000 sec 10.3: header byte + 4+ random
/// bytes + 16-byte token).
const STATELESS_RESET_MIN_LEN: usize = 21;
/// RFC 8999 sec 5.1: the second header bit is fixed to 1.
const LONG_HEADER_FIXED_BIT: u8 = 0x40;
/// A Version Negotiation packet carries version 0 (RFC 8999 sec 6).
const VERSION_NEGOTIATION_VERSION: [u8; 4] = [0, 0, 0, 0];
const VERSION_FIELD_LEN: usize = 4;
const VERNEG_PROBE_CID_LEN: usize = 8;
/// RFC 9000 sec 14.1: servers may drop Initial-like datagrams smaller than
/// 1200 bytes, so the probe pads to the minimum.
const VERNEG_PROBE_LEN: usize = 1200;
const SHORT_HEADER_DCID_LEN: usize = 8;

/// Returns a packet's destination connection ID. A short header doesn't carry its length, which is lsquic's default for every engine here.
fn destination_cid(payload: &[u8]) -> Option<&[u8]> {
    if payload[0] & HEADER_FORM_LONG == 0 {
        return payload.get(1..1 + SHORT_HEADER_DCID_LEN);
    }
    let len = *payload.get(LONG_HEADER_DCID_LEN_OFFSET)? as usize;
    let start = LONG_HEADER_DCID_LEN_OFFSET + 1;
    payload
        .get(start..start + len)
        .filter(|cid| !cid.is_empty() && cid.len() <= MAX_CID_LEN)
}

extern "C" fn on_data(
    socket: *mut uws::udp::Socket,
    buf: *mut uws::udp::PacketBuffer,
    packets: c_int,
) {
    let udp = uws::udp::Socket::opaque_mut(socket)
        .user()
        .cast::<uws::quic::Udp>();
    // SAFETY: the owner of the socket's `Udp` is the endpoint, which closes the socket before it's freed.
    let this = unsafe {
        &*uws::quic::Udp::opaque_ref(udp)
            .owner()
            .cast::<QuicEndpoint>()
    };
    let global_ptr = this.global.get();
    if global_ptr.is_null() {
        return;
    }
    // SAFETY: endpoints only exist on the JS thread of this realm and the
    // global outlives every live endpoint.
    let global = unsafe { &*global_ptr };
    let local = this.local_addr.get();
    // Apply a stashed close before feeding: a closing peer discards new
    // streams rather than announcing them (RFC 9000 s10.2.1), and ci_close
    // only schedules, so the engines have to run for it to take effect.
    let mut closed_any = false;
    for session in this.sessions.get().clone() {
        if let Some(session) = this.live_session(session) {
            closed_any |= session.flush_pending_graceful();
        }
    }
    if closed_any {
        this.drive_engines_once();
    }
    // `on_new_mini_conn` runs inside `lsquic_engine_packet_in`. The send scope keeps it from re-entering lsquic.
    this.send_scope_depth.set(this.send_scope_depth.get() + 1);
    bun_boringssl_sys::ERR_clear_error();
    for i in 0..packets {
        let payload = uws::udp::PacketBuffer::opaque_mut(buf).get_payload(i);
        let peer = uws::udp::PacketBuffer::opaque_mut(buf).get_peer(i);
        if payload.is_empty() {
            continue;
        }
        this.add_stat(IDX_STATS_PACKETS_RECEIVED, 1);
        this.add_stat(IDX_STATS_BYTES_RECEIVED, payload.len() as u64);
        // SAFETY: `peer` is the live sockaddr for this packet.
        let peer_sa = unsafe {
            &*core::ptr::from_ref(peer).cast::<crate::socket::socket_address::sockaddr>()
        };
        if this.peer_blocked(peer_sa) {
            continue;
        }
        let peer = core::ptr::from_ref(peer).cast::<c_void>();
        let dcid = destination_cid(payload);
        // An engine answers a packet it can't match with a stateless reset, so only the owner gets the packet.
        let owner_engine = dcid.and_then(|cid| this.engine_with_cid(cid));
        if let (None, Some(cid), true) = (owner_engine, dcid, payload[0] & HEADER_FORM_LONG == 0) {
            let sibling = ENDPOINT_REGISTRY.with_borrow(|v| {
                v.iter()
                    .copied()
                    .filter(|&other| !core::ptr::eq(other, this))
                    // SAFETY: registered endpoints outlive their registry entry.
                    .find_map(|other| Some((other, unsafe { &*other }.engine_with_cid(cid)?)))
            });
            if let Some((other, engine)) = sibling {
                // SAFETY: as above.
                let other = unsafe { &*other };
                if !other.peer_blocked(peer_sa) {
                    // `local` is this endpoint's address, the one the connection migrates to.
                    other.feed(Some(engine), payload, &local, peer);
                    other.process(global);
                }
                continue;
            }
            // May be a stateless reset (RFC 9000 sec 10.3).
            if payload.len() >= STATELESS_RESET_MIN_LEN {
                let others: SmallVec<[*mut QuicEndpoint; ENDPOINT_REGISTRY_INLINE_CAP]> =
                    ENDPOINT_REGISTRY.with_borrow(|v| {
                        v.iter()
                            .copied()
                            .filter(|&other| !core::ptr::eq(other, this))
                            .collect()
                    });
                for other_ptr in others {
                    // A listed pointer is live: `teardown` unregisters before it drops the reference that keeps the wrapper alive.
                    if !ENDPOINT_REGISTRY.with_borrow(|v| v.contains(&other_ptr)) {
                        continue;
                    }
                    // SAFETY: registered as of the check above, so its
                    // backing storage is live.
                    let other = unsafe { &*other_ptr };
                    if other.peer_blocked(peer_sa) {
                        continue;
                    }
                    other.feed(None, payload, &local, peer);
                    other.process(global);
                }
            }
        }
        // Version Negotiation packet (long header, version 0 — RFC 8999 sec 6).
        if payload.len() > LONG_HEADER_MIN_LEN
            && payload[0] & HEADER_FORM_LONG != 0
            && payload[1..5] == VERSION_NEGOTIATION_VERSION
            && this.handle_version_negotiation(payload)
        {
            continue;
        }
        this.feed(owner_engine, payload, &local, peer);
    }
    // Keep the scope through the tail pass: a graceful close a handler queued
    // during this dispatch must not join the same flight as the data the
    // handlers wrote (sessions stash it; the next depth-0 pass applies it).
    this.process(global);
    this.send_scope_depth.set(this.send_scope_depth.get() - 1);
}

/// Node's SNI resolution order: exact hostname, then a `*.suffix` wildcard,
/// then the `*` default. Comparison is ASCII-case-insensitive (RFC 6066).
fn match_sni<'a>(entries: &'a [(Vec<u8>, TlsContext)], host: &[u8]) -> Option<&'a TlsContext> {
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

lsquic_callback! {
    fn lookup_cert(
        this: &QuicEndpoint,
        _local: *const c_void,
        sni: *const c_char,
    ) -> *mut lsquic::SSL_CTX = null_mut(); {
        if !sni.is_null() {
            // SAFETY: lsquic passes a NUL-terminated servername valid for this call.
            let host = unsafe { core::ffi::CStr::from_ptr(sni) }.to_bytes();
            let entries = this.sni_contexts.get();
            if let Some(ctx) = match_sni(entries, host) {
                return ctx.raw().cast();
            }
        }
        this.server_tls
            .get()
            .as_ref()
            .map_or(null_mut(), |tls| tls.raw().cast())
    }
}

/// Returns whether the protocols in a wire-format ALPN list are HTTP/3, or `None` if only some are. Node's default is `h3`.
fn alpn_is_http(alpn: &[u8]) -> Option<bool> {
    let mut i = 0usize;
    let mut all: Option<bool> = None;
    while i < alpn.len() {
        let n = alpn[i] as usize;
        i += 1;
        if n == 0 || i + n > alpn.len() {
            break;
        }
        let p = &alpn[i..i + n];
        let is_http = p == b"h3" || p.starts_with(b"h3-");
        if *all.get_or_insert(is_http) != is_http {
            return None;
        }
        i += n;
    }
    Some(all.unwrap_or(true))
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

/// lsquic's settings belong to an engine and Node's options to a session, so sessions share an engine only if their settings are equal.
pub(super) struct Engine {
    /// Owned by the endpoint's driver.
    raw: *mut lsquic::lsquic_engine,
    pub(super) is_server: bool,
    /// lsquic frames this engine's streams as HTTP/3.
    pub(super) is_http: bool,
    settings: lsquic::Settings,
}

impl Engine {
    /// The transport parameters this engine's connections send.
    pub(super) fn local_transport_params(&self) -> lsquic::NqTransportParams {
        let s = &self.settings;
        lsquic::NqTransportParams {
            initial_max_stream_data_bidi_local: s.get_init_max_stream_data_bidi_local(),
            initial_max_stream_data_bidi_remote: s.get_init_max_stream_data_bidi_remote(),
            initial_max_stream_data_uni: s.get_init_max_stream_data_uni(),
            initial_max_data: s.get_init_max_data(),
            initial_max_streams_bidi: s.get_init_max_streams_bidi(),
            initial_max_streams_uni: s.get_init_max_streams_uni(),
            max_idle_timeout: match s.get_idle_timeout_ms() {
                0 => s.get_idle_timeout().saturating_mul(1000),
                ms => ms,
            },
            max_udp_payload_size: s.get_max_udp_payload_size_rx(),
            // lsquic hardcodes these (RFC 9000 defaults / lsquic.h LSQUIC_DF_*).
            ack_delay_exponent: 3,
            max_ack_delay: 25,
            active_connection_id_limit: 8,
            max_datagram_frame_size: match (s.get_datagrams(), s.get_max_datagram_frame_size()) {
                (0, _) => 0,
                (_, 0) => DEFAULT_DATAGRAM_FRAME_SIZE,
                (_, size) => size,
            },
            disable_active_migration: (s.get_allow_migration() == 0) as c_int,
            ..lsquic::NqTransportParams::default()
        }
    }
}

fn apply_transport_params(
    global: &JSGlobalObject,
    s: &mut lsquic::Settings,
    options: JSValue,
) -> JsResult<()> {
    // lsquic's default is 30 seconds.
    s.idle_timeout(DEFAULT_MAX_IDLE_TIMEOUT_SECS);
    // Node's default `cc` is cubic. lsquic's is adaptive, which picks BBRv1 if the first RTT sample is over 1.5 ms.
    s.cc_algo(CC_ALGO_CUBIC);
    if !options.is_object() {
        return Ok(());
    }
    if let Some(ms) = read_u64_option(global, options, "handshakeTimeout")? {
        s.handshake_to((ms.saturating_mul(1000)).min(c_uint::MAX as u64) as _);
    }
    if let Some(ms) = read_u64_option(global, options, "keepAlive")?.filter(|&ms| ms > 0) {
        // Node's keepAlive is exact (millisecond-granular).
        s.ping_period(1);
        s.ping_period_us(ms.saturating_mul(1000));
    }
    if let Some(tp) = options
        .get(global, "transportParams")?
        .filter(|v| v.is_object())
    {
        // Layout mirrors lsquic's `tp_preferred_address` prefix
        // (lsquic_trans_params.h): 4-byte IPv4 + u16 port + 16-byte IPv6 +
        // u16 port. IPs are wire order; ports are HOST order.
        let mut pref = [0u8; 24];
        let mut have_pref = false;
        for (key, at) in [("preferredAddressIpv4", 0), ("preferredAddressIpv6", 6)] {
            let Some(addr_js) = tp.get(global, key)? else {
                continue;
            };
            let Some(addr) = addr_js.as_class_ref::<crate::socket::SocketAddress>() else {
                continue;
            };
            let stored = session::StoredAddr::from_socket_address(addr);
            let Some((_family, port, ip)) = stored.decode() else {
                continue;
            };
            pref[at..at + ip.len()].copy_from_slice(ip);
            pref[at + ip.len()..at + ip.len() + 2].copy_from_slice(&port.to_ne_bytes());
            have_pref = true;
        }
        if have_pref {
            s.preferred_address(&pref);
        }
        if let Some(v) = read_u64_option(global, tp, "initialMaxStreamDataBidiLocal")? {
            s.init_max_stream_data_bidi_local(v.min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "initialMaxStreamDataBidiRemote")? {
            s.init_max_stream_data_bidi_remote(v.min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "initialMaxStreamDataUni")? {
            s.init_max_stream_data_uni(v.min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "initialMaxData")? {
            s.init_max_data(v.min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "initialMaxStreamsBidi")? {
            s.init_max_streams_bidi(v.min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "initialMaxStreamsUni")? {
            s.init_max_streams_uni(v.min(c_uint::MAX as u64) as _);
        }
        if let Some(secs) = read_u64_option(global, tp, "maxIdleTimeout")? {
            // Node's maxIdleTimeout is SECONDS: transportparams.cc:197 stores
            // `max_idle_timeout * NGTCP2_SECONDS`; the getter at :473 divides
            // it back out.
            if secs == 0 {
                // Only the seconds field can say "disabled" (RFC 9000 §18.2);
                // lsquic readers fall back to it when ms is zero. Non-zero
                // stays ms-only: lsquic rejects es_idle_timeout above 600.
                s.idle_timeout(0);
            }
            s.idle_timeout_ms(secs.saturating_mul(MS_PER_SEC).min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "maxUdpPayloadSize")? {
            s.max_udp_payload_size_rx(v.min(u16::MAX as u64) as _);
        }
        if let Some(v) = tp.get(global, "disableActiveMigration")? {
            s.allow_migration(!v.to_boolean() as _);
        }
        if let Some(v) = read_u64_option(global, tp, "maxDatagramFrameSize")? {
            if v == 0 {
                s.datagrams(0);
            } else {
                s.datagrams(1);
                s.max_datagram_frame_size(v.min(u16::MAX as u64) as u16);
            }
        }
    }
    if let Some(cc) = options.get(global, "cc")? {
        let name = bun_core::String::from_js(cc, global)?.to_owned_slice();
        // lsquic has no Reno. Cubic is its closest loss-based controller.
        s.cc_algo(match name.as_slice() {
            b"bbr" => CC_ALGO_BBR,
            _ => CC_ALGO_CUBIC,
        });
    }
    Ok(())
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
        lsquic::debug_assert_layout();

        let this = QuicEndpoint {
            vtable_ptr: null(),
            vtable: JsCell::new(None),
            state: null_mut(),
            stats: null_mut(),
            closing: Cell::new(false),
            closed: Cell::new(false),
            driver: Cell::new(null_mut()),
            udp: Cell::new(null_mut()),
            bind_config: JsCell::new(BindConfig::default()),
            local_addr: Cell::new(StoredAddr::default()),
            poll_ref: JsCell::new(KeepAlive::init()),
            this_value: JsCell::new(JsRef::empty()),
            engines: JsCell::new(Vec::new()),
            server_tls: JsCell::new(None),
            sni_contexts: JsCell::new(Vec::new()),
            server_alpn_wire: JsCell::new(Vec::new()),
            server_verify_client: Cell::new(false),
            server_session_options: JsCell::new(None),
            disable_stateless_reset: Cell::new(false),
            origin_blob: JsCell::new(Vec::new()),
            stateless_reset_burst: Cell::new(0),
            stateless_reset_rate: Cell::new(0.0),
            next_pass_at_ns: Cell::new(u64::MAX),
            follow_up: Cell::new(FollowUp::None),
            sessions: JsCell::new(Vec::new()),
            pending_new_sessions: JsCell::new(Vec::new()),
            pending_verneg: JsCell::new(Vec::new()),
            block_list: Cell::new(None),
            block_list_js: JsCell::new(None),
            block_list_allow: Cell::new(false),
            pending_endpoint_close: Cell::new(false),
            defer_closes: Cell::new(false),
            send_scope_depth: Cell::new(0),
            global: Cell::new(core::ptr::from_ref(cx.global())),
        };
        let this_value = structure.create(&cx.heap, this);
        let js_value = this_value.to_js();
        let raw: *mut Self = this_value.payload_ptr().as_ptr();
        let global = cx.global();

        let vt = Box::new(lsquic::NqVtable {
            owner: raw.cast(),
            on_new_conn: session::on_new_conn,
            on_hsk_done: session::on_hsk_done,
            on_hsk_confirmed: session::on_hsk_confirmed,
            on_goaway_received: session::on_goaway_received,
            on_conn_closed: session::on_conn_closed,
            on_conncloseframe: session::on_conncloseframe,
            on_new_token: session::on_new_token,
            on_sess_resume: session::on_sess_resume,
            on_new_stream: stream::on_new_stream,
            on_stream_read: stream::on_stream_read,
            on_stream_write: stream::on_stream_write,
            on_stream_close: stream::on_stream_close,
            on_stream_reset: stream::on_stream_reset,
            on_dg_write: session::on_dg_write,
            on_datagram: session::on_datagram,
            on_datagram_status: session::on_datagram_status,
            on_early_data_failed: session::on_early_data_failed,
            on_path_switch: session::on_path_switch,
            on_origin: session::on_origin,
            lookup_cert,
            on_new_mini_conn: session::on_new_mini_conn,
            on_mini_conn_failed: session::on_mini_conn_failed,
        });
        // SAFETY: `raw` was just created and nothing else has the wrapper.
        unsafe {
            (*raw).vtable_ptr = &raw const *vt;
            (*raw).vtable.set(Some(vt));
        }

        let options = options.to_js();
        if options.is_object() {
            if let Some(addr_js) = options
                .get(global, "address")?
                .filter(|v| !v.is_empty_or_undefined_or_null())
            {
                if let Some(addr) = addr_js.as_class_ref::<crate::socket::SocketAddress>() {
                    let stored = StoredAddr::from_socket_address(addr);
                    if let Some((_, port, ip)) = stored.decode() {
                        use core::fmt::Write;
                        let mut host = String::new();
                        match ip.len() {
                            4 => {
                                let _ = write!(host, "{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]);
                            }
                            16 => {
                                let segs: [u16; 8] = core::array::from_fn(|i| {
                                    u16::from_be_bytes([ip[2 * i], ip[2 * i + 1]])
                                });
                                let _ = write!(host, "{}", std::net::Ipv6Addr::from(segs));
                            }
                            _ => {}
                        }
                        let mut host_nul = host.into_bytes();
                        host_nul.push(0);
                        // SAFETY: `raw` is uniquely owned here.
                        unsafe {
                            (*raw).bind_config.with_mut(|cfg| {
                                cfg.host = host_nul;
                                cfg.port = port;
                            })
                        };
                    }
                }
            }
            let mut flags = uws::LIBUS_LISTEN_DEFAULT;
            if options.get_boolean_loose(global, "ipv6Only")? == Some(true) {
                flags |= uws::LIBUS_SOCKET_IPV6_ONLY;
            }
            if options.get_boolean_loose(global, "reusePort")? == Some(true) {
                // The bind fails where SO_REUSEPORT doesn't exist, like UV_UDP_REUSEPORT.
                flags |=
                    uws::LIBUS_LISTEN_REUSE_PORT | uws::LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE;
            }
            let read_i32 = |name| -> JsResult<i32> {
                Ok(read_u64_option(global, options, name)?
                    .map_or(0, |v| v.min(i32::MAX as u64) as i32))
            };
            let receive_buffer_size = read_i32("udpReceiveBufferSize")?;
            let send_buffer_size = read_i32("udpSendBufferSize")?;
            let ttl = read_i32("udpTTL")?;
            // SAFETY: as above.
            unsafe {
                (*raw).bind_config.with_mut(|cfg| {
                    cfg.flags = flags;
                    cfg.receive_buffer_size = receive_buffer_size;
                    cfg.send_buffer_size = send_buffer_size;
                    cfg.ttl = ttl;
                })
            };
            if let Some(bl_js) = options.get(global, "blockList")?.filter(|v| v.is_object()) {
                if let Some(bl) = crate::generated_bindgen::block_list::js_BlockList::from_js(bl_js)
                {
                    // SAFETY: `raw` is uniquely owned here; the Strong keeps
                    // the BlockList wrapper (and thus the native object)
                    // alive for the endpoint's lifetime.
                    unsafe {
                        (*raw).block_list.set(Some(bl.as_ptr()));
                        (*raw)
                            .block_list_js
                            .with_mut(|s| *s = Some(bun_jsc::Strong::create(bl_js, global)));
                    }
                }
            }
            if let Some(policy) = options.get(global, "blockListPolicy")? {
                let policy = bun_core::String::from_js(policy, global)?.to_owned_slice();
                // SAFETY: as above.
                unsafe { (*raw).block_list_allow.set(policy == b"allow") };
            }
            if let Some(v) = options
                .get(global, "disableStatelessReset")?
                .filter(|v| v.is_boolean())
            {
                // SAFETY: as above.
                unsafe { (*raw).disable_stateless_reset.set(v.to_boolean()) };
            }
            if let Some(v) = options.get(global, "statelessResetBurst")? {
                // SAFETY: as above.
                unsafe { (*raw).stateless_reset_burst.set(v.as_number() as u32) };
            }
            if let Some(v) = options.get(global, "statelessResetRate")? {
                // SAFETY: as above.
                unsafe { (*raw).stateless_reset_rate.set(v.as_number()) };
            }
        }

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
        self.sessions.get().contains(&p).then(|| unsafe { &*p })
    }
    /// Counts the server sessions from one IP address. Like Node, it ignores the port.
    fn server_sessions_from_host(&self, family: u16, ip: &[u8]) -> usize {
        self.sessions
            .get()
            .iter()
            // SAFETY: a registered session is live on the JS thread, see `live_session`.
            .map(|&session| unsafe { &*session })
            .filter(|session| {
                session.is_server()
                    && session
                        .remote_addr
                        .get()
                        .decode()
                        .is_some_and(|(f, _, addr)| f == family && addr == ip)
            })
            .count()
    }
    /// Returns true if `busy` or a connection limit refuses a new server session from `peer`.
    fn refuses_new_session(&self, peer: Option<&StoredAddr>) -> bool {
        let (busy, max_total, max_per_host) =
            self.with_state(|s| (s.busy, s.max_connections_total, s.max_connections_per_host));
        busy != 0
            || (max_total > 0 && self.sessions.get().len() >= max_total as usize)
            || (max_per_host > 0
                && peer
                    .and_then(StoredAddr::decode)
                    .is_none_or(|(family, _, ip)| {
                        self.server_sessions_from_host(family, ip) >= max_per_host as usize
                    }))
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

    fn peer_blocked(&self, peer: &crate::socket::socket_address::sockaddr) -> bool {
        let Some(bl) = self.block_list.get() else {
            return false;
        };
        // SAFETY: the Strong in `block_list_js` keeps the wrapper (and
        // native object) alive for the endpoint's lifetime.
        let blocked = unsafe { (*bl).check_sockaddr(peer) } != self.block_list_allow.get();
        if blocked {
            self.add_stat(IDX_STATS_PACKETS_BLOCKED, 1);
        }
        blocked
    }

    /// Returns `Ok(false)` when the bind fails: Node does not throw here.
    fn ensure_bound(&self, global: &JSGlobalObject, this_value: JSValue) -> JsResult<bool> {
        if !self.udp.get().is_null() {
            return Ok(true);
        }
        let mut err: c_int = 0;
        let cfg = self.bind_config.get();
        // SAFETY: `cfg.host` is NUL-terminated.
        let udp = unsafe {
            self.driver().create_udp(
                cfg.host.as_ptr().cast(),
                cfg.port,
                cfg.flags,
                &mut err,
                on_data,
                on_recv_error,
            )
        };
        let bound = if udp.is_null() {
            Err(err)
        } else {
            self.udp.set(udp);
            cfg.apply_socket_options(uws::udp::Socket::opaque_mut(
                uws::quic::Udp::opaque_ref(udp).socket(),
            ))
        };
        if let Err(errno) = bound {
            self.this_value
                .with_mut(|r| r.set_strong(this_value, global));
            self.finish_close();
            self.pending_endpoint_close.set(false);
            self.deliver_endpoint_close(global, CLOSECONTEXT_BIND_FAILURE, errno);
            return Ok(false);
        }
        let udp = uws::quic::Udp::opaque_ref(udp);
        // SAFETY: `stats` is a `[u64; ENDPOINT_STATS_FIELDS.len()]` that the wrapper keeps alive for as long as `self`.
        unsafe {
            udp.count_sent(
                self.stats.add(IDX_STATS_PACKETS_SENT),
                self.stats.add(IDX_STATS_BYTES_SENT),
            )
        };
        self.local_addr.set(stored_addr_from_sockaddr(udp.local()));
        self.with_state(|s| {
            s.bound = 1;
            s.receiving = 1;
        });
        self.this_value
            .with_mut(|r| r.set_strong(this_value, global));
        self.update_keepalive();
        let me = core::ptr::from_ref(self).cast_mut();
        ENDPOINT_REGISTRY.with_borrow_mut(|v| {
            if !v.contains(&me) {
                v.push(me);
            }
        });
        Ok(true)
    }

    fn update_keepalive(&self) {
        if self.closed.get() || self.udp.get().is_null() {
            return;
        }
        let listening = self.with_state(|s| s.listening) != 0;
        let busy = listening || !self.sessions.get().is_empty();
        let ctx = bun_io::js_vm_ctx();
        self.poll_ref
            .with_mut(|p| if busy { p.ref_(ctx) } else { p.unref(ctx) });
    }

    fn process(&self, global: &JSGlobalObject) {
        if self.closed.get() {
            return;
        }
        if self.send_scope_depth.get() == 0 && self.follow_up.get() == FollowUp::None {
            for session in self.sessions.get().clone() {
                if let Some(session) = self.live_session(session) {
                    session.flush_pending_graceful();
                }
            }
        }
        self.send_scope_depth.set(self.send_scope_depth.get() + 1);
        self.next_pass_at_ns.set(u64::MAX);
        // Not from the mid-turn drain pass: a deferred abort is dropped when
        // a later stream writes first, and node decides that over the whole
        // turn -- flushing mid-chain puts a RESET on the wire node never sends.
        if !self.defer_closes.get() {
            for session in self.sessions.get().clone() {
                if let Some(session) = self.live_session(session) {
                    session.flush_deferred_aborts();
                }
            }
        }
        bun_boringssl_sys::ERR_clear_error();
        self.driver().process();
        if let Some(server_engine) = self.server_engine() {
            let (mut sent, mut limited) = (0u64, 0u64);
            // SAFETY: engine is live while the endpoint is; out-params are
            // stack slots.
            unsafe {
                lsquic::lsquic_engine_sreset_stats(
                    server_engine.raw,
                    core::ptr::from_mut(&mut sent),
                    core::ptr::from_mut(&mut limited),
                )
            };
            self.write_stat(IDX_STATS_STATELESS_RESET_COUNT, sent);
            self.write_stat(IDX_STATS_STATELESS_RESET_RATE_LIMITED, limited);
        }

        // Every callback below runs user JS that can synchronously destroy
        // sessions and (via close()) drop the endpoint's wrapper Strong;
        // hold one for the duration so `self` survives GC.
        let _keep_alive = bun_jsc::Strong::create(self.this_value.get().get(), global);

        loop {
            // In the order the ClientHellos were parsed.
            let Some(session) = self.pending_new_sessions.with_mut(|v| {
                if v.is_empty() {
                    None
                } else {
                    Some(v.remove(0))
                }
            }) else {
                break;
            };
            let Some(session) = self.live_session(session) else {
                continue;
            };
            let handle = session.handle();
            callbacks::call(
                global,
                "onSessionNew",
                self.this_value.get().get(),
                &[handle],
            );
        }
        let sessions: Vec<*mut QuicSession> = self.sessions.get().clone();
        for session in sessions {
            let Some(session) = self.live_session(session) else {
                continue;
            };
            session.process_events(global);
            session.maybe_finish_deferred_close();
        }
        self.sweep_verneg_probes();
        self.update_keepalive();
        if self.closing.get()
            && self.sessions.get().is_empty()
            && self.engine_conn_count() == 0
            && !self.closed.get()
        {
            self.finish_close();
        }
        self.send_scope_depth.set(self.send_scope_depth.get() - 1);
        // Writes made by the dispatch above could not flush inline (the scope
        // was held). Send them at the pass's outer edge, where node's
        // SendPendingDataScope flushes, not a loop turn later.
        if !self.closed.get() && self.driver().is_pending() {
            self.drive_engines_once();
        }
    }

    fn engine_conn_count(&self) -> u32 {
        self.engines
            .get()
            .iter()
            // SAFETY: engines live until finish_close.
            .map(|engine| unsafe { lsquic::lsquic_engine_conn_count(engine.raw) })
            .sum()
    }

    fn server_engine(&self) -> Option<Rc<Engine>> {
        self.engines.get().iter().find(|e| e.is_server).cloned()
    }

    /// Returns the engine that has a connection with this ID.
    fn engine_with_cid(&self, cid: &[u8]) -> Option<*mut lsquic::lsquic_engine> {
        self.engines.get().iter().map(|e| e.raw).find(|&engine| {
            // SAFETY: engines live until finish_close.
            unsafe { lsquic::lsquic_engine_cid_in_use(engine, cid.as_ptr(), cid.len()) != 0 }
        })
    }

    /// Hands a datagram that arrived at `local` to `engine`, or to every engine if no engine has its connection ID.
    fn feed(
        &self,
        engine: Option<*mut lsquic::lsquic_engine>,
        payload: &[u8],
        local: &StoredAddr,
        peer: *const c_void,
    ) {
        let packet_in = |raw: *mut lsquic::lsquic_engine| {
            // SAFETY: `raw` lives until finish_close, and payload/local/peer are valid for this call.
            unsafe {
                lsquic::lsquic_engine_packet_in(
                    raw,
                    payload.as_ptr(),
                    payload.len(),
                    local.as_ptr().cast(),
                    peer.cast(),
                    self.udp.get().cast(),
                    0,
                );
            }
        };
        if let Some(raw) = engine {
            return packet_in(raw);
        }
        // By index: `on_new_mini_conn` reads the listen options, and a getter there can add an engine.
        let mut i = 0;
        while let Some(raw) = self.engines.get().get(i).map(|e| e.raw) {
            packet_in(raw);
            i += 1;
        }
    }

    /// Whether a native dispatch (on_data, process) is on the stack.
    pub(super) fn scope_held(&self) -> bool {
        self.send_scope_depth.get() != 0
    }

    pub(super) fn schedule_process(&self) {
        if self.closed.get() {
            return;
        }
        // Flush at the outermost native exit (node's SendPendingDataScope):
        // a response must leave before a later handler's close, or lsquic's
        // control-stream priority coalesces GOAWAY ahead of the data.
        if self.send_scope_depth.get() == 0 {
            self.drive_engines_once();
        } else if self.follow_up.get() == FollowUp::None {
            self.follow_up.set(FollowUp::Requested);
        }
        // The next pass dispatches what the flush queued.
        self.driver().set_pending();
    }

    /// Queues the handshake-failure close of a probe that got no reply.
    fn expire_session(&self, session: *mut QuicSession) -> bool {
        let Some(session) = self.live_session(session) else {
            return false;
        };
        session.push_event(session::SessionEvent::PeerClose {
            app_error: false,
            code: CRYPTO_ERROR_HANDSHAKE_FAILURE,
            reason: b"handshake failed".to_vec(),
        });
        session.push_event(session::SessionEvent::Closed);
        true
    }

    fn sweep_verneg_probes(&self) {
        let now = now_ns();
        let mut next_pass_at = u64::MAX;
        let mut expired: Vec<*mut QuicSession> = Vec::new();
        // A probe has no lsquic conn, so no handshake or idle timeout covers
        // it, and RFC 9000 s6.1 makes the reply optional with no retransmit:
        // without this a dropped reply hangs `opened` and `close()` forever.
        self.pending_verneg.with_mut(|v| {
            v.retain(|(session, _, created_ns)| {
                if now.saturating_sub(*created_ns) < VERNEG_PROBE_TIMEOUT_NS {
                    next_pass_at = next_pass_at.min(*created_ns + VERNEG_PROBE_TIMEOUT_NS);
                    return true;
                }
                expired.push(*session);
                false
            });
        });
        for session in expired {
            if self.expire_session(session) {
                // `process()` has already drained the event queues.
                next_pass_at = 0;
            }
        }
        self.request_pass_at(next_pass_at);
    }

    /// Makes a new mini conn skip its TLS handshake and answer with CONNECTION_REFUSED.
    fn refuse_mini_conn(conn: lsquic::MiniConn) -> *mut QuicSession {
        conn.refuse(QUIC_TRANSPORT_CONNECTION_REFUSED);
        null_mut()
    }

    /// Creates the session that lsquic keeps as a new mini conn's ctx, or refuses the conn.
    pub(super) fn on_new_mini_conn(&self, conn: lsquic::MiniConn) -> *mut QuicSession {
        let global_ptr = self.global.get();
        // A session accepted during close() would keep `sessions` non-empty, and the close would never finish.
        if global_ptr.is_null() || self.closing.get() {
            return Self::refuse_mini_conn(conn);
        }
        // SAFETY: as in `on_data`.
        let global = unsafe { &*global_ptr };
        let peer = conn
            .sockaddrs()
            .map(|(_, peer)| stored_addr_from_sockaddr(peer));
        // As Node.js does: https://github.com/nodejs/node/blob/v26.3.0/src/quic/endpoint.cc#L1503
        if self.refuses_new_session(peer.as_ref()) {
            self.add_stat(IDX_STATS_SERVER_BUSY_COUNT, 1);
            return Self::refuse_mini_conn(conn);
        }
        match QuicSession::create(
            global,
            self.vtable_ptr,
            core::ptr::from_ref(self).cast_mut(),
            self.this_value.get().get(),
            self.server_engine(),
        ) {
            Ok((session, _handle)) => {
                if let Err(err) = self.apply_server_session_options(global, session) {
                    crate::dispatch::fold(Err(err));
                }
                // SAFETY: session was just created.
                unsafe { (*session).bind_mini_conn(conn) };
                self.sessions.with_mut(|v| v.push(session));
                session
            }
            Err(e) => {
                crate::dispatch::fold(Err(e));
                Self::refuse_mini_conn(conn)
            }
        }
    }

    /// Queues the listen callback for a server session.
    pub(super) fn announce(&self, session: *mut QuicSession) {
        self.pending_new_sessions.with_mut(|v| v.push(session));
        self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
    }

    /// Binds a promoted server conn to its mini conn's session, or drops the conn if that session was destroyed.
    pub(super) fn on_new_conn(&self, conn: *mut lsquic::lsquic_conn) -> *mut QuicSession {
        // SAFETY: `conn` is the live conn lsquic just created.
        let Some(new_conn) = (unsafe { lsquic::Conn::from_raw(conn) }) else {
            return null_mut();
        };
        // SAFETY: `conn` is the live conn lsquic just created.
        let ctx = unsafe { lsquic::lsquic_conn_get_ctx(conn) };
        // SAFETY: `ctx_ref` documents the shim's context-pointer contract.
        let Some(session) = (unsafe { ctx_ref::<QuicSession>(ctx) }) else {
            if self.closing.get() {
                // A code-0 close wouldn't make the client of a closing endpoint reject.
                new_conn.abort_error(false, QUIC_TRANSPORT_CONNECTION_REFUSED, c"");
            } else {
                // Node's dead server goes silent: no CONNECTION_CLOSE.
                new_conn.abort_silent();
            }
            return null_mut();
        };
        // `connect()` binds a client conn itself.
        if session.is_server() {
            session.bind_conn(conn);
            // lsquic only promotes a server conn once its handshake is done, and never calls `on_hsk_done` for it.
            session.note_handshake_ok(new_conn);
        }
        ctx.cast()
    }

    pub(super) fn drive_engines_once(&self) {
        if self.closed.get() {
            return;
        }
        self.send_scope_depth.set(self.send_scope_depth.get() + 1);
        bun_boringssl_sys::ERR_clear_error();
        self.driver().process();
        self.send_scope_depth.set(self.send_scope_depth.get() - 1);
    }

    pub(super) fn unregister_session(&self, session: *mut QuicSession) {
        self.sessions.with_mut(|v| v.retain(|&s| s != session));
        self.pending_new_sessions
            .with_mut(|v| v.retain(|&s| s != session));
        self.pending_verneg
            .with_mut(|v| v.retain(|&(s, _, _)| s != session));
    }

    /// Returns the engine for sessions with these options. Creates it unless an earlier session's engine has the same settings.
    fn engine_for(
        &self,
        is_server: bool,
        config: &TlsConfig,
        options: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<Rc<Engine>> {
        // An engine frames every stream the same way, but `alpn_select_cb` picks from the whole list.
        let Some(is_http) = alpn_is_http(&config.alpn) else {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "options.alpn cannot mix HTTP/3 and non-HTTP/3 protocols on one endpoint; use a separate QuicEndpoint for each"
                    ),
                )
                .throw());
        };
        let mut settings = lsquic::Settings::new(is_server, is_http);
        // Node always advertises datagram support.
        settings.datagrams(1);
        // Delayed ACKs send ACK_FREQUENCY, and an lsquic server closes the connection on one in a 0-RTT packet.
        settings.delayed_acks(0);
        // Node's `closed` promise on the peer resolves on receipt of CONNECTION_CLOSE.
        settings.silent_close(0);
        // RFC 9000 sec 10.3: stateless reset.
        settings.send_prst(!self.disable_stateless_reset.get() as c_int);
        settings.honor_prst(1);
        if is_server {
            let burst = self.stateless_reset_burst.get();
            if burst > 0 {
                settings.sreset_burst(burst as c_uint);
                settings.sreset_rate(self.stateless_reset_rate.get());
            }
            let origin_blob = self.origin_blob.get();
            if !origin_blob.is_empty() {
                settings.origin_blob(origin_blob);
            }
        } else {
            // Without `keepAlive`, a Node client sends no PING. lsquic's default sends one every half idle timeout.
            settings.ping_period(0);
        }
        apply_transport_params(global, &mut settings, options)?;
        if let Some(app) = options
            .get(global, "application")?
            .filter(|v| v.is_object())
        {
            if let Some(v) = app.get(global, "enableConnectProtocol")? {
                settings.h3_connect_protocol(v.to_boolean() as c_int);
            }
            if let Some(v) = app.get(global, "enableDatagrams")? {
                // RFC 9297: HTTP/3 datagram support is advertised separately
                // from the transport-level max_datagram_frame_size.
                settings.h3_datagram(v.to_boolean() as c_int);
            }
            if let Some(v) = read_u64_option(global, app, "maxHeaderPairs")? {
                settings.max_h3_header_pairs(v.min(u16::MAX as u64) as u16);
            }
            if let Some(v) = read_u64_option(global, app, "maxHeaderLength")? {
                settings.max_h3_header_bytes(v.min(u32::MAX as u64) as u32);
            }
        }
        let same = |e: &&Rc<Engine>| {
            e.is_server == is_server && e.is_http == is_http && e.settings == settings
        };
        if let Some(engine) = self.engines.get().iter().find(same) {
            return Ok(Rc::clone(engine));
        }
        // SAFETY: `vtable` outlives the engines (held in this struct);
        // `settings` is copied by lsquic before this returns.
        let raw = unsafe {
            lsquic::us_nq_engine_new(
                self.driver().as_mut_ptr().cast(),
                is_server as c_int,
                is_http as c_int,
                self.vtable_ptr.cast_mut(),
                settings.as_ptr(),
            )
        };
        if raw.is_null() {
            return Err(global.throw(format_args!("failed to create QUIC engine")));
        }
        let engine = Rc::new(Engine {
            raw,
            is_server,
            is_http,
            settings,
        });
        self.engines.with_mut(|v| v.push(Rc::clone(&engine)));
        Ok(engine)
    }

    fn release_native(&self) -> bool {
        if self.closed.replace(true) {
            return false;
        }
        self.engines.with_mut(Vec::clear);
        self.udp.set(null_mut());
        if !self.driver.get().is_null() {
            self.driver().close();
        }
        let me = core::ptr::from_ref(self).cast_mut();
        ENDPOINT_REGISTRY.with_borrow_mut(|v| v.retain(|&e| e != me));
        true
    }

    /// `closed` is set FIRST: it gates `schedule_process`, so a
    /// callback running below cannot re-arm a tick onto engines this function
    /// is about to free.
    fn teardown(&self) -> bool {
        if !self.release_native() {
            return false;
        }
        self.server_tls.set(None);
        self.sni_contexts.with_mut(Vec::clear);
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
        // Node closes asynchronously, so the driver's next pass calls onEndpointClose.
        self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        self.pending_endpoint_close.set(true);
        self.driver();
    }

    fn apply_server_session_options(
        &self,
        global: &JSGlobalObject,
        session: *mut QuicSession,
    ) -> JsResult<()> {
        if let Some(options) = self
            .server_session_options
            .get()
            .as_ref()
            .map(bun_jsc::Strong::get)
        {
            // SAFETY: `session` was just created and is live.
            unsafe { (*session).apply_options(global, options) }?;
        }
        Ok(())
    }

    fn deliver_endpoint_close(&self, global: &JSGlobalObject, context: u8, status: c_int) {
        self.poll_ref.with_mut(|p| p.disable());
        callbacks::call(
            global,
            "onEndpointClose",
            self.this_value.get().get(),
            &[
                JSValue::js_number(context as f64),
                JSValue::js_number(status as f64),
            ],
        );
        self.this_value.with_mut(|r| r.downgrade());
        self.vtable.set(None);
        self.free_driver();
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
        if !self.ensure_bound(global, this_value.to_js())? {
            return Ok(());
        }
        if self.server_engine().is_none() {
            let options = options.to_js();
            if options.is_object() {
                self.server_session_options
                    .set(Some(bun_jsc::Strong::create(options, global)));
            }
            let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
            // Authoritative origins for the HTTP/3 ORIGIN frame (RFC 9412
            // sec 2): each Origin-Entry is a 16-bit length prefix followed
            // by the ASCII origin.
            if tls.is_object() {
                if let Some(origins) = tls.get(global, "origins")?.filter(|v| v.is_array()) {
                    let len = origins.get_length(global)? as u32;
                    let mut blob = Vec::new();
                    for i in 0..len {
                        let v = origins.get_index(global, i)?;
                        if !v.is_string() {
                            continue;
                        }
                        let bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
                        if bytes.is_empty() || bytes.len() > u16::MAX as usize {
                            continue;
                        }
                        blob.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
                        blob.extend_from_slice(&bytes);
                    }
                    self.origin_blob.with_mut(|b| *b = blob);
                }
            }
            let mut config = TlsConfig::from_js(global, tls, true)?;
            if config.alpn.is_empty() {
                // Node's default ALPN is `h3`.
                config.alpn = b"\x02h3".to_vec();
            }
            self.server_alpn_wire.set(config.alpn.clone());
            if tls.is_object() {
                if let Some(sni) = tls.get(global, "sni")?.filter(|v| v.is_object()) {
                    let built = Self::build_sni_contexts(global, sni, &config.alpn)?;
                    self.sni_contexts.with_mut(|m| *m = built);
                }
            }
            let server_tls = TlsContext::new(global, &config)?;
            // SAFETY: `teardown` destroys the engines before it drops `server_tls`.
            unsafe { self.driver().set_ssl_ctx(server_tls.raw()) };
            self.server_tls.set(Some(server_tls));
            self.server_verify_client.set(config.verify_client);
            self.engine_for(true, &config, options, global)?;
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
        address: &crate::socket::SocketAddress,
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
        if !self.ensure_bound(global, this_value.to_js())? {
            return Ok(JSValue::UNDEFINED);
        }
        let options = options.to_js();
        let session_ticket = session_ticket.to_js();
        let remote = StoredAddr::from_socket_address(address);
        if let Some(version) = read_u64_option(global, options, "version")?
            .map(|v| v as u32)
            .filter(|v| *v != QUIC_VERSION_1 && *v != QUIC_VERSION_2)
        {
            let min_version = read_u64_option(global, options, "minVersion")?
                .map_or(QUIC_VERSION_1, |v| v as u32);
            return self.connect_verneg_probe(
                global,
                this_value.to_js(),
                remote,
                version,
                min_version,
            );
        }
        let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
        let config = TlsConfig::from_js(global, tls, false)?;
        // Only needed for the `connect` call below: the conn's SSL takes its own reference to the SSL_CTX.
        let tls = TlsContext::new(global, &config)?;
        let engine = self.engine_for(false, &config, options, global)?;
        // Read before the session exists: `QuicSession::create` self-roots, and
        // the conn that follows holds it as its ctx, so a throw after either
        // point has to unwind state that a plain `?` here avoids creating.
        let use_preferred = read_u64_option(global, options, "preferredAddressPolicy")?
            == Some(PREFERRED_ADDRESS_USE);
        let (session, handle) = QuicSession::create(
            global,
            self.vtable_ptr,
            core::ptr::from_ref(self).cast_mut(),
            this_value.to_js(),
            Some(Rc::clone(&engine)),
        )?;
        let resume_blob: Vec<u8> = if config.enable_early_data {
            session_ticket
                .as_array_buffer(global)
                .map_or(Vec::new(), |buf| buf.byte_slice().to_vec())
        } else {
            Vec::new()
        };
        // engine_connect fires on_new_conn synchronously; hold the scope so a
        // schedule_process from inside it cannot re-enter the engine.
        self.send_scope_depth.set(self.send_scope_depth.get() + 1);
        // `options.token` isn't replayed: lsquic breaks the token and zero-rtt tests with it. That costs the Retry RTT it would have saved.
        // SAFETY: the engine is live and remote/tls/sni are valid for this call. `session` is
        // the conn-ctx, at its final address in its wrapper.
        let conn = unsafe {
            uws::quic::Udp::opaque_ref(self.udp.get()).connect(
                engine.raw.cast(),
                remote.as_ptr().cast(),
                tls.raw(),
                session.cast(),
                config.servername.as_ptr().cast(),
                &resume_blob,
            )
        }
        .cast::<lsquic::lsquic_conn>();
        self.send_scope_depth.set(self.send_scope_depth.get() - 1);
        if conn.is_null() {
            // SAFETY: `session` was just created and nothing else owns it.
            unsafe { (*session).teardown(global) };
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: `conn` is live; out-params are stack slots.
        unsafe {
            lsquic::lsquic_conn_set_ctx(conn, session.cast());
            (*session).conn.set(conn);
            (*session).cache_sockaddrs(lsquic::Conn::from_raw(conn).and_then(|c| c.sockaddrs()));
            // `conn` is set above, so teardown clears the conn's ctx and the
            // late callbacks no-op instead of reaching an unrooted session.
            if let Err(e) = (*session).apply_options(global, options) {
                (*session).teardown(global);
                return Err(e);
            }
            if !resume_blob.is_empty() {
                (*session).apply_peer_datagram_budget();
            }
        }
        // SAFETY: `conn` is live (checked above).
        if let Some(c) = unsafe { lsquic::Conn::from_raw(conn) }.filter(|_| use_preferred) {
            c.use_preferred_address(true);
        }
        self.sessions.with_mut(|v| v.push(session));
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        self.schedule_process();
        Ok(handle)
    }

    fn connect_verneg_probe(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        remote: StoredAddr,
        version: u32,
        min_version: u32,
    ) -> JsResult<JSValue> {
        let (session, handle) = QuicSession::create(
            global,
            self.vtable_ptr,
            core::ptr::from_ref(self).cast_mut(),
            this_value,
            None,
        )?;
        let mut dcid = [0u8; VERNEG_PROBE_CID_LEN];
        let mut scid = [0u8; VERNEG_PROBE_CID_LEN];
        bun_boringssl_sys::rand_bytes(&mut dcid);
        bun_boringssl_sys::rand_bytes(&mut scid);
        // RFC 8999 sec 5.1 long header: form+fixed bits, version, then
        // length-prefixed DCID and SCID.
        let mut probe = [0u8; VERNEG_PROBE_LEN];
        probe[0] = HEADER_FORM_LONG | LONG_HEADER_FIXED_BIT;
        probe[1..5].copy_from_slice(&version.to_be_bytes());
        let mut off = LONG_HEADER_DCID_LEN_OFFSET;
        probe[off] = VERNEG_PROBE_CID_LEN as u8;
        off += 1;
        probe[off..off + VERNEG_PROBE_CID_LEN].copy_from_slice(&dcid);
        off += VERNEG_PROBE_CID_LEN;
        probe[off] = VERNEG_PROBE_CID_LEN as u8;
        off += 1;
        probe[off..off + VERNEG_PROBE_CID_LEN].copy_from_slice(&scid);
        // SAFETY: `session` was just created and is kept alive by its JS
        // wrapper (`handle`).
        unsafe {
            (*session).verneg.set(Some((version, min_version)));
            (*session).remote_addr.set(remote);
        }
        self.pending_verneg
            .with_mut(|v| v.push((session, scid, now_ns())));
        // A probe has no engine, so nothing else would ever arm the timer that
        // runs the sweep expiring it.
        self.schedule_process();
        self.sessions.with_mut(|v| v.push(session));
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        let socket = uws::quic::Udp::opaque_ref(self.udp.get()).socket();
        if !socket.is_null() {
            uws::udp::Socket::opaque_mut(socket).send(
                &[probe.as_ptr()],
                &[probe.len()],
                &[remote.as_ptr().cast()],
            );
            self.add_stat(IDX_STATS_PACKETS_SENT, 1);
            self.add_stat(IDX_STATS_BYTES_SENT, probe.len() as u64);
        }
        Ok(handle)
    }

    /// The VN packet's DCID echoes the probe's SCID — RFC 8999 sec 6.
    fn handle_version_negotiation(&self, payload: &[u8]) -> bool {
        if self.pending_verneg.get().is_empty() {
            return false;
        }
        let mut off = LONG_HEADER_DCID_LEN_OFFSET;
        let dcid_len = payload[off] as usize;
        off += 1;
        if dcid_len > MAX_CID_LEN || payload.len() < off + dcid_len + 1 {
            return false;
        }
        let dcid = &payload[off..off + dcid_len];
        off += dcid_len;
        let scid_len = payload[off] as usize;
        off += 1;
        if scid_len > MAX_CID_LEN || payload.len() < off + scid_len {
            return false;
        }
        off += scid_len;
        let session = self.pending_verneg.with_mut(|v| {
            v.iter()
                .position(|(_, probe_scid, _)| probe_scid.as_slice() == dcid)
                .map(|i| v.swap_remove(i).0)
        });
        let Some(session) = session else { return false };
        let mut server_versions = Vec::new();
        while off + VERSION_FIELD_LEN <= payload.len() {
            server_versions.push(u32::from_be_bytes([
                payload[off],
                payload[off + 1],
                payload[off + 2],
                payload[off + 3],
            ]));
            off += VERSION_FIELD_LEN;
        }
        // SAFETY: pending entries are pruned in `unregister_session`, so a
        // matched pointer is live.
        unsafe {
            (*session).push_event(session::SessionEvent::VersionNegotiation { server_versions })
        };
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
            self.this_value
                .with_mut(|r| r.set_strong(this_value.to_js(), cx.global()));
        }
        if self.sessions.get().is_empty() && self.engine_conn_count() == 0 {
            self.finish_close();
        } else {
            self.schedule_process();
        }
    }

    pub(crate) fn release_socket(&self, _: &mut JsScope<'_>) {
        self.pending_endpoint_close.set(false);
        self.teardown();
        self.free_driver();
        self.poll_ref.with_mut(|p| p.disable());
    }

    pub(crate) fn address(&self, cx: &mut JsScope<'_>) -> JSValue {
        self.local_addr.get().to_js_socket_address(cx.global())
    }
    pub(crate) fn mark_busy(&self, busy: bool) {
        // SAFETY: state buffer is live.
        self.with_state(|s| s.busy = busy as u8);
    }
    fn build_sni_contexts(
        global: &JSGlobalObject,
        entries: JSValue,
        alpn: &[u8],
    ) -> JsResult<Vec<(Vec<u8>, TlsContext)>> {
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
            if config.alpn.is_empty() {
                config.alpn = alpn.to_vec();
            }
            out.push((host, TlsContext::new(global, &config)?));
        }
        Ok(out)
    }

    pub(crate) fn set_sni_contexts(
        &self,
        cx: &mut JsScope<'_>,
        entries: JsLocal<'_>,
        replace: bool,
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
        let mut alpn = self.server_alpn_wire.get().clone();
        if alpn.is_empty() {
            alpn = b"\x02h3".to_vec();
        }
        let built = Self::build_sni_contexts(global, entries.to_js(), &alpn)?;
        self.sni_contexts.with_mut(|map| {
            if replace {
                map.clear();
            }
            for (host, ctx) in built {
                if let Some(slot) = map.iter_mut().find(|(h, _)| h.eq_ignore_ascii_case(&host)) {
                    slot.1 = ctx;
                } else {
                    map.push((host, ctx));
                }
            }
        });
        Ok(())
    }

    /// Swaps in close callbacks that are safe to run during VM teardown.
    ///
    /// Teardown finalizes endpoints, sessions and streams in any order, so
    /// `lsquic_engine_destroy` can call back for a session or stream that's already freed.
    /// `Drop` nulls a freed object's lsquic ctx, and for a live one these callbacks
    /// don't dereference session or endpoint pointers.
    fn detach_for_finalize(&self) {
        self.sessions.with_mut(Vec::clear);
        self.pending_new_sessions.with_mut(Vec::clear);
        self.pending_verneg.with_mut(Vec::clear);
        self.vtable.with_mut(|vt| {
            if let Some(vt) = vt.as_mut() {
                vt.owner = null_mut();
                vt.on_stream_close = stream::QuicStream::on_close_detached;
                vt.on_conn_closed = QuicSession::on_closed_detached;
                vt.on_mini_conn_failed = QuicSession::on_mini_conn_failed_detached;
            }
        });
    }
}

impl Drop for QuicEndpoint {
    fn drop(&mut self) {
        self.detach_for_finalize();
        self.release_native();
        self.free_driver();
    }
}
