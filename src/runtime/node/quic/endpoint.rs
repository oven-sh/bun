//! `QuicEndpoint` native handle (lsquic-backed) — Node's
//! `internalBinding('quic').Endpoint` analog (node/src/quic/endpoint.{h,cc}).
//!
//! The endpoint owns one uSockets UDP socket and up to two lsquic engines
//! (server-mode for `listen()`, client-mode for `connect()`). UDP receive
//! feeds `lsquic_engine_packet_in`; lsquic's `ea_packets_out` writes via the
//! same socket. `lsquic_engine_process_conns` is driven from the endpoint's
//! `EventLoopTimer`, rearmed via `lsquic_engine_earliest_adv_tick`.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{null, null_mut};

use bun_io::KeepAlive;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSType, JSValue, JsCell, JsRef, JsResult,
    StringJsc,
};
use bun_lsquic_sys as lsquic;
use bun_uws as uws;

use crate::jsc_hooks::timer_all_mut as timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

use super::callbacks;
use super::ffi::lsquic_callback;
use super::now_ns;
use super::session::{self, QuicSession, SOCKADDR_IN_LEN, SOCKADDR_IN6_LEN, StoredAddr};
use super::stream;
use super::tls::{TlsConfig, TlsContext};

bun_core::declare_scope!(quic, hidden);

/// Mirrors Node's `Endpoint::State`.
#[repr(C)]
pub struct EndpointState {
    pub bound: u8,
    pub receiving: u8,
    pub listening: u8,
    pub closing: u8,
    pub busy: u8,
    pub max_connections_per_host: u16,
    pub max_connections_total: u16,
    pub pending_callbacks: u64,
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
/// Long-header packet type bits (byte0 5:4) for an Initial packet.
const INITIAL_TYPE_V1: u8 = 0b00; // RFC 9000 §17.2
const INITIAL_TYPE_V2: u8 = 0b01; // RFC 9369 §3.2
/// Longest connection ID QUIC v1/v2 allow (RFC 9000 §17.2).
const MAX_CID_LEN: usize = 20;
/// Long-header form bit (byte0 bit 7; RFC 8999 §5.1).
const LONG_HEADER_FORM_BIT: u8 = 0x80;
/// Long-header type mask after the 4-bit right shift (byte0 bits 5:4).
const LONG_HEADER_TYPE_MASK: u8 = 0x3;
/// Byte offset of the DCID length in a long-header packet: form/type byte +
/// 4-byte version (RFC 8999 §5.1).
const LONG_HEADER_DCID_LEN_OFFSET: usize = 5;
/// Shortest parseable long header: form byte + version + dcid_len + ≥1 CID
/// byte (RFC 8999 §5.1).
const LONG_HEADER_MIN_LEN: usize = 7;
/// Default advertised `max_datagram_frame_size` when datagrams are enabled
/// without an explicit override (matches Node's 1200-byte default).
const DEFAULT_DATAGRAM_FRAME_SIZE: u64 = 1200;
/// Raw IPv4 / IPv6 address byte lengths.
const IPV4_ADDR_LEN: usize = 4;
const IPV6_ADDR_LEN: usize = 16;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS handshake_failure(40).
const CRYPTO_ERROR_HANDSHAKE_FAILURE: u64 = 0x0100 + 40;
/// Mini-conn handshakes cannot outlive lsquic's 10s default handshake
/// timeout; provisional/dead-peer entries older than this are stale.
const PROVISIONAL_TIMEOUT_NS: u64 = 10_000_000_000;

const IDX_STATS_CREATED_AT: usize = 0;
const IDX_STATS_DESTROYED_AT: usize = 1;
const IDX_STATS_BYTES_RECEIVED: usize = 2;
const IDX_STATS_BYTES_SENT: usize = 3;
const IDX_STATS_PACKETS_RECEIVED: usize = 4;
const IDX_STATS_PACKETS_SENT: usize = 5;
const IDX_STATS_SERVER_SESSIONS: usize = 6;
const IDX_STATS_CLIENT_SESSIONS: usize = 7;
/// `ENDPOINT_STATS_FIELDS[18]` — packets dropped by the block list.
const IDX_STATS_PACKETS_BLOCKED: usize = 18;

pub(crate) const CLOSECONTEXT_CLOSE: u8 = 0;
pub(crate) const CLOSECONTEXT_BIND_FAILURE: u8 = 1;
pub(crate) const CLOSECONTEXT_START_FAILURE: u8 = 2;
pub(crate) const CLOSECONTEXT_RECEIVE_FAILURE: u8 = 3;
pub(crate) const CLOSECONTEXT_SEND_FAILURE: u8 = 4;
pub(crate) const CLOSECONTEXT_LISTEN_FAILURE: u8 = 5;

/// `PREFERRED_ADDRESS_USE` exposed to JS by `node_quic_binding.rs`
/// (`preferredAddressPolicy: 'use'`).
const PREFERRED_ADDRESS_USE: u64 = 1;
/// Node's `DEFAULT_MAX_IDLE_TIMEOUT` (node/src/quic/transportparams.h).
const DEFAULT_MAX_IDLE_TIMEOUT_MS: u64 = 10_000;

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

/// Peer address of a live lsquic conn, if queryable.
fn conn_peer_addr(conn: *mut lsquic::lsquic_conn) -> Option<StoredAddr> {
    let mut local: *const c_void = null();
    let mut peer: *const c_void = null();
    // SAFETY: `conn` is live for the duration of the callback that passed it.
    if unsafe {
        lsquic::lsquic_conn_get_sockaddr(
            conn,
            core::ptr::from_mut(&mut local),
            core::ptr::from_mut(&mut peer),
        )
    } == 0
        && !peer.is_null()
    {
        Some(stored_addr_from_sockaddr(peer))
    } else {
        None
    }
}

/// A server session announced at Initial receipt, not yet bound to an
/// lsquic conn (see `QuicEndpoint::provisional`).
struct ProvisionalSession {
    dcid: Vec<u8>,
    peer: StoredAddr,
    created_ns: u64,
    session: *mut QuicSession,
}

/// Local bind configuration captured from the constructor's processed options.
struct BindConfig {
    /// Presentation-format IP, NUL-terminated for the uSockets call.
    host: Vec<u8>,
    port: u16,
}

impl Default for BindConfig {
    fn default() -> Self {
        BindConfig {
            host: b"127.0.0.1\0".to_vec(),
            port: 0,
        }
    }
}

/// `#[repr(C)]` so `vtable_ptr` is at offset 0 — the C shim reads it via
/// `*(us_nq_vtable**)peer_ctx`. Without it Rust may reorder fields.
#[repr(C)]
pub struct QuicEndpoint {
    /// MUST stay the first field — `ea_get_ssl_ctx`'s `peer_ctx` is the
    /// QuicEndpoint pointer, and the C shim's thunk reads
    /// `*(us_nq_vtable**)peer_ctx` to recover the vtable.
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

    /// The uSockets UDP socket once bound (lazily, on listen/connect).
    socket: Cell<Option<*mut uws::udp::Socket>>,
    bind_config: JsCell<BindConfig>,
    /// Cached `getsockname()` — passed to `lsquic_engine_packet_in` as
    /// `sa_local` and to `lsquic_engine_connect`.
    local_addr: Cell<StoredAddr>,
    poll_ref: JsCell<KeepAlive>,
    this_value: JsCell<JsRef>,

    /// Server engine (created on `listen()`); client engine (on first
    /// `connect()`). Both can coexist on one endpoint — Node allows that.
    server_engine: Cell<*mut lsquic::lsquic_engine>,
    client_engine: Cell<*mut lsquic::lsquic_engine>,
    /// SSL_CTX backing each engine's `ea_get_ssl_ctx`.
    server_tls: JsCell<Option<TlsContext>>,
    client_tls: JsCell<Option<TlsContext>>,
    /// Server: per-hostname identities from `listen({tls:{sni}})` and
    /// `setSNIContexts()`, consulted by `lookup_cert`. `*` is the fallback
    /// and is also installed as `server_tls`.
    sni_contexts: JsCell<Vec<(Vec<u8>, TlsContext)>>,
    /// Wire-format ALPN list (`[len][name]...`) from `listen()`, reused when
    /// `setSNIContexts` builds a context for an entry without its own.
    server_alpn_wire: JsCell<Vec<u8>>,
    /// Coalescing scratch for `packets_out`. lsquic hands a multi-iovec spec
    /// when it coalesces Initial/Handshake/0-RTT packets into one datagram;
    /// grows to the largest such datagram and is reused after that.
    send_scratch: JsCell<Vec<u8>>,
    /// NUL-terminated ALPN string for the client engine's `ea_alpn` (must
    /// outlive the engine; lsquic stores the pointer).
    client_alpn: JsCell<Vec<u8>>,
    server_alpn: JsCell<Vec<u8>>,
    /// Whether the matching engine was created with `LSENG_HTTP` (HTTP/3
    /// application — lsquic owns ALPN, headers go through `ea_hsi_if`).
    server_is_http: Cell<bool>,
    client_is_http: Cell<bool>,
    /// `verifyClient` on `listen()`: server sessions whose peer presented no
    /// certificate are closed post-handshake (TLS 1.3 semantics).
    pub(super) server_verify_client: Cell<bool>,
    /// The `listen()` session options, applied to each incoming server
    /// session (application options, datagramDropPolicy, ...).
    server_session_options: JsCell<Option<bun_jsc::Strong>>,
    /// `endpoint.disableStatelessReset` — the server engine never sends
    /// stateless resets when set.
    disable_stateless_reset: Cell<bool>,
    /// `endpoint.statelessResetBurst` / `statelessResetRate` (global token
    /// bucket; burst 0 = unlimited).
    stateless_reset_burst: Cell<u32>,
    stateless_reset_rate: Cell<f64>,
    /// Pre-encoded HTTP/3 ORIGIN frame payload (RFC 9412) built from the
    /// listen options' authoritative SNI hostnames. lsquic borrows the
    /// bytes for the engine's lifetime — set before engine creation, never
    /// mutated afterwards.
    origin_blob: JsCell<Vec<u8>>,

    /// Guards re-entry: lsquic forbids `process_conns` while already inside
    /// it, and our `packets_out` runs inside `process_conns`.
    processing: Cell<bool>,
    /// Live sessions for event dispatch and graceful-close tracking.
    sessions: JsCell<Vec<*mut QuicSession>>,
    /// Server sessions whose `onSessionNew` JS callback has not yet fired.
    /// What `apply_transport_params` configured, for `localTransportParams`.
    pub(super) server_local_tp: JsCell<lsquic::NqTransportParams>,
    pub(super) client_local_tp: JsCell<lsquic::NqTransportParams>,
    pending_new_sessions: JsCell<Vec<*mut QuicSession>>,
    /// Server sessions announced at Initial receipt (Node's event order),
    /// awaiting their lsquic conn (mini-conn promotion). Keyed by the
    /// client's DCID; the peer address disambiguates at bind time.
    provisional: JsCell<Vec<ProvisionalSession>>,
    /// Version-negotiation probe sessions awaiting the server's Version
    /// Negotiation packet, keyed by the probe's SCID (which the server
    /// echoes as the VN packet's DCID). Pruned in `unregister_session`.
    pending_verneg: JsCell<Vec<(*mut QuicSession, [u8; VERNEG_PROBE_CID_LEN])>>,
    /// Peers whose provisional session was destroyed before its conn bound
    /// (e.g. a throwing `onsession` handler). Their promotion must not
    /// announce a second session; the conn is refused instead.
    dead_provisional_peers: JsCell<Vec<(StoredAddr, u64)>>,
    /// Source-address packet filter (`options.blockList`). The Strong keeps
    /// the JS wrapper (and the native object it owns) alive.
    block_list: Cell<Option<*mut crate::node::net::block_list::BlockList>>,
    /// Keylog lines fired during the mini-conn phase (no conn-ctx yet),
    /// keyed by the SSL pointer; drained by `QuicSession::bind_conn` at
    /// promotion (the enc session's SSL is transferred to the full conn).
    early_keylog: JsCell<Vec<(*mut c_void, Vec<u8>)>>,
    block_list_js: JsCell<Option<bun_jsc::Strong>>,
    /// `blockListPolicy: 'allow'` — the list is an allow-list instead.
    block_list_allow: Cell<bool>,
    /// Drives `process_conns` and the deferred `onEndpointClose`.
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pending_endpoint_close: Cell<bool>,

    global: Cell<*const JSGlobalObject>,
}

bun_event_loop::impl_timer_owner!(QuicEndpoint; from_timer_ptr => event_loop_timer);

/// The UDP socket cleared its backlog after a short send: hand lsquic the
/// packets it queued when `packets_out` reported backpressure. Without this
/// the engine only retries after its 1s `resume_sending_at` deadline.
extern "C" fn on_drain(socket: *mut uws::udp::Socket) {
    let user = uws::udp::Socket::opaque_mut(socket).user();
    if user.is_null() {
        return;
    }
    // SAFETY: `user` is the heap-allocated QuicEndpoint, live until close.
    let this = unsafe { &*user.cast::<QuicEndpoint>() };
    if this.closed.get() {
        return;
    }
    for engine in [this.server_engine.get(), this.client_engine.get()] {
        if !engine.is_null() {
            // SAFETY: engines are live while the endpoint is not closed.
            unsafe { lsquic::lsquic_engine_send_unsent_packets(engine) };
        }
    }
    this.schedule_process();
}
extern "C" fn on_close(_socket: *mut uws::udp::Socket) {}
extern "C" fn on_recv_error(_socket: *mut uws::udp::Socket, _errno: c_int) {}

thread_local! {
    /// Bound endpoints on this JS thread, for cross-endpoint routing: a
    /// server may advertise ANOTHER local endpoint's address as its
    /// preferred_address (RFC 9000 sec 9.6) — migrated packets then arrive
    /// at that endpoint's socket but belong to this endpoint's engine, and
    /// replies must leave through the socket bound to the new local
    /// address.
    static ENDPOINT_REGISTRY: core::cell::RefCell<Vec<*mut QuicEndpoint>> =
        const { core::cell::RefCell::new(Vec::new()) };
}

/// The endpoint bound to `addr` on this thread, if any (excluding `not`).
fn registry_find_by_addr(addr: &StoredAddr, not: *const QuicEndpoint) -> Option<*mut QuicEndpoint> {
    let want = addr.decode().map(|(f, p, ip)| (f, p, ip.to_vec()));
    ENDPOINT_REGISTRY.with_borrow(|v| {
        v.iter().copied().find(|&e| {
            if core::ptr::eq(e, not) {
                return false;
            }
            // SAFETY: registered endpoints are unregistered in finish_close
            // before they can be freed.
            let theirs = unsafe { (*e).local_addr.get() };
            theirs.decode().map(|(f, p, ip)| (f, p, ip.to_vec())) == want
        })
    })
}

/// Header byte 0 bit 7 (RFC 8999 sec 5.1): 1 = long header, 0 = short.
const HEADER_FORM_LONG: u8 = 0x80;
/// Minimum stateless reset size (RFC 9000 sec 10.3: header byte + 4+ random
/// bytes + 16-byte token).
const STATELESS_RESET_MIN_LEN: usize = 21;
/// RFC 8999 sec 5.1: the second header bit is fixed to 1.
const LONG_HEADER_FIXED_BIT: u8 = 0x40;
/// A Version Negotiation packet carries version 0 (RFC 8999 sec 6).
const VERSION_NEGOTIATION_VERSION: [u8; 4] = [0, 0, 0, 0];
/// Each entry of a Version Negotiation packet's supported-version list.
const VERSION_FIELD_LEN: usize = 4;
/// CID length used for version-negotiation probe packets.
const VERNEG_PROBE_CID_LEN: usize = 8;
/// RFC 9000 sec 14.1: servers may drop Initial-like datagrams smaller than
/// 1200 bytes, so the probe pads to the minimum.
const VERNEG_PROBE_LEN: usize = 1200;
/// Short-header DCIDs on our engines use lsquic's default CID length.
const SHORT_HEADER_DCID_LEN: usize = 8;

extern "C" fn on_data(
    socket: *mut uws::udp::Socket,
    buf: *mut uws::udp::PacketBuffer,
    packets: c_int,
) {
    let user = uws::udp::Socket::opaque_mut(socket).user();
    if user.is_null() {
        return;
    }
    // SAFETY: `user` was set to the heap-allocated QuicEndpoint at bind time
    // and stays live until close; all mutated fields are Cell-based.
    let this = unsafe { &*user.cast::<QuicEndpoint>() };
    let global_ptr = this.global.get();
    if global_ptr.is_null() {
        return;
    }
    // SAFETY: endpoints only exist on the JS thread of this realm and the
    // global outlives every live endpoint.
    let global = unsafe { &*global_ptr };
    let local = this.local_addr.get();
    // See `process()` — `packet_in` is the other entry point that reaches
    // `SSL_do_handshake`.
    bun_boringssl_sys::ERR_clear_error();
    for i in 0..packets {
        let payload = uws::udp::PacketBuffer::opaque_mut(buf).get_payload(i);
        let peer = uws::udp::PacketBuffer::opaque_mut(buf).get_peer(i);
        if payload.is_empty() {
            continue;
        }
        this.add_stat(IDX_STATS_PACKETS_RECEIVED, 1);
        this.add_stat(IDX_STATS_BYTES_RECEIVED, payload.len() as u64);
        // Source-address filter: a deny-listed (or, under 'allow' policy,
        // unlisted) peer's packets are dropped before lsquic sees them.
        if let Some(bl) = this.block_list.get() {
            // SAFETY: the Strong in `block_list_js` keeps the wrapper (and
            // native object) alive for the endpoint's lifetime; `peer` is
            // the live sockaddr for this packet.
            let listed = unsafe { (*bl).check_sockaddr(&*core::ptr::from_ref(peer).cast()) };
            if listed != this.block_list_allow.get() {
                this.add_stat(IDX_STATS_PACKETS_BLOCKED, 1);
                continue;
            }
        }
        // A short-header packet whose DCID belongs to another local
        // endpoint's engine is a migration onto OUR address (we are some
        // server's advertised preferred_address): feed it to the owning
        // engine with THIS socket's local address so lsquic validates the
        // new path.
        if payload[0] & HEADER_FORM_LONG == 0 && payload.len() > 1 + SHORT_HEADER_DCID_LEN {
            let dcid = &payload[1..1 + SHORT_HEADER_DCID_LEN];
            let mine = [this.server_engine.get(), this.client_engine.get()]
                .into_iter()
                .filter(|e| !e.is_null())
                .any(|e| {
                    // SAFETY: engines are live while the endpoint is.
                    let in_use =
                        unsafe { lsquic::lsquic_engine_cid_in_use(e, dcid.as_ptr(), dcid.len()) };
                    in_use != 0
                });
            if !mine {
                let owner = ENDPOINT_REGISTRY.with_borrow(|v| {
                    v.iter().copied().find(|&other| {
                        !core::ptr::eq(other, this)
                            && [
                                // SAFETY: registered endpoints outlive their
                                // registry entry.
                                unsafe { (*other).server_engine.get() },
                                // SAFETY: as above.
                                unsafe { (*other).client_engine.get() },
                            ]
                            .into_iter()
                            .filter(|e| !e.is_null())
                            .any(|e| {
                                // SAFETY: as above.
                                let in_use = unsafe {
                                    lsquic::lsquic_engine_cid_in_use(e, dcid.as_ptr(), dcid.len())
                                };
                                in_use != 0
                            })
                    })
                });
                if let Some(owner) = owner {
                    // SAFETY: as above; the packet is fed with OUR local
                    // address (the migration target).
                    let other = unsafe { &*owner };
                    for engine in [other.server_engine.get(), other.client_engine.get()] {
                        if engine.is_null() {
                            continue;
                        }
                        // SAFETY: as in the direct feed below.
                        unsafe {
                            lsquic::lsquic_engine_packet_in(
                                engine,
                                payload.as_ptr(),
                                payload.len(),
                                local.as_ptr().cast(),
                                core::ptr::from_ref(peer).cast(),
                                owner.cast(),
                                0,
                            );
                        }
                    }
                    other.process(global);
                    continue;
                }
                // No local engine claims this DCID. It may be a stateless
                // reset — the DCID is random by design and only the token in
                // the packet's tail identifies it (RFC 9000 sec 10.3) — so
                // let every other local endpoint's engines check their
                // reset-token hashes. lsquic makes each reset response
                // strictly smaller than the packet that triggered it and
                // refuses below the 21-byte minimum, so this cannot loop.
                if payload.len() >= STATELESS_RESET_MIN_LEN {
                    let others: Vec<*mut QuicEndpoint> = ENDPOINT_REGISTRY.with_borrow(|v| {
                        v.iter()
                            .copied()
                            .filter(|&other| !core::ptr::eq(other, this))
                            .collect()
                    });
                    for other_ptr in others {
                        // SAFETY: registered endpoints outlive their entry;
                        // the borrow above ended, so re-entrant registry
                        // mutation from process() is fine.
                        let other = unsafe { &*other_ptr };
                        for engine in [other.server_engine.get(), other.client_engine.get()] {
                            if engine.is_null() {
                                continue;
                            }
                            // SAFETY: as in the direct feed below.
                            unsafe {
                                lsquic::lsquic_engine_packet_in(
                                    engine,
                                    payload.as_ptr(),
                                    payload.len(),
                                    local.as_ptr().cast(),
                                    core::ptr::from_ref(peer).cast(),
                                    other_ptr.cast(),
                                    0,
                                );
                            }
                        }
                        other.process(global);
                    }
                }
            }
        }
        // A Version Negotiation packet (long header, version 0 — RFC 8999
        // sec 6) answers one of our unsupported-version probes; it must not
        // reach lsquic, which has no conn for it.
        if payload.len() > LONG_HEADER_MIN_LEN
            && payload[0] & HEADER_FORM_LONG != 0
            && payload[1..5] == VERSION_NEGOTIATION_VERSION
            && this.handle_version_negotiation(payload)
        {
            continue;
        }
        // Node announces server sessions at Initial receipt — before the
        // handshake — so `onsession` precedes the client's `opened`.
        this.maybe_announce_provisional(global, payload, core::ptr::from_ref(peer).cast());
        for engine in [this.server_engine.get(), this.client_engine.get()] {
            if engine.is_null() {
                continue;
            }
            // SAFETY: `engine` is live while the endpoint is; payload/local/
            // peer are valid for this callback.
            unsafe {
                lsquic::lsquic_engine_packet_in(
                    engine,
                    payload.as_ptr(),
                    payload.len(),
                    local.as_ptr().cast(),
                    core::ptr::from_ref(peer).cast(),
                    user.cast(),
                    0,
                );
            }
        }
    }
    this.process(global);
}

lsquic_callback! {
    /// A server mini-conn was destroyed without promoting (handshake failure or
    /// client abandonment) — fail the provisional session announced for it.
    fn on_mini_conn_failed(this: &QuicEndpoint, peer_sa: *const c_void, error_code: u64) {
        /// CRYPTO_ERROR base (RFC 9001 §4.8) + TLS no_application_protocol(120).
        const CRYPTO_ERROR_NO_APPLICATION_PROTOCOL: u64 = 0x0100 + 120;
        if peer_sa.is_null() {
            return;
        }
        let peer = stored_addr_from_sockaddr(peer_sa);
        let peer_decoded = peer.decode();
        let failed = this.provisional.with_mut(|v| {
            let idx = v.iter().position(|p| p.peer.decode() == peer_decoded);
            idx.map(|i| v.remove(i).session)
        });
        if let Some(session) = failed {
            if let Some(session) = this.live_session(session) {
                // TEC_NO_ERROR from lsquic means the client abandoned the
                // handshake without a stated reason — surface it as a
                // handshake failure either way (Node rejects `opened`).
                let code = if error_code == 0 {
                    CRYPTO_ERROR_HANDSHAKE_FAILURE
                } else {
                    error_code
                };
                let reason: &[u8] = if code == CRYPTO_ERROR_NO_APPLICATION_PROTOCOL {
                    b"no application protocol"
                } else {
                    b"handshake failed"
                };
                session.push_event(session::SessionEvent::PeerClose {
                    app_error: false,
                    code,
                    reason: reason.to_vec(),
                });
                session.push_event(session::SessionEvent::Closed);
                session.schedule_process();
            }
        }
    }

    /// `ea_packets_out` thunk target.
    fn packets_out(
        this: &QuicEndpoint,
        specs: *const lsquic::lsquic_out_spec,
        n: c_uint,
    ) -> c_int = 0; {
        let Some(socket) = this.socket.get() else {
            return 0;
        };
        let my_addr = this.local_addr.get();
        // SAFETY: pure constant query.
        let stride = unsafe { lsquic::us_nq_spec_stride() };
        let mut sent = 0;
        for i in 0..n as usize {
            // SAFETY: lsquic guarantees `specs[0..n]` is valid for this callback;
            // each spec is `stride` bytes apart.
            let spec = unsafe {
                specs
                    .cast::<u8>()
                    .add(i * stride)
                    .cast::<lsquic::lsquic_out_spec>()
            };
            let mut iovlen: usize = 0;
            // SAFETY: as above.
            let iov = unsafe { lsquic::us_nq_spec_iov(spec, core::ptr::from_mut(&mut iovlen)) };
            let mut total = 0usize;
            // One iovec (the common case): send straight from lsquic's buffer.
            // Several: lsquic coalesced Initial/Handshake/0-RTT into one datagram,
            // so gather them. Never truncate — a clipped datagram fails AEAD at
            // the peer while we would have counted it sent, stalling the conn.
            let mut payload = core::ptr::null::<u8>();
            if iovlen == 1 {
                // SAFETY: as above.
                let v = unsafe { &*iov };
                if !v.iov_base.is_null() {
                    payload = v.iov_base.cast::<u8>();
                    total = v.iov_len;
                }
            } else if iovlen > 1 {
                this.send_scratch.with_mut(|buf| {
                    buf.clear();
                    for j in 0..iovlen {
                        // SAFETY: as above.
                        let v = unsafe { &*iov.add(j) };
                        if v.iov_base.is_null() || v.iov_len == 0 {
                            continue;
                        }
                        // SAFETY: lsquic guarantees `iov_base[..iov_len]` is valid.
                        let src =
                            unsafe { core::slice::from_raw_parts(v.iov_base.cast::<u8>(), v.iov_len) };
                        buf.extend_from_slice(src);
                    }
                    total = buf.len();
                });
                // Read after the last `extend_from_slice`, so a realloc cannot
                // leave it dangling. Nothing below touches `send_scratch`.
                payload = this.send_scratch.get().as_ptr();
            }
            // SAFETY: `dest` points at lsquic-owned sockaddr storage valid for
            // this callback.
            let dest = StoredAddr::from_raw(
                unsafe { lsquic::us_nq_spec_dest(spec) }.cast(),
                SOCKADDR_IN6_LEN,
            );
            if total == 0 || payload.is_null() || !dest.is_set() {
                sent += 1;
                continue;
            }
            // Migration: a spec whose local address is not ours belongs to a
            // path through another local endpoint's socket (we advertised its
            // address as preferred_address) — the peer expects the reply FROM
            // that address.
            // SAFETY: `local_sa` points at lsquic-owned storage valid for this
            // callback.
            let spec_local = StoredAddr::from_raw(
                unsafe { lsquic::us_nq_spec_local(spec) }.cast(),
                SOCKADDR_IN6_LEN,
            );
            let out_socket = if spec_local.is_set() && spec_local.decode() != my_addr.decode() {
                registry_find_by_addr(&spec_local, this)
                    // SAFETY: registered endpoints outlive their registry entry.
                    .and_then(|other| unsafe { (*other).socket.get() })
                    .unwrap_or(socket)
            } else {
                socket
            };
            let rv = uws::udp::Socket::opaque_mut(out_socket).send(
                &[payload],
                &[total],
                &[dest.as_ptr().cast()],
            );
            if rv < 1 {
                // lsquic pauses and retries only on EAGAIN/EWOULDBLOCK; every
                // other errno reaches `close_conn_on_send_error`. An unconnected
                // UDP socket surfaces a pending ICMP error on the *next* send to
                // any peer, so the error isn't attributable to this spec — map it
                // to EAGAIN and let `on_drain` resume, exactly as `quic.c` does.
                // SAFETY: `errno_ptr()` is this thread's errno slot.
                unsafe {
                    let e = bun_core::ffi::errno_ptr();
                    if *e != libc::EAGAIN && *e != libc::EWOULDBLOCK {
                        *e = libc::EAGAIN;
                    }
                }
                // `us_udp_socket_send` re-arms WRITABLE on a short send, so
                // `on_drain` resumes us when the socket clears.
                break;
            }
            this.add_stat(IDX_STATS_PACKETS_SENT, 1);
            this.add_stat(IDX_STATS_BYTES_SENT, total as u64);
            sent += 1;
        }
        sent as c_int
    }

    fn get_ssl_ctx(this: &QuicEndpoint, _local: *const c_void) -> *mut lsquic::SSL_CTX = null_mut(); {
        // The server engine asks first; fall back to the client context.
        this.server_tls
            .get()
            .as_ref()
            .or_else(|| this.client_tls.get().as_ref())
            .map(|t| t.raw().cast())
            .unwrap_or(null_mut())
    }
}

/// Node's SNI resolution order: exact hostname, then a `*.suffix` wildcard,
/// then the `*` default. Comparison is ASCII-case-insensitive (RFC 6066).
fn match_sni<'a>(entries: &'a [(Vec<u8>, TlsContext)], host: &[u8]) -> Option<&'a TlsContext> {
    let eq = |a: &[u8], b: &[u8]| a.eq_ignore_ascii_case(b);
    if let Some((_, ctx)) = entries.iter().find(|(h, _)| eq(h, host)) {
        return Some(ctx);
    }
    // `*.example.com` matches exactly one leading label of `a.example.com`.
    if let Some(dot) = host.iter().position(|&b| b == b'.') {
        let suffix = &host[dot..]; // ".example.com"
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
        owner: *mut c_void as this: &QuicEndpoint,
        local: *const c_void,
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
        // No servername, or no entry for it: the endpoint's default identity.
        // SAFETY: same delegation as get_ssl_ctx.
        unsafe { get_ssl_ctx(owner, local) }
    }
}

/// HTTP/3 when the first configured ALPN is absent, `h3`, or an `h3-*`
/// draft (Node's documented default is `'h3'`). lsquic then owns the wire
/// ALPN and the h3 framing. Mirrored by `alpnWantsHttp` in `quic.ts`.
fn alpn_cstr_is_http(alpn_cstr: &[u8]) -> bool {
    match alpn_cstr.strip_suffix(b"\0") {
        None | Some(b"") => true,
        Some(a) => a == b"h3" || a.starts_with(b"h3-"),
    }
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

/// The advertised `max_datagram_frame_size` for the `localTransportParams`
/// snapshot: 0 when datagrams are off, the configured override when set,
/// else the 1200 default the engine advertises.
fn snapshot_datagram_frame_size(s: &lsquic::Settings) -> u64 {
    if s.get_datagrams() == 0 {
        return 0;
    }
    match s.get_max_datagram_frame_size() {
        0 => DEFAULT_DATAGRAM_FRAME_SIZE,
        v => v,
    }
}

/// Map the processed `options.transportParams` and the per-session timing
/// options onto the lsquic engine settings. lsquic settings are engine-wide
/// (one engine per endpoint), which matches Node's per-endpoint listen
/// options. Values lsquic does not expose (`ack_delay_exponent`,
/// `max_ack_delay`, `active_connection_id_limit`) are silently ignored.
fn apply_transport_params(
    global: &JSGlobalObject,
    s: &mut lsquic::Settings,
    options: JSValue,
    local_tp: &mut lsquic::NqTransportParams,
) -> JsResult<()> {
    // Node's default max_idle_timeout is 10 seconds
    // (node/src/quic/transportparams.h DEFAULT_MAX_IDLE_TIMEOUT); lsquic's
    // is 30. Several tests rely on idle sessions ending within Node's
    // window (an explicit maxIdleTimeout below overrides this).
    s.idle_timeout(10);
    if !options.is_object() {
        // Still snapshot the defaults.
        local_tp.max_idle_timeout = match s.get_idle_timeout_ms() {
            0 => s.get_idle_timeout().saturating_mul(1000),
            ms => ms,
        };
        local_tp.initial_max_data = s.get_init_max_data();
        local_tp.initial_max_stream_data_bidi_local = s.get_init_max_stream_data_bidi_local();
        local_tp.initial_max_stream_data_bidi_remote = s.get_init_max_stream_data_bidi_remote();
        local_tp.initial_max_stream_data_uni = s.get_init_max_stream_data_uni();
        local_tp.initial_max_streams_bidi = s.get_init_max_streams_bidi();
        local_tp.initial_max_streams_uni = s.get_init_max_streams_uni();
        local_tp.max_udp_payload_size = s.get_max_udp_payload_size_rx();
        local_tp.ack_delay_exponent = 3;
        local_tp.max_ack_delay = 25;
        local_tp.active_connection_id_limit = 8;
        local_tp.max_datagram_frame_size = snapshot_datagram_frame_size(s);
        local_tp.disable_active_migration = (s.get_allow_migration() == 0) as c_int;
        return Ok(());
    }
    if let Some(ms) = read_u64_option(global, options, "handshakeTimeout")? {
        s.handshake_to((ms.saturating_mul(1000)).min(c_uint::MAX as u64) as _);
    }
    if let Some(ms) = read_u64_option(global, options, "keepAlive")? {
        // Millisecond-granular cadence (es_ping_period is whole seconds and
        // idle-derived; Node's keepAlive is exact).
        s.ping_period(1);
        s.ping_period_us(ms.saturating_mul(1000));
    }
    if let Some(tp) = options
        .get(global, "transportParams")?
        .filter(|v| v.is_object())
    {
        // preferred_address transport parameter: the 24-byte blob mirrors
        // lsquic's `tp_preferred_address` prefix (lsquic_trans_params.h) —
        // 4-byte IPv4 + u16 port + 16-byte IPv6 + u16 port. IPs are wire
        // order; ports are HOST order (lsquic's encoder does the swap). An
        // all-zero family slot means that family is absent.
        let mut pref = [0u8; 24];
        let mut have_pref = false;
        for (key, is_v4) in [
            ("preferredAddressIpv4", true),
            ("preferredAddressIpv6", false),
        ] {
            let Some(addr_js) = tp.get(global, key)?.filter(|v| v.is_object()) else {
                continue;
            };
            let Some(addr) = crate::generated_classes::js_SocketAddress::from_js(addr_js) else {
                continue;
            };
            // SAFETY: `from_js` returned a live SocketAddress.
            let stored = session::StoredAddr::from_socket_address(unsafe { addr.as_ref() });
            let Some((_family, port, ip)) = stored.decode() else {
                continue;
            };
            if is_v4 && ip.len() == 4 {
                pref[0..4].copy_from_slice(ip);
                pref[4..6].copy_from_slice(&port.to_ne_bytes());
                have_pref = true;
            } else if !is_v4 && ip.len() == 16 {
                pref[6..22].copy_from_slice(ip);
                pref[22..24].copy_from_slice(&port.to_ne_bytes());
                have_pref = true;
            }
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
        if let Some(ms) = read_u64_option(global, tp, "maxIdleTimeout")? {
            // Node's maxIdleTimeout is milliseconds; the ms-granular
            // override takes precedence over the seconds-granular
            // es_idle_timeout default set above.
            s.idle_timeout_ms(ms.min(c_uint::MAX as u64) as _);
        }
        if let Some(v) = read_u64_option(global, tp, "maxUdpPayloadSize")? {
            s.max_udp_payload_size_rx(v.min(u16::MAX as u64) as _);
        }
        if let Some(v) = tp.get(global, "disableActiveMigration")? {
            s.allow_migration(!v.to_boolean() as _);
        }
        if let Some(v) = read_u64_option(global, tp, "maxDatagramFrameSize")? {
            // 0 disables datagrams entirely (the TP is then absent).
            if v == 0 {
                s.datagrams(0);
            } else {
                s.datagrams(1);
                s.max_datagram_frame_size(v.min(u16::MAX as u64) as u16);
            }
        }
    }
    // Snapshot what we configured so `localTransportParams` can echo it.
    *local_tp = lsquic::NqTransportParams {
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
        max_datagram_frame_size: snapshot_datagram_frame_size(s),
        disable_active_migration: (s.get_allow_migration() == 0) as c_int,
        ..lsquic::NqTransportParams::default()
    };
    if let Some(cc) = options.get(global, "cc")?.filter(|v| v.is_string()) {
        let name = bun_core::String::from_js(cc, global)?.to_utf8_bytes();
        // lsquic: 0=DEFAULT, 1=Cubic, 2=BBRv1, 3=adaptive (lsquic.h
        // `LSQUIC_CC_*`).
        let algo = match name.as_slice() {
            b"cubic" => 1,
            b"bbr" => 2,
            _ => 0,
        };
        s.cc_algo(algo);
    }
    Ok(())
}

/// Allocate an ArrayBuffer of `size` zeroed bytes, expose it as `name` on
/// `holder`, and return its backing pointer (owned by the JSC ArrayBuffer,
/// which the wrapper keeps alive via the property).
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
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut Self> {
        // lsquic_global_init is NOT idempotent — iquic_esf_global_init calls
        // SSL_get_ex_new_index and overwrites the static `s_idx`. A second
        // call invalidates every existing SSL's enc_sess lookup, so the
        // quic-method callbacks read NULL and SSL_do_handshake fails.
        static INIT: std::sync::Once = std::sync::Once::new();
        INIT.call_once(|| {
            // SAFETY: pure library init.
            unsafe {
                lsquic::lsquic_global_init(
                    lsquic::LSQUIC_GLOBAL_CLIENT | lsquic::LSQUIC_GLOBAL_SERVER,
                )
            };
            // Process-global like the init above: re-enabling it per endpoint
            // re-reads the environment and re-registers lsquic's log handler.
            if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_lsquic")).is_some() {
                // SAFETY: static C string.
                unsafe { lsquic::us_nq_enable_logging(c"debug".as_ptr()) };
            }
        });
        lsquic::debug_assert_layout();

        let this = QuicEndpoint {
            vtable_ptr: null(),
            vtable: JsCell::new(None),
            state: null_mut(),
            stats: null_mut(),
            closing: Cell::new(false),
            closed: Cell::new(false),
            socket: Cell::new(None),
            bind_config: JsCell::new(BindConfig::default()),
            local_addr: Cell::new(StoredAddr::default()),
            poll_ref: JsCell::new(KeepAlive::init()),
            this_value: JsCell::new(JsRef::empty()),
            server_engine: Cell::new(null_mut()),
            client_engine: Cell::new(null_mut()),
            server_tls: JsCell::new(None),
            sni_contexts: JsCell::new(Vec::new()),
            server_alpn_wire: JsCell::new(Vec::new()),
            send_scratch: JsCell::new(Vec::new()),
            client_tls: JsCell::new(None),
            client_alpn: JsCell::new(Vec::new()),
            server_alpn: JsCell::new(Vec::new()),
            server_is_http: Cell::new(false),
            server_verify_client: Cell::new(false),
            server_session_options: JsCell::new(None),
            disable_stateless_reset: Cell::new(false),
            origin_blob: JsCell::new(Vec::new()),
            stateless_reset_burst: Cell::new(0),
            stateless_reset_rate: Cell::new(0.0),
            client_is_http: Cell::new(false),
            processing: Cell::new(false),
            sessions: JsCell::new(Vec::new()),
            server_local_tp: JsCell::new(lsquic::NqTransportParams::default()),
            client_local_tp: JsCell::new(lsquic::NqTransportParams::default()),
            pending_new_sessions: JsCell::new(Vec::new()),
            provisional: JsCell::new(Vec::new()),
            pending_verneg: JsCell::new(Vec::new()),
            dead_provisional_peers: JsCell::new(Vec::new()),
            block_list: Cell::new(None),
            early_keylog: JsCell::new(Vec::new()),
            block_list_js: JsCell::new(None),
            block_list_allow: Cell::new(false),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::QuicEndpoint,
            )),
            pending_endpoint_close: Cell::new(false),
            global: Cell::new(core::ptr::from_ref(global)),
        };
        let raw = bun_core::heap::into_raw(Box::new(this));

        // Build the vtable now that `raw` is the stable owner pointer.
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
            get_ssl_ctx,
            lookup_cert,
            packets_out,
            on_mini_conn_failed,
        });
        // SAFETY: `raw` was just created and is uniquely owned by the wrapper.
        unsafe {
            (*raw).vtable_ptr = &raw const *vt;
            (*raw).vtable.set(Some(vt));
        }

        // Constructor option: `address` (a SocketAddress) → bind config.
        let [options] = frame.arguments_as_array::<1>();
        if options.is_object() {
            if let Some(addr_js) = options
                .get(global, "address")?
                .filter(|v| !v.is_empty_or_undefined_or_null())
            {
                if let Some(addr) = crate::generated_classes::js_SocketAddress::from_js(addr_js) {
                    // SAFETY: `from_js` returned a live SocketAddress owned by
                    // the JS value.
                    let stored = StoredAddr::from_socket_address(unsafe { addr.as_ref() });
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
                            (*raw).bind_config.set(BindConfig {
                                host: host_nul,
                                port,
                            })
                        };
                    }
                }
            }
            // `blockList` (the native BlockList handle) filters incoming
            // packets by source address; `blockListPolicy: 'allow'` inverts.
            if let Some(bl_js) = options.get(global, "blockList")?.filter(|v| v.is_object()) {
                if let Some(bl) = crate::generated_classes::js_BlockList::from_js(bl_js) {
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
            if let Some(policy) = options
                .get(global, "blockListPolicy")?
                .filter(|v| v.is_string())
            {
                let policy = bun_core::String::from_js(policy, global)?.to_utf8_bytes();
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
            if let Some(v) = options
                .get(global, "statelessResetBurst")?
                .filter(|v| v.is_number())
            {
                let burst = v.as_number().max(0.0).min(u32::MAX as f64) as u32;
                // SAFETY: as above.
                unsafe { (*raw).stateless_reset_burst.set(burst) };
            }
            if let Some(v) = options
                .get(global, "statelessResetRate")?
                .filter(|v| v.is_number())
            {
                // SAFETY: as above.
                unsafe { (*raw).stateless_reset_rate.set(v.as_number().max(0.0)) };
            }
        }

        // Expose the state/stats ArrayBuffers on the wrapper.
        let state_ptr = alloc_exposed_array_buffer(
            global,
            this_value,
            b"state",
            core::mem::size_of::<EndpointState>(),
        )?;
        let stats_ptr = alloc_exposed_array_buffer(
            global,
            this_value,
            b"stats",
            ENDPOINT_STATS_FIELDS.len() * core::mem::size_of::<u64>(),
        )?;
        this_value.put(global, b"stateByteOffset", JSValue::js_number(0.0));
        this_value.put(global, b"statsByteOffset", JSValue::js_number(0.0));
        // SAFETY: `state`/`stats` are write-once before any other access.
        unsafe {
            (*raw).state = state_ptr.cast();
            (*raw).stats = stats_ptr.cast();
            (*raw).write_stat(IDX_STATS_CREATED_AT, now_ns());
        }

        Ok(raw)
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
    /// session's teardown/finalize, so a registered pointer is live on the
    /// JS thread.
    fn live_session(&self, p: *mut QuicSession) -> Option<&QuicSession> {
        // SAFETY: see doc comment.
        self.sessions.get().contains(&p).then(|| unsafe { &*p })
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

    /// Bind the UDP socket if not yet bound. Returns `Ok(false)` when the
    /// bind fails: Node does not throw here — the endpoint is destroyed and
    /// its `closed` promise rejects with `ERR_QUIC_ENDPOINT_CLOSED("Bind
    /// failure", errno)`, delivered synchronously so `endpoint.destroyed` is
    /// already true when `listen()`/`connect()` returns.
    fn ensure_bound(&self, global: &JSGlobalObject, this_value: JSValue) -> JsResult<bool> {
        if self.socket.get().is_some() {
            return Ok(true);
        }
        let mut err: c_int = 0;
        let cfg = self.bind_config.get();
        let socket = uws::udp::Socket::create(
            uws::Loop::get(),
            on_data,
            on_drain,
            on_close,
            on_recv_error,
            cfg.host.as_ptr().cast(),
            cfg.port,
            0,
            Some(&mut err),
            core::ptr::from_ref(self).cast_mut().cast::<c_void>(),
        );
        if socket.is_null() {
            self.this_value
                .with_mut(|r| r.set_strong(this_value, global));
            self.finish_close();
            // `finish_close` schedules the deferred CLOSECONTEXT_CLOSE
            // delivery; cancel it — the bind failure is delivered right here.
            self.pending_endpoint_close.set(false);
            self.deliver_endpoint_close(global, CLOSECONTEXT_BIND_FAILURE, err);
            return Ok(false);
        }
        self.socket.set(Some(socket));
        // Cache the bound address (port + raw IP from the socket, packed into
        // a sockaddr for `lsquic_engine_packet_in`/`connect`).
        let sock = uws::udp::Socket::opaque_mut(socket);
        let port = sock.bound_port();
        let mut ip = [0u8; IPV6_ADDR_LEN];
        let mut len: i32 = ip.len() as i32;
        sock.bound_ip(ip.as_mut_ptr(), &mut len);
        let addr = match len as usize {
            IPV4_ADDR_LEN => {
                crate::socket::SocketAddress::init_ipv4([ip[0], ip[1], ip[2], ip[3]], port as u16)
            }
            IPV6_ADDR_LEN => crate::socket::SocketAddress::init_ipv6(ip, port as u16, 0, 0),
            _ => crate::socket::SocketAddress::init_ipv4([127, 0, 0, 1], port as u16),
        };
        self.local_addr.set(StoredAddr::from_socket_address(&addr));
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
        if self.closed.get() || self.socket.get().is_none() {
            return;
        }
        // Ref the loop while listening or with live sessions; otherwise idle.
        let listening = self.with_state(|s| s.listening) != 0;
        let busy = listening || !self.sessions.get().is_empty();
        let ctx = bun_io::js_vm_ctx();
        self.poll_ref
            .with_mut(|p| if busy { p.ref_(ctx) } else { p.unref(ctx) });
    }

    /// Drive the lsquic engines: `process_conns` → dispatch events → rearm.
    pub(super) fn process(&self, global: &JSGlobalObject) {
        // `teardown` destroyed the engines; a timer armed before it (e.g. the
        // deferred close, or the bind-failure path) must not tick them.
        if self.closed.get() {
            return;
        }
        if self.processing.replace(true) {
            return;
        }
        // Apply (or drop) wire aborts deferred by same-turn stream destroys
        // before the engines tick, so the frames ride this pass's packets.
        for session in self.sessions.get().clone() {
            if let Some(session) = self.live_session(session) {
                session.flush_deferred_aborts();
            }
        }
        // lsquic calls `SSL_do_handshake` inside `process_conns`. BoringSSL's
        // `SSL_get_error` returns SSL_ERROR_SYSCALL when the (thread-local)
        // error queue is non-empty before the call — so a benign error left
        // by an unrelated SSL_CTX setup elsewhere in the process is reported
        // as a handshake failure for whichever mini-conn runs next. Clear it
        // before every drive (and in `on_data`, the other process_conns
        // entry point).
        bun_boringssl_sys::ERR_clear_error();
        for engine in [self.server_engine.get(), self.client_engine.get()] {
            if !engine.is_null() {
                // SAFETY: engine is live while the endpoint is.
                unsafe { lsquic::lsquic_engine_process_conns(engine) };
            }
        }
        self.processing.set(false);
        let server_engine = self.server_engine.get();
        if !server_engine.is_null() {
            let (mut sent, mut limited) = (0u64, 0u64);
            // SAFETY: engine is live while the endpoint is; out-params are
            // stack slots.
            unsafe {
                lsquic::lsquic_engine_sreset_stats(
                    server_engine,
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

        // Announce server-accepted sessions queued by `on_new_conn`.
        loop {
            let Some(session) = self.pending_new_sessions.with_mut(|v| v.pop()) else {
                break;
            };
            let Some(session) = self.live_session(session) else {
                continue;
            };
            let handle = session.handle();
            if let Some(callback) = callbacks::get(global, "onSessionNew") {
                let vm = global.bun_vm().as_mut();
                vm.event_loop_ref().run_callback(
                    callback,
                    global,
                    self.this_value.get().get(),
                    &[handle],
                );
            }
        }
        // Dispatch per-session queued events.
        let sessions: Vec<*mut QuicSession> = self.sessions.get().clone();
        for session in sessions {
            // A previous iteration's user JS can destroy other sessions and
            // trigger GC; only sessions still registered are guaranteed live.
            let Some(session) = self.live_session(session) else {
                continue;
            };
            session.process_events(global);
            session.maybe_finish_deferred_close();
        }
        self.sweep_provisional();
        self.rearm_timer();
        self.update_keepalive();
        if self.closing.get()
            && self.sessions.get().is_empty()
            && self.engine_conn_count() == 0
            && !self.closed.get()
        {
            self.finish_close();
        }
    }

    /// Total live conns lsquic holds across both engines (mini + full).
    fn engine_conn_count(&self) -> u32 {
        let mut n = 0u32;
        for engine in [self.server_engine.get(), self.client_engine.get()] {
            if !engine.is_null() {
                // SAFETY: engines live until finish_close.
                n += unsafe { lsquic::lsquic_engine_conn_count(engine) };
            }
        }
        n
    }

    /// Schedule a `process()` on the next event-loop turn (used when JS
    /// initiates an action — close, write — and lsquic needs to be driven).
    pub(super) fn schedule_process(&self) {
        if self.closed.get() {
            return;
        }
        let next = bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, 1);
        timer_all().update(self.event_loop_timer.as_ptr(), &next);
    }

    fn rearm_timer(&self) {
        if self.closed.get() {
            return;
        }
        let mut earliest_us: Option<i32> = None;
        for engine in [self.server_engine.get(), self.client_engine.get()] {
            if engine.is_null() {
                continue;
            }
            let mut diff: c_int = 0;
            // SAFETY: engine is live.
            if unsafe {
                lsquic::lsquic_engine_earliest_adv_tick(engine, core::ptr::from_mut(&mut diff))
            } != 0
            {
                earliest_us = Some(earliest_us.map_or(diff, |e| e.min(diff)));
            }
        }
        if let Some(us) = earliest_us {
            let ms = (us.max(0) as u64).div_ceil(1000).max(1);
            let next = bun_core::Timespec::ms_from_now(
                bun_core::TimespecMockMode::ForceRealTime,
                ms as i64,
            );
            timer_all().update(self.event_loop_timer.as_ptr(), &next);
        }
    }

    /// Timer-fire dispatch target (registered in `src/runtime/dispatch.rs`).
    pub(crate) fn on_timer_fire(this: *mut Self) {
        // SAFETY: the timer heap only holds timers of live endpoints.
        let this_ref = unsafe { &*this };
        this_ref
            .event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        let global_ptr = this_ref.global.get();
        if global_ptr.is_null() {
            return;
        }
        // SAFETY: as in `on_data`.
        let global = unsafe { &*global_ptr };
        if this_ref.pending_endpoint_close.replace(false) {
            this_ref.deliver_endpoint_close(global, CLOSECONTEXT_CLOSE, 0);
            return;
        }
        this_ref.process(global);
    }

    /// `on_new_conn` callback target — allocate a session and (for the server
    /// engine) queue it for `onSessionNew`. The session pointer becomes the
    /// lsquic conn-ctx.
    /// Parse the datagram's first long-header packet and, for an unseen
    /// DCID on a listening endpoint, create-and-announce a provisional
    /// server session (Node announces at Initial receipt; the lsquic conn
    /// binds at mini-conn promotion in `on_new_conn`).
    fn maybe_announce_provisional(
        &self,
        global: &JSGlobalObject,
        payload: &[u8],
        peer: *const c_void,
    ) {
        if self.server_engine.get().is_null()
            || self.with_state(|s| s.listening) == 0
            || self.closing.get()
        {
            return;
        }
        // Long header: 0b1xxx_xxxx; version != 0 (0 = version negotiation);
        // DCID length-prefixed at byte 5 (RFC 8999 §5.1).
        if payload.len() < LONG_HEADER_MIN_LEN || payload[0] & LONG_HEADER_FORM_BIT == 0 {
            return;
        }
        let version = u32::from_be_bytes([payload[1], payload[2], payload[3], payload[4]]);
        // Initial packets only — later long-header packets (Handshake) carry
        // the server-chosen DCID and would announce a duplicate session.
        // Type bits (byte0 5:4): v1 Initial = 0b00 (RFC 9000 §17.2), v2
        // Initial = 0b01 (RFC 9369 §3.2).
        let type_bits = (payload[0] >> 4) & LONG_HEADER_TYPE_MASK;
        let is_initial = match version {
            QUIC_VERSION_1 => type_bits == INITIAL_TYPE_V1,
            QUIC_VERSION_2 => type_bits == INITIAL_TYPE_V2,
            // Unknown version: lsquic will version-negotiate; don't announce.
            _ => false,
        };
        if !is_initial {
            return;
        }
        let dcid_len = payload[LONG_HEADER_DCID_LEN_OFFSET] as usize;
        let dcid_start = LONG_HEADER_DCID_LEN_OFFSET + 1;
        if dcid_len == 0 || dcid_len > MAX_CID_LEN || payload.len() < dcid_start + dcid_len {
            return;
        }
        let dcid = &payload[dcid_start..dcid_start + dcid_len];
        // Announce only genuinely new connections: follow-up Initials (ACKs
        // switch their DCID to the server-chosen SCID), retransmits of an
        // in-flight handshake, and stragglers of a recently closed conn all
        // carry a CID lsquic already tracks (conn hash or purgatory).
        if self.provisional.get().iter().any(|p| p.dcid == dcid) {
            return;
        }
        // SAFETY: server engine checked non-null above and lives until
        // release_socket.
        let known = unsafe {
            lsquic::lsquic_engine_cid_in_use(self.server_engine.get(), dcid.as_ptr(), dcid.len())
        };
        if known != 0 {
            return;
        }
        let peer_stored = stored_addr_from_sockaddr(peer);
        let peer_decoded = peer_stored.decode();
        // Busy / at capacity: no session is announced; the mini-conn is
        // refused at promotion (`on_new_conn`).
        let (busy, max_conns) = self.with_state(|s| (s.busy, s.max_connections_total));
        if busy != 0 || (max_conns > 0 && self.sessions.get().len() >= max_conns as usize) {
            return;
        }
        bun_core::scoped_log!(
            quic,
            "announce provisional dcid={:02x?} peer={:?}",
            dcid,
            peer_decoded
        );
        let endpoint_handle = self.this_value.get().get();
        if let Ok((session, _handle)) = QuicSession::create(
            global,
            self.vtable_ptr,
            core::ptr::from_ref(self).cast_mut(),
            endpoint_handle,
            null_mut(),
            true,
        ) {
            self.apply_server_session_options(global, session);
            self.sessions.with_mut(|v| v.push(session));
            self.pending_new_sessions.with_mut(|v| v.push(session));
            self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
            self.provisional.with_mut(|v| {
                v.push(ProvisionalSession {
                    dcid: dcid.to_vec(),
                    peer: peer_stored,
                    created_ns: now_ns(),
                    session,
                })
            });
        }
    }

    /// Destroy provisional sessions whose mini-conn died without promoting
    /// (handshake failure/abandonment — lsquic gives no callback for it).
    fn sweep_provisional(&self) {
        let now = now_ns();
        // Two passes so `live_session` (which borrows `sessions`) never
        // nests inside the `provisional` borrow.
        let mut expired: [*mut QuicSession; 4] = [null_mut(); 4];
        let mut n_expired = 0usize;
        self.provisional.with_mut(|v| {
            v.retain(|p| {
                if now.saturating_sub(p.created_ns) < PROVISIONAL_TIMEOUT_NS
                    || n_expired == expired.len()
                {
                    return true;
                }
                expired[n_expired] = p.session;
                n_expired += 1;
                false
            });
        });
        for &session in &expired[..n_expired] {
            if let Some(session) = self.live_session(session) {
                session.push_event(session::SessionEvent::PeerClose {
                    app_error: false,
                    code: CRYPTO_ERROR_HANDSHAKE_FAILURE,
                    reason: b"handshake failed".to_vec(),
                });
                session.push_event(session::SessionEvent::Closed);
            }
        }
        self.dead_provisional_peers
            .with_mut(|d| d.retain(|&(_, at)| now.saturating_sub(at) < PROVISIONAL_TIMEOUT_NS));
    }

    pub(super) fn on_new_conn(&self, conn: *mut lsquic::lsquic_conn) -> *mut QuicSession {
        let global_ptr = self.global.get();
        if global_ptr.is_null() {
            return null_mut();
        }
        // SAFETY: as in `on_data`.
        let global = unsafe { &*global_ptr };
        let endpoint_handle = self.this_value.get().get();
        // The server engine is the only one that calls `on_new_conn` for an
        // incoming connection; the client path passes `conn_ctx` directly to
        // `lsquic_engine_connect`, so this is server-side.
        // Bind the promoted conn to the provisional session announced at
        // Initial receipt — busy/limit were already enforced at announce
        // time, and the provisional itself counts toward `sessions`, so
        // re-checking here would refuse the very connection being promoted.
        // lsquic doesn't expose the original DCID here, so match by peer
        // address (FIFO for multiple in-flight handshakes from one address).
        let peer = conn_peer_addr(conn);
        let provisional = self.provisional.with_mut(|v| {
            let idx = peer
                .as_ref()
                .and_then(|peer| v.iter().position(|p| p.peer.decode() == peer.decode()));
            idx.map(|i| v.remove(i).session)
        });
        if let Some(session) = provisional {
            if let Some(live) = self.live_session(session) {
                live.bind_conn(conn);
                live.push_event(session::SessionEvent::HandshakeDone { ok: true });
                return session;
            }
        }
        let (busy, max_conns) = self.with_state(|s| (s.busy, s.max_connections_total));
        if busy != 0 || (max_conns > 0 && self.sessions.get().len() >= max_conns as usize) {
            // Refuse the connection: send transport CONNECTION_REFUSED so
            // the peer's `closed` rejects with that error.
            // SAFETY: `conn` is the live conn lsquic just created.
            unsafe {
                lsquic::lsquic_conn_abort_error(
                    conn,
                    0,
                    QUIC_TRANSPORT_CONNECTION_REFUSED,
                    core::ptr::null(),
                );
            }
            self.add_stat(IDX_STATS_SERVER_BUSY_COUNT, 1);
            return null_mut();
        }
        // The announced session for this peer was destroyed pre-bind (e.g. a
        // throwing onsession handler): refuse instead of announcing twice.
        let peer_decoded = peer.as_ref().and_then(StoredAddr::decode);
        let was_dead = peer_decoded.is_some()
            && self
                .dead_provisional_peers
                .get()
                .iter()
                .any(|(addr, _)| addr.decode() == peer_decoded);
        if was_dead {
            self.dead_provisional_peers
                .with_mut(|d| d.retain(|(addr, _)| addr.decode() != peer_decoded));
            // The announced session is gone (endpoint destroyed / throwing
            // onsession). Node's dead server goes silent — abort without a
            // CONNECTION_CLOSE so the client sees a timeout, not an error.
            // SAFETY: `conn` is the live conn lsquic just created.
            unsafe { lsquic::lsquic_conn_abort(conn) };
            return null_mut();
        }
        match QuicSession::create(
            global,
            self.vtable_ptr,
            core::ptr::from_ref(self).cast_mut(),
            endpoint_handle,
            conn,
            true,
        ) {
            Ok((session, _handle)) => {
                self.apply_server_session_options(global, session);
                self.sessions.with_mut(|v| v.push(session));
                self.pending_new_sessions.with_mut(|v| v.push(session));
                self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
                // lsquic's `on_hsk_done` is client-only; the server learns
                // via `on_new_conn` (mini-conn promoted to full conn means
                // the handshake completed), so report it now.
                // SAFETY: session was just created.
                unsafe { (*session).push_event(session::SessionEvent::HandshakeDone { ok: true }) };
                session
            }
            Err(_) => null_mut(),
        }
    }

    /// First protocol from the engine's wire-format ALPN (without the length
    /// prefix), for the handshake report. lsquic doesn't surface the
    /// negotiated value.
    pub(super) fn configured_alpn(&self, is_server: bool) -> Option<Vec<u8>> {
        let alpn = if is_server {
            self.server_alpn.get()
        } else {
            self.client_alpn.get()
        };
        // `alpn_cstr` stored a NUL-terminated bare protocol name.
        let bytes = alpn.strip_suffix(b"\0").unwrap_or(alpn);
        if bytes.is_empty() {
            None
        } else {
            Some(bytes.to_vec())
        }
    }

    /// Whether the engine for this side runs in `LSENG_HTTP` mode.
    pub(super) fn is_http(&self, is_server: bool) -> bool {
        if is_server {
            self.server_is_http.get()
        } else {
            self.client_is_http.get()
        }
    }

    /// One `process_conns` pass without event dispatch — used when a packet
    /// must hit the wire mid-callback (the pre-abort ACK flush in
    /// `QuicSession::destroy`).
    pub(super) fn drive_engines_once(&self) {
        if self.processing.replace(true) {
            return;
        }
        bun_boringssl_sys::ERR_clear_error();
        for engine in [self.server_engine.get(), self.client_engine.get()] {
            if !engine.is_null() {
                // SAFETY: engine is live while the endpoint is.
                unsafe { lsquic::lsquic_engine_process_conns(engine) };
                // A short or blocked UDP send leaves packets in lsquic's unsent
                // queue for the writable drain to retry. Both callers flush a
                // close/ACK frame they are about to tear the conn down behind,
                // so that drain never comes — retry here rather than drop the
                // frame and leave the peer to idle out.
                // SAFETY: as above.
                if unsafe { lsquic::lsquic_engine_has_unsent_packets(engine) } != 0 {
                    // SAFETY: as above.
                    unsafe { lsquic::lsquic_engine_send_unsent_packets(engine) };
                }
            }
        }
        self.processing.set(false);
    }

    pub(super) fn unregister_session(&self, session: *mut QuicSession) {
        self.sessions.with_mut(|v| v.retain(|&s| s != session));
        self.pending_new_sessions
            .with_mut(|v| v.retain(|&s| s != session));
        self.pending_verneg
            .with_mut(|v| v.retain(|&(s, _)| s != session));
        // A provisional destroyed before its conn bound: remember the peer
        // so the eventual promotion is refused instead of re-announced.
        let now = now_ns();
        self.provisional.with_mut(|v| {
            v.retain(|p| {
                if p.session != session {
                    return true;
                }
                self.dead_provisional_peers
                    .with_mut(|d| d.push((p.peer, now)));
                false
            })
        });
    }

    fn build_engine(
        &self,
        is_server: bool,
        config: &TlsConfig,
        options: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<*mut lsquic::lsquic_engine> {
        let tls = TlsContext::new(config).map_err(|e| global.throw(format_args!("tls: {}", e)))?;
        // lsquic's `ea_alpn` is a single protocol. Server side enforces
        // negotiated-ALPN == ea_alpn (lsquic_enc_sess_ietf.c:2998); client
        // side offers only that one via `SSL_set_alpn_protos`. Node accepts
        // a list, so own ALPN on the SSL_CTX (alpn_select_cb for server,
        // SSL_CTX_set_alpn_protos for client) and pass NULL here so lsquic
        // skips both. The first protocol is kept for `configured_alpn`'s
        // fallback.
        let alpn_cstr = TlsContext::alpn_cstr(config);
        let is_http = alpn_cstr_is_http(&alpn_cstr);
        if is_server {
            self.server_tls.set(Some(tls));
            self.server_alpn.set(alpn_cstr);
            self.server_is_http.set(is_http);
            self.server_verify_client.set(config.verify_client);
        } else {
            self.client_tls.set(Some(tls));
            self.client_alpn.set(alpn_cstr);
            self.client_is_http.set(is_http);
        }
        let mut settings = lsquic::Settings::new(is_server, is_http);
        // Node always advertises datagram support; the JS layer gates use on
        // `state.maxDatagramSize > 0` (which we set at handshake time).
        settings.datagrams(1);
        // lsquic's delayed-ACKs extension emits spontaneous ACK_FREQUENCY
        // frames — ack-eliciting traffic ngtcp2 never produces. A peer of a
        // silently-destroyed session must go quiet and idle out; unanswered
        // ACK_FREQUENCY probes instead retransmit into a stateless reset.
        settings.delayed_acks(0);
        // lsquic defaults to silent close (LSQUIC_DF_SILENT_CLOSE=1: no
        // CONNECTION_CLOSE on the wire); Node's `closed` promise on the peer
        // resolves on receipt of that frame, so always send it.
        settings.silent_close(0);
        // RFC 9000 sec 10.3: both roles answer packets for unknown
        // connections with a stateless reset (unless disabled), bounded by
        // the endpoint's global token bucket, and both recognize resets via
        // the tokens the peer advertised (transport params /
        // NEW_CONNECTION_ID frames).
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
        }
        let mut local_tp = lsquic::NqTransportParams::default();
        apply_transport_params(global, &mut settings, options, &mut local_tp)?;
        // HTTP/3 application limits enforced by the shim's header-set
        // callbacks (excess pairs/bytes dropped at decode time).
        if let Some(app) = options
            .get(global, "application")?
            .filter(|v| v.is_object())
        {
            if let Some(v) = app
                .get(global, "enableConnectProtocol")?
                .filter(|v| v.is_boolean())
            {
                settings.h3_connect_protocol(v.to_boolean() as c_int);
            }
            if let Some(v) = app
                .get(global, "enableDatagrams")?
                .filter(|v| v.is_boolean())
            {
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
        if is_server {
            self.server_local_tp.set(local_tp);
        } else {
            self.client_local_tp.set(local_tp);
        }
        // SAFETY: `vtable` outlives both engines (held in this struct);
        // `settings` is copied by lsquic before this returns.
        let engine = unsafe {
            lsquic::us_nq_engine_new(
                is_server as c_int,
                is_http as c_int,
                self.vtable_ptr.cast_mut(),
                settings.as_ptr(),
                core::ptr::null(),
            )
        };
        if engine.is_null() {
            return Err(global.throw(format_args!("failed to create QUIC engine")));
        }
        Ok(engine)
    }

    /// Destroy the engines/socket and drop every reference to this endpoint.
    /// Returns false when another path already tore it down.
    ///
    /// `closed` is set FIRST: it gates `schedule_process`/`rearm_timer`, so a
    /// callback running below must not be able to re-arm a tick onto engines
    /// this function is about to free.
    fn teardown(&self) -> bool {
        if self.closed.replace(true) {
            return false;
        }
        // Cancel any armed tick before the engines go away.
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        for engine in [
            self.server_engine.replace(null_mut()),
            self.client_engine.replace(null_mut()),
        ] {
            if !engine.is_null() {
                // SAFETY: engine was created by this endpoint.
                unsafe { lsquic::lsquic_engine_destroy(engine) };
            }
        }
        if let Some(socket) = self.socket.take() {
            uws::udp::Socket::opaque_mut(socket).close();
        }
        let me = core::ptr::from_ref(self).cast_mut();
        ENDPOINT_REGISTRY.with_borrow_mut(|v| v.retain(|&e| e != me));
        self.server_tls.set(None);
        self.client_tls.set(None);
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
        // Defer onEndpointClose to the next turn (Node closes asynchronously).
        //
        // Hold the loop ref until it is delivered. On Windows the internal
        // timer heap is only drained from inside libuv's loop body, which
        // does not run once the loop has no refs — dropping the ref here
        // would strand the timer and `endpoint.closed` would never settle.
        // `deliver_endpoint_close` releases it.
        self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        self.pending_endpoint_close.set(true);
        let next = bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, 1);
        timer_all().update(self.event_loop_timer.as_ptr(), &next);
    }

    /// Apply the stored `listen()` session options to a newly created
    /// server session (the options were validated in JS before `listen`).
    fn apply_server_session_options(&self, global: &JSGlobalObject, session: *mut QuicSession) {
        if let Some(options) = self
            .server_session_options
            .get()
            .as_ref()
            .map(bun_jsc::Strong::get)
        {
            // SAFETY: `session` was just created and is live.
            let _ = unsafe { (*session).apply_options(global, options) };
        }
    }

    pub(super) fn buffer_early_keylog(&self, ssl: *mut c_void, line: Vec<u8>) {
        self.early_keylog.with_mut(|v| v.push((ssl, line)));
    }
    /// Remove and return every buffered keylog line for `ssl`.
    pub(super) fn take_early_keylog(&self, ssl: *mut c_void) -> Vec<Vec<u8>> {
        self.early_keylog.with_mut(|v| {
            let mut out = Vec::new();
            v.retain_mut(|(s, line)| {
                if *s == ssl {
                    out.push(core::mem::take(line));
                    false
                } else {
                    true
                }
            });
            out
        })
    }

    fn deliver_endpoint_close(&self, global: &JSGlobalObject, context: u8, status: c_int) {
        // Balances the ref `finish_close` took to keep the loop alive across
        // the deferred delivery (and is a no-op when it never took one).
        self.poll_ref.with_mut(|p| p.disable());
        if let Some(callback) = callbacks::get(global, "onEndpointClose") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref().run_callback(
                callback,
                global,
                self.this_value.get().get(),
                &[
                    JSValue::js_number(context as f64),
                    JSValue::js_number(status as f64),
                ],
            );
        }
        self.this_value.with_mut(|r| r.downgrade());
        self.vtable.set(None);
    }

    // ── JS-facing surface ────────────────────────────────────────────────

    pub(crate) fn listen(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.closed.get() || self.closing.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        if !self.ensure_bound(global, frame.this())? {
            return Ok(JSValue::UNDEFINED);
        }
        if self.server_engine.get().is_null() {
            let [options] = frame.arguments_as_array::<1>();
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
                        let bytes = bun_core::String::from_js(v, global)?.to_utf8_bytes();
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
                // Node's default ALPN is `h3`; the server's alpn_select_cb is
                // only installed when `config.alpn` is set, and lsquic's
                // post-handshake check requires a negotiated ALPN.
                config.alpn = b"\x02h3".to_vec();
            }
            self.server_alpn_wire.set(config.alpn.clone());
            // Per-hostname identities. The JS layer spreads the `*` entry into
            // the top-level options (which becomes `server_tls`, the fallback)
            // and leaves the full map here.
            if tls.is_object() {
                if let Some(sni) = tls.get(global, "sni")?.filter(|v| v.is_object()) {
                    let built = Self::build_sni_contexts(global, sni, &config.alpn)?;
                    self.sni_contexts.with_mut(|m| *m = built);
                }
            }
            let engine = self.build_engine(true, &config, options, global)?;
            self.server_engine.set(engine);
        }
        // SAFETY: state buffer is live.
        self.with_state(|s| s.listening = 1);
        self.update_keepalive();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn connect(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.closed.get() || self.closing.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        if !self.ensure_bound(global, frame.this())? {
            // The JS layer maps an undefined handle to
            // ERR_QUIC_CONNECTION_FAILED.
            return Ok(JSValue::UNDEFINED);
        }
        let [address, options, session_ticket_arg] = frame.arguments_as_array::<3>();
        let Some(addr) = crate::generated_classes::js_SocketAddress::from_js(address) else {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"address\" argument must be an instance of SocketAddress"),
                )
                .throw());
        };
        // SAFETY: `from_js` returned a live SocketAddress.
        let remote = StoredAddr::from_socket_address(unsafe { addr.as_ref() });
        // An unsupported `version` option can't be spoken by lsquic; send a
        // probe carrying that version instead so the server responds with a
        // Version Negotiation packet.
        if let Some(version) = read_u64_option(global, options, "version")?
            .map(|v| v as u32)
            .filter(|v| *v != QUIC_VERSION_1 && *v != QUIC_VERSION_2)
        {
            let min_version = read_u64_option(global, options, "minVersion")?
                .map_or(QUIC_VERSION_1, |v| v as u32);
            return self.connect_verneg_probe(global, frame.this(), remote, version, min_version);
        }
        let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
        let config = TlsConfig::from_js(global, tls, false)?;
        if self.client_engine.get().is_null() {
            let engine = self.build_engine(false, &config, options, global)?;
            self.client_engine.set(engine);
        } else {
            // lsquic fixes HTTP/3-vs-raw framing per client engine; a later
            // connect that needs the other mode cannot reuse it. The JS layer
            // never routes such a connect here, but an explicit `endpoint:`
            // bypasses that filter -- fail loudly rather than negotiate an
            // ALPN the engine cannot actually frame.
            if alpn_cstr_is_http(&TlsContext::alpn_cstr(&config)) != self.client_is_http.get() {
                let (was, want) = if self.client_is_http.get() {
                    ("an HTTP/3", "raw")
                } else {
                    ("a raw", "HTTP/3")
                };
                return Err(global
                    .err(
                        jsc::ErrorCode::INVALID_STATE,
                        format_args!(
                            "This endpoint's client engine was created for {was} ALPN; use a separate QuicEndpoint for a {want} connection"
                        ),
                    )
                    .throw());
            }
            // Node's TLS options (ca, crl, keylog, ...) are per-session, but
            // the lsquic engine is per-endpoint: build a fresh SSL_CTX from
            // THIS connect's options for `ea_get_ssl_ctx` (called
            // synchronously inside `lsquic_engine_connect`). Each conn's SSL
            // holds a reference to its SSL_CTX, so replacing ours is safe
            // for earlier sessions.
            match TlsContext::new(&config) {
                Ok(fresh) => self.client_tls.set(Some(fresh)),
                Err(e) => return Err(global.throw(format_args!("{e}"))),
            }
        }
        // Engine settings are per-endpoint, but maxIdleTimeout is a
        // per-connect option on a possibly reused endpoint — mirror this
        // connect's value into the engine before the conn is created (the
        // idle analog of the fresh per-connect TlsContext above). Node's
        // DEFAULT_MAX_IDLE_TIMEOUT is 10 seconds when unspecified.
        let idle_ms = options
            .get(global, "transportParams")?
            .filter(|v| v.is_object())
            .map(|tp| read_u64_option(global, tp, "maxIdleTimeout"))
            .transpose()?
            .flatten()
            .unwrap_or(DEFAULT_MAX_IDLE_TIMEOUT_MS);
        // SAFETY: the client engine exists after the branch above.
        unsafe {
            lsquic::lsquic_engine_set_idle_timeout_ms(
                self.client_engine.get(),
                idle_ms.min(c_uint::MAX as u64) as c_uint,
            )
        };
        // Create the session first so its pointer can be the pre-seeded
        // conn-ctx (lsquic still calls `on_new_conn`, but we override it for
        // clients via `conn_ctx` so the JS layer gets the handle back
        // synchronously from connect()).
        let (session, handle) = QuicSession::create(
            global,
            self.vtable_ptr,
            core::ptr::from_ref(self).cast_mut(),
            frame.this(),
            null_mut(),
            false,
        )?;
        // `TlsConfig::from_js` defaults servername to "localhost\0" (Node
        // parity), so the client always sends SNI.
        let sni = config.servername.as_ref();
        let local = self.local_addr.get();
        // A stored session ticket (the blob `on_sess_resume` delivered on a
        // previous connection) enables session resumption + 0-RTT. The
        // SSL_CTX-level early-data flag is fixed at the first connect
        // (engines are per-endpoint), so a per-connect `enableEarlyData:
        // false` is honored by not resuming at all — without the ticket
        // lsquic cannot attempt 0-RTT.
        let resume_blob: Option<Vec<u8>> = if config.enable_early_data {
            session_ticket_arg
                .as_array_buffer(global)
                .map(|buf| buf.byte_slice().to_vec())
        } else {
            None
        };
        let (resume_ptr, resume_len) = match resume_blob.as_deref() {
            Some(b) if !b.is_empty() => (b.as_ptr(), b.len()),
            _ => (null(), 0),
        };
        // SAFETY: engine is live; local/remote/sni/resume are valid for this
        // call (lsquic copies the resume blob); `session` is the
        // heap-allocated conn-ctx.
        let conn = unsafe {
            lsquic::lsquic_engine_connect(
                self.client_engine.get(),
                lsquic::N_LSQVER,
                local.as_ptr().cast(),
                remote.as_ptr().cast(),
                core::ptr::from_ref(self).cast_mut().cast(),
                session.cast(),
                sni.map_or(null(), |s| s.as_ptr().cast()),
                0,
                resume_ptr,
                resume_len,
                null(),
                0,
            )
        };
        if conn.is_null() {
            // SAFETY: session was just created; its wrapper Strong keeps it
            // alive — releasing here is the only owner.
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: `conn` is live; out-params are stack slots.
        unsafe {
            lsquic::lsquic_conn_set_ctx(conn, session.cast());
            (*session).conn.set(conn);
            (*session).cache_sockaddrs(conn);
            (*session).apply_options(global, options)?;
            if resume_len != 0 {
                // 0-RTT resumption: the remembered peer transport params
                // allow datagrams before the handshake completes.
                (*session).apply_peer_datagram_budget();
            }
        }
        // keepAlive is per-session in Node, but lsquic engine settings are
        // shared by every conn on the endpoint — apply this connect's value
        // (0 = disabled) directly on the conn so a reused endpoint does not
        // inherit an earlier session's cadence.
        // SAFETY: `conn` is live (checked above).
        if let Some(c) = unsafe { lsquic::Conn::from_raw(conn) } {
            let keepalive_us = read_u64_option(global, options, "keepAlive")?
                .map_or(0, |ms| ms.saturating_mul(1000));
            c.set_ping_period_us(keepalive_us);
            // `PREFERRED_ADDRESS_USE` from the JS constants
            // (node_quic_binding.rs); 'ignore'/'default' leave migration off.
            if read_u64_option(global, options, "preferredAddressPolicy")?
                == Some(PREFERRED_ADDRESS_USE)
            {
                c.use_preferred_address(true);
            }
        }
        self.sessions.with_mut(|v| v.push(session));
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        self.schedule_process();
        Ok(handle)
    }

    /// `connect()` with a `version` lsquic can't speak: create the session
    /// without an lsquic conn and send a hand-crafted long-header probe
    /// carrying that version. The server's engine answers with a Version
    /// Negotiation packet, which `on_data` routes back to the session via
    /// `handle_version_negotiation`.
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
            null_mut(),
            false,
        )?;
        let mut dcid = [0u8; VERNEG_PROBE_CID_LEN];
        let mut scid = [0u8; VERNEG_PROBE_CID_LEN];
        // SAFETY: plain out-buffers of the stated length.
        unsafe {
            bun_boringssl_sys::RAND_bytes(dcid.as_mut_ptr(), dcid.len());
            bun_boringssl_sys::RAND_bytes(scid.as_mut_ptr(), scid.len());
        }
        // RFC 8999 sec 5.1 long header: form+fixed bits, version, then
        // length-prefixed DCID and SCID; the rest is padding (any payload
        // works — the server can't parse an unknown version past the
        // invariants and responds with Version Negotiation).
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
        self.pending_verneg.with_mut(|v| v.push((session, scid)));
        self.sessions.with_mut(|v| v.push(session));
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        if let Some(socket) = self.socket.get() {
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

    /// Match a Version Negotiation packet against a pending probe (the VN
    /// packet's DCID echoes the probe's SCID — RFC 8999 sec 6) and queue
    /// `onSessionVersionNegotiation`. Returns true when consumed.
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
                .position(|(_, probe_scid)| probe_scid.as_slice() == dcid)
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

    pub(crate) fn close_gracefully(
        &self,
        _global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.closed.get() || self.closing.get() {
            return Ok(JSValue::UNDEFINED);
        }
        self.closing.set(true);
        self.with_state(|s| {
            s.closing = 1;
            s.listening = 0;
        });
        if self.this_value.get().is_empty() {
            self.this_value
                .with_mut(|r| r.set_strong(frame.this(), _global));
        }
        // Only finish now if there are no JS sessions AND lsquic itself
        // holds no conns (mini or full). lsquic only fires `on_new_conn`
        // after the mini-conn handshake promotes, so destroying the engine
        // here would drop in-flight handshakes Node expects `onsession` to
        // see (the FINISHED packet may still be in the kernel recv queue —
        // the next on_data will promote it).
        if self.sessions.get().is_empty() && self.engine_conn_count() == 0 {
            self.finish_close();
        } else {
            self.schedule_process();
        }
        Ok(JSValue::UNDEFINED)
    }

    /// Exit-time sweep (`process.on("exit")`): drop the socket and engines
    /// without delivering `onEndpointClose` — no JS runs after exit. Shares
    /// `teardown` so the `closed` gate, the timer cancel and the registry
    /// removal cannot drift from `finish_close`.
    pub(crate) fn release_socket(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.pending_endpoint_close.set(false);
        self.teardown();
        // No deferred close to wait for — nothing runs after `process.exit`.
        self.poll_ref.with_mut(|p| p.disable());
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn address(&self, global: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        Ok(self.local_addr.get().to_js_socket_address(global))
    }
    pub(crate) fn mark_busy(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let busy = frame.arguments_as_array::<1>()[0].to_boolean();
        // SAFETY: state buffer is live.
        self.with_state(|s| s.busy = busy as u8);
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn do_ref(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let want = frame.arguments_as_array::<1>()[0].to_boolean();
        let ctx = bun_io::js_vm_ctx();
        self.poll_ref
            .with_mut(|p| if want { p.ref_(ctx) } else { p.unref(ctx) });
        Ok(JSValue::UNDEFINED)
    }
    /// Build `(hostname, TlsContext)` pairs from a `{ host: tlsOptions }`
    /// object. The JS layer already merged shared + per-identity options into
    /// each value, so each one is a complete server TLS config.
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
            let host = bun_core::String::from_js(key, global)?.to_utf8_bytes();
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
            match TlsContext::new(&config) {
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

    /// `endpoint.setSNIContexts(entries, replace)` — install or merge
    /// per-hostname identities. `lookup_cert` consults them on each handshake.
    pub(crate) fn set_sni_contexts(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.closed.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        let [entries, replace] = frame.arguments_as_array::<2>();
        if !entries.is_object() {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"entries\" argument must be of type object"),
                )
                .throw());
        }
        let mut alpn = self.server_alpn_wire.get().clone();
        if alpn.is_empty() {
            alpn = b"\x02h3".to_vec();
        }
        // Build every context before mutating: a bad entry must not leave a
        // half-applied map behind.
        let built = Self::build_sni_contexts(global, entries, &alpn)?;
        self.sni_contexts.with_mut(|map| {
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
        });
        Ok(JSValue::UNDEFINED)
    }

    #[expect(
        clippy::boxed_local,
        reason = "codegen's host_fn_finalize calls this as `|b| QuicEndpoint::finalize(b)` and requires `self: Box<Self>`"
    )]
    pub(crate) fn finalize(self: Box<Self>) {
        // The GC can collect the wrapper while the endpoint's timer is
        // still registered (e.g. the deferred onEndpointClose arm from
        // finish_close); remove it before the backing storage drops, or a
        // later heap operation dereferences the freed node. ACTIVE is the
        // canonical "in the heap" state (fired/paused timers were already
        // popped — see `All::update`); removing those is an error, not a
        // no-op.
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
    }
}
