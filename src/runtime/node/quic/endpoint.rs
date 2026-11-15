//! `QuicEndpoint` native handle (lsquic-backed) — Node's
//! `internalBinding('quic').Endpoint` analog (node/src/quic/endpoint.{h,cc}).

use core::cell::Cell;
use core::ffi::{CStr, c_int, c_uint, c_void};
use core::net::SocketAddr;

use bun_io::KeepAlive;
use bun_jsc::bindgen::{BorrowedWrapper, JsLocal, JsScope, JsStructure, JsWrapper, StrongWrapper};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult, StringJsc};
use bun_lsquic_sys as lsquic;
use bun_ptr::{CellExt as _, RefPtr, VecCellExt as _};
use bun_uws as uws;

use crate::jsc_hooks::{runtime_state, timer_all};
use crate::node::net::block_list::BlockList;
use crate::timer::{EventLoopTimerState, EventLoopTimerTag, OwnedTimer};

use super::aliased_struct::{AliasedStruct, put_state_and_stats};
use super::callbacks;
use super::engine::{self, Engine, EngineCell, OutSpec, StrongCtx};
use super::now_ns;
use super::roots::{Key, StrongWrapperCell, StrongWrapperMap};
use super::session::{self, QuicSession, SessionOptions, StoredAddr};
use super::tls::{TlsConfig, TlsContext};

bun_core::declare_scope!(quic, hidden);

/// Mirrors Node's `Endpoint::State`.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct EndpointState {
    pub bound: u8,
    pub(crate) receiving: u8,
    pub(crate) listening: u8,
    pub(crate) closing: u8,
    pub(crate) busy: u8,
    _pad0: u8,
    pub(crate) max_connections_per_host: u16,
    pub(crate) max_connections_total: u16,
    _pad1: [u8; 6],
    pub(crate) pending_callbacks: u64,
}
bun_core::impl_pod!(EndpointState);

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
const INITIAL_TYPE_V1: u8 = 0b00; // RFC 9000 §17.2
const INITIAL_TYPE_V2: u8 = 0b01; // RFC 9369 §3.2
/// Longest connection ID QUIC v1/v2 allow (RFC 9000 §17.2).
const MAX_CID_LEN: usize = 20;
/// Long-header form bit (byte0 bit 7; RFC 8999 §5.1).
const LONG_HEADER_FORM_BIT: u8 = 0x80;
const LONG_HEADER_TYPE_MASK: u8 = 0x3;
/// Byte offset of the DCID length in a long-header packet: form/type byte +
/// 4-byte version (RFC 8999 §5.1).
const LONG_HEADER_DCID_LEN_OFFSET: usize = 5;
/// Shortest parseable long header: form byte + version + dcid_len + ≥1 CID
/// byte (RFC 8999 §5.1).
const LONG_HEADER_MIN_LEN: usize = 7;
/// Matches Node's 1200-byte default.
const DEFAULT_DATAGRAM_FRAME_SIZE: u64 = 1200;
const IPV4_ADDR_LEN: usize = 4;
const IPV6_ADDR_LEN: usize = 16;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS handshake_failure(40).
const CRYPTO_ERROR_HANDSHAKE_FAILURE: u64 = 0x0100 + 40;
const PROVISIONAL_TIMEOUT_NS: u64 = 10_000_000_000;

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

/// What a pass does with the close events of sessions.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Closes {
    Deliver,
    Defer,
}

struct EngineSettings {
    settings: lsquic::Settings,
    local_tp: lsquic::NqTransportParams,
    alpn_cstr: Vec<u8>,
}

struct ProvisionalSession {
    dcid: Vec<u8>,
    peer: StoredAddr,
    created_ns: u64,
    session: Key,
}

struct BindConfig {
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

pub(crate) struct QuicEndpoint {
    state: AliasedStruct<EndpointState>,
    stats: AliasedStruct<[u64; ENDPOINT_STATS_FIELDS.len()]>,
    closing: Cell<bool>,
    closed: Cell<bool>,

    /// `on_close` clears it.
    socket: Cell<Option<*mut uws::udp::Socket>>,
    bind_config: BindConfig,
    local_addr: Cell<StoredAddr>,
    poll_ref: KeepAlive,
    /// Set before the socket is created, taken by `deliver_endpoint_close`.
    this_value: StrongWrapperCell<QuicEndpoint>,
    /// Key in `endpoint_registry()`.
    registry_key: Cell<Option<Key>>,

    /// Both can coexist on one endpoint — Node allows that.
    server_engine: EngineCell,
    client_engine: EngineCell,
    sni_contexts: Cell<Vec<(Vec<u8>, TlsContext)>>,
    server_alpn_wire: Cell<Vec<u8>>,
    send_scratch: Cell<Vec<u8>>,
    /// NUL-terminated.
    client_alpn: Cell<Vec<u8>>,
    server_alpn: Cell<Vec<u8>>,
    server_is_http: Cell<bool>,
    client_is_http: Cell<bool>,
    pub(super) server_verify_client: Cell<bool>,
    server_session_options: Cell<SessionOptions>,
    disable_stateless_reset: bool,
    stateless_reset_burst: u32,
    stateless_reset_rate: f64,

    processing: Cell<bool>,
    followup_due: Cell<bool>,
    sessions: StrongWrapperMap<QuicSession, StrongCtx<QuicSession>>,
    server_local_tp: Cell<lsquic::NqTransportParams>,
    client_local_tp: Cell<lsquic::NqTransportParams>,
    pending_new_sessions: Cell<Vec<Key>>,
    /// Server sessions announced at Initial receipt (Node's event order).
    provisional: Cell<Vec<ProvisionalSession>>,
    pending_verneg: Cell<Vec<(Key, [u8; VERNEG_PROBE_CID_LEN], u64)>>,
    dead_provisional_peers: Cell<Vec<(StoredAddr, u64)>>,
    block_list: Option<RefPtr<BlockList>>,
    /// `(address of the SSL, peer, line)`.
    early_keylog: Cell<Vec<(usize, StoredAddr, Vec<u8>)>>,
    block_list_allow: bool,
    pub(crate) event_loop_timer: OwnedTimer,
    pending_endpoint_close: Cell<bool>,
    /// The `CLOSECONTEXT_*` that the pending close reports.
    close_context: Cell<u8>,
    /// Intrusive node on the loop's node:quic driver list; linked only while
    /// this endpoint is bound. `us_nq_loop_flush_if_pending` runs the
    /// process pass once per loop turn when `pending` is set.
    nq_driver: UsNqDriver,
    nq_registered: Cell<bool>,
    /// Native-entry depth, node's Session::SendPendingDataScope. Non-zero means
    /// a native callback (on_data, the timer) is on the stack and owns the
    /// flush when it unwinds -- JS it dispatches (onSessionNew and friends) must
    /// not re-enter lsquic mid-callback, which is why `processing` alone is not
    /// enough: on_data runs another endpoint's `process` before it feeds packets.
    send_scope_depth: Cell<u32>,
}

/// Mirrors `struct us_nq_driver_s` in node_quic_shim.c. Owned by the endpoint
/// it belongs to; the C side only ever links it into the loop's list.
#[derive(Default)]
#[repr(C)]
pub(crate) struct UsNqDriver {
    next: Cell<*const UsNqDriver>,
    owner: Cell<*const c_void>,
    pending: Cell<c_int>,
}

unsafe extern "C" {
    fn us_nq_loop_register(loop_: &uws::Loop, d: &UsNqDriver, owner: *const c_void);
    fn us_nq_loop_unregister(loop_: &uws::Loop, d: &UsNqDriver);
}

impl QuicEndpoint {
    /// Links this endpoint into the loop's driver list. Idempotent.
    fn link_loop_driver(this: BorrowedWrapper<'_, Self>) {
        if this.nq_registered.replace(true) {
            return;
        }
        let owner = core::ptr::from_ref(this.payload()).cast();
        // SAFETY: a payload does not move, and `Drop` unlinks the node.
        unsafe { us_nq_loop_register(uws::Loop::get(), &this.nq_driver, owner) };
    }

    /// Unlinks from the loop's driver list. Idempotent; must run before the
    /// endpoint can be freed so the walk never reaches dead memory.
    fn unlink_loop_driver(&self) {
        if !self.nq_registered.replace(false) {
            return;
        }
        // SAFETY: registered by `link_loop_driver` on this same loop.
        unsafe { us_nq_loop_unregister(uws::Loop::get(), &self.nq_driver) };
    }

    /// Marks that lsquic has work queued, so the next driver pass runs.
    fn mark_driver_pending(&self) {
        self.nq_driver.pending.set(1);
    }

    /// Runs a driver pass, or hands `pending` back when one cannot run now.
    /// `closes` distinguishes the microtask-drain pass, which must not
    /// let a session end mid-chain, from the loop_pre/loop_post pass.
    fn run_driver_pass(&self, closes: Closes) {
        if self.closed.get() {
            return;
        }
        // A pass is already on the stack (the walker cleared `pending` before
        // calling): give the flag back so that pass's tail flush sees it,
        // otherwise the write that set it waits out the backstop timer.
        if self.send_scope_depth.get() != 0 {
            self.mark_driver_pending();
            return;
        }
        self.this_value.with(|this| Self::process(this, closes));
    }

    fn engine(&self, is_server: bool) -> &EngineCell {
        if is_server {
            &self.server_engine
        } else {
            &self.client_engine
        }
    }

    fn for_each_engine(&self, mut f: impl FnMut(&mut Engine)) {
        self.server_engine.with_taken(&mut f);
        self.client_engine.with_taken(f);
    }

    /// `None` if neither engine has `cid`.
    fn cid_owner_is_server(&self, cid: &[u8]) -> Option<bool> {
        [true, false].into_iter().find(|&is_server| {
            self.engine(is_server).with_taken(|e| e.cid_in_use(cid)) == Some(true)
        })
    }
}

/// The microtask-drain pass: full processing, but session close events hold
/// until the next loop point so a running microtask chain never observes a
/// session ending mid-chain (node's loop never interleaves that way).
///
/// `owner` is the pointer `link_loop_driver` installed.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__nodeQuic__drainEndpoint(owner: &QuicEndpoint) {
    owner.run_driver_pass(Closes::Defer);
}

/// One process pass per loop turn (loop_pre/loop_post): the writes a JS turn
/// queued leave as one engine pass and one sendmmsg batch.
///
/// `owner` is the pointer `link_loop_driver` installed.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__nodeQuic__processEndpoint(owner: &QuicEndpoint) {
    owner.run_driver_pass(Closes::Deliver);
}

bun_event_loop::impl_timer_owner!(QuicEndpoint; from_timer_ptr => event_loop_timer);

/// # Safety
/// `socket` was created by `QuicEndpoint::bind`, and uSockets is running one of its callbacks.
unsafe fn with_socket_user(
    socket: *mut uws::udp::Socket,
    f: impl FnOnce(BorrowedWrapper<'_, QuicEndpoint>),
) {
    let user = uws::udp::Socket::opaque_mut(socket).user();
    // SAFETY: `this_value` roots it until the socket is closed. Only a closed VM drops it before that.
    unsafe { StrongWrapper::try_with_payload_ptr(user.cast(), f) };
}

extern "C" fn on_data(
    socket: *mut uws::udp::Socket,
    buf: *mut uws::udp::PacketBuffer,
    packets: c_int,
) {
    let feed = |this: BorrowedWrapper<'_, QuicEndpoint>| {
        let local = this.local_addr.get();
        // Apply a stashed close before feeding: a closing peer discards new
        // streams rather than announcing them (RFC 9000 s10.2.1), and ci_close
        // only schedules, so the engines have to run for it to take effect.
        let mut closed_any = false;
        this.sessions
            .for_each(|session| closed_any |= session.flush_pending_graceful());
        if closed_any {
            this.drive_engines_once();
        }
        // Another endpoint's `process` runs JS between two packets, and that JS must not flush lsquic.
        let _send_scope = this.send_scope();
        bun_boringssl_sys::ERR_clear_error();
        for i in 0..packets {
            let payload = uws::udp::PacketBuffer::opaque_mut(buf).get_payload(i);
            let peer = uws::udp::PacketBuffer::opaque_mut(buf).get_peer(i);
            // SAFETY: a `sockaddr_storage` has the size and the alignment for any address.
            let peer = unsafe { &*core::ptr::from_ref(peer).cast::<StoredAddr>() };
            if !payload.is_empty() {
                QuicEndpoint::on_packet(this, payload, &local, peer);
            }
        }
        // Keep the scope through the tail pass: a graceful close a handler queued
        // during this dispatch must not join the same flight as the data the
        // handlers wrote (sessions stash it; the next depth-0 pass applies it).
        QuicEndpoint::process(this, Closes::Deliver);
    };
    // SAFETY: only `bind` refers to this function.
    unsafe { with_socket_user(socket, feed) }
}
extern "C" fn on_drain(socket: *mut uws::udp::Socket) {
    // SAFETY: as above.
    unsafe { with_socket_user(socket, |this| this.on_drain()) }
}
extern "C" fn on_close(socket: *mut uws::udp::Socket) {
    // SAFETY: as above.
    unsafe { with_socket_user(socket, |this| this.on_close()) }
}
extern "C" fn on_recv_error(_socket: *mut uws::udp::Socket, _errno: c_int, _is_errqueue: c_int) {}

/// A server may advertise another local endpoint's address as its
/// preferred_address (RFC 9000 sec 9.6).
#[derive(Default)]
pub(crate) struct EndpointRegistry(StrongWrapperMap<QuicEndpoint>);

fn endpoint_registry() -> &'static StrongWrapperMap<QuicEndpoint> {
    &runtime_state().quic_endpoints.0
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
const VERSION_FIELD_LEN: usize = 4;
const VERNEG_PROBE_CID_LEN: usize = 8;
/// RFC 9000 sec 14.1: servers may drop Initial-like datagrams smaller than
/// 1200 bytes, so the probe pads to the minimum.
const VERNEG_PROBE_LEN: usize = 1200;
const SHORT_HEADER_DCID_LEN: usize = 8;

impl QuicEndpoint {
    fn on_drain(&self) {
        if self.closed.get() {
            return;
        }
        self.for_each_engine(|engine| engine.send_unsent_packets(self));
        self.schedule_process();
    }

    /// uSockets closes a socket by itself on a poll error. `process` reports the sessions, then closes the endpoint.
    fn on_close(&self) {
        if self.closed.get() {
            return;
        }
        self.socket.set(None);
        self.close_context.set(CLOSECONTEXT_RECEIVE_FAILURE);
        self.mark_closing();
        self.server_engine.clear();
        self.client_engine.clear();
        self.schedule_process();
    }

    fn on_packet(
        this: BorrowedWrapper<'_, Self>,
        payload: &[u8],
        local: &StoredAddr,
        peer: &StoredAddr,
    ) {
        this.add_stat(IDX_STATS_PACKETS_RECEIVED, 1);
        this.add_stat(IDX_STATS_BYTES_RECEIVED, payload.len() as u64);
        if this.peer_blocked(peer) {
            return;
        }
        if payload[0] & HEADER_FORM_LONG == 0 && payload.len() > 1 + SHORT_HEADER_DCID_LEN {
            let dcid = &payload[1..1 + SHORT_HEADER_DCID_LEN];
            // The other engine would answer a packet it cannot match with a stateless reset.
            if let Some(is_server) = this.cid_owner_is_server(dcid) {
                this.engine(is_server)
                    .with_taken(|engine| engine.packet_in(&this, payload, local, peer));
                return;
            }
            let is_this = |other: &Self| core::ptr::eq(other, this.payload());
            let registry = endpoint_registry();
            let owner = registry.find_map(|key, other| {
                if is_this(other) {
                    return None;
                }
                Some((key, other.cid_owner_is_server(dcid)?))
            });
            let forwarded = owner.and_then(|(owner, is_server)| {
                registry.with(owner, |other| {
                    if other.peer_blocked(peer) {
                        return;
                    }
                    // The packet is fed with OUR local address (the migration target).
                    other
                        .engine(is_server)
                        .with_taken(|engine| engine.packet_in(&other, payload, local, peer));
                    Self::process(other, Closes::Deliver);
                })
            });
            if forwarded.is_some() {
                return;
            }
            // May be a stateless reset (RFC 9000 sec 10.3).
            if payload.len() >= STATELESS_RESET_MIN_LEN {
                registry.for_each(|other| {
                    if is_this(&other) || other.peer_blocked(peer) {
                        return;
                    }
                    other.for_each_engine(|e| e.packet_in(&other, payload, local, peer));
                    Self::process(other, Closes::Deliver);
                });
            }
        }
        // Version Negotiation packet (long header, version 0 — RFC 8999 sec 6).
        if payload.len() > LONG_HEADER_MIN_LEN
            && payload[0] & HEADER_FORM_LONG != 0
            && payload[1..5] == VERSION_NEGOTIATION_VERSION
            && this.handle_version_negotiation(payload)
        {
            return;
        }
        // Node announces server sessions at Initial receipt — before the
        // handshake — so `onsession` precedes the client's `opened`.
        if let Err(err) = Self::maybe_announce_provisional(this, payload, peer) {
            crate::dispatch::fold(Err(err));
        }
        this.for_each_engine(|engine| engine.packet_in(&this, payload, local, peer));
    }

    pub(super) fn on_mini_conn_failed(&self, peer: &StoredAddr, error_code: u64) {
        /// CRYPTO_ERROR base (RFC 9001 §4.8) + TLS no_application_protocol(120).
        const CRYPTO_ERROR_NO_APPLICATION_PROTOCOL: u64 = 0x0100 + 120;
        /// Bit 63 marks "the peer sent its own CONNECTION_CLOSE" (QUIC codes
        /// fit in 62 bits); the low bits carry the peer's code. See the
        /// connection-close-pns lsquic patch.
        const PEER_CLOSE_BIT: u64 = 1 << 63;
        self.discard_early_keylog(peer);
        let Some(failed) = self.take_provisional(peer) else {
            return;
        };
        let reason: &[u8] = if error_code & PEER_CLOSE_BIT != 0 {
            // Not a failure: the client closed during the handshake
            // (connect() then immediate close()). Report the peer's
            // own code so `closed` settles the way node's does.
            b""
        } else if error_code == 0 {
            // The peer went away without a frame (destroyed client,
            // dropped packets): node's server surfaces the idle death
            // of a handshaking session as a clean close, not an error.
            b""
        } else if error_code == CRYPTO_ERROR_NO_APPLICATION_PROTOCOL {
            b"no application protocol"
        } else {
            b"handshake failed"
        };
        self.sessions.with(failed, |session| {
            session.push_event(session::SessionEvent::PeerClose {
                app_error: false,
                code: error_code & !PEER_CLOSE_BIT,
                reason: reason.to_vec(),
            });
            session.push_event(session::SessionEvent::Closed);
            session.schedule_process();
        });
    }

    /// Returns how many were sent. `errno` says why the next one was not.
    pub(super) fn packets_out(&self, specs: &[OutSpec<'_>]) -> usize {
        let Some(socket) = self.socket.get() else {
            return 0;
        };
        let my_addr = self.local_addr.get().decode();
        self.send_scratch.with_taken(|scratch| {
            for (sent, spec) in specs.iter().enumerate() {
                let payload = match spec.iov() {
                    [one] => one.as_slice(),
                    many => {
                        scratch.clear();
                        for v in many {
                            scratch.extend_from_slice(v.as_slice());
                        }
                        scratch.as_slice()
                    }
                };
                if payload.is_empty() {
                    continue;
                }
                let spec_local = spec.local_sa.decode();
                let out_socket = if spec_local != my_addr {
                    self.find_socket_by_addr(spec_local).unwrap_or(socket)
                } else {
                    socket
                };
                let rv = uws::udp::Socket::opaque_mut(out_socket).send(
                    &[payload.as_ptr()],
                    &[payload.len()],
                    &[spec.dest_sa.as_ptr()],
                );
                if rv < 1 {
                    return sent;
                }
                self.add_stat(IDX_STATS_PACKETS_SENT, 1);
                self.add_stat(IDX_STATS_BYTES_SENT, payload.len() as u64);
            }
            specs.len()
        })
    }

    pub(super) fn lookup_cert(&self, host: &[u8]) -> Option<*mut bun_boringssl_sys::SSL_CTX> {
        self.sni_contexts
            .with_taken(|entries| match_sni(entries, host).map(TlsContext::raw))
    }

    fn find_socket_by_addr(&self, addr: Option<SocketAddr>) -> Option<*mut uws::udp::Socket> {
        endpoint_registry().find_map(|_, other| {
            (!core::ptr::eq(other, self) && other.local_addr.get().decode() == addr)
                .then(|| other.socket.get())
        })?
    }
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

/// Node's documented default ALPN is `'h3'`.
fn alpn_cstr_is_http(alpn_cstr: &[u8]) -> bool {
    match alpn_cstr.strip_suffix(b"\0") {
        None | Some(b"") => true,
        Some(a) => a == b"h3" || a.starts_with(b"h3-"),
    }
}

/// Whether every protocol in a wire-format ALPN list agrees on HTTP/3-ness.
/// The engine's framing is fixed from the first entry, but `alpn_select_cb`
/// offers the whole list, so a mixed one can negotiate the framing we did not
/// build for.
fn alpn_list_is_uniform(alpn: &[u8]) -> bool {
    let mut i = 0usize;
    let mut want: Option<bool> = None;
    while i < alpn.len() {
        let n = alpn[i] as usize;
        i += 1;
        if n == 0 || i + n > alpn.len() {
            break;
        }
        let p = &alpn[i..i + n];
        let is_http = p == b"h3" || p.starts_with(b"h3-");
        if *want.get_or_insert(is_http) != is_http {
            return false;
        }
        i += n;
    }
    true
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

fn snapshot_datagram_frame_size(s: &lsquic::Settings) -> u64 {
    if s.get_datagrams() == 0 {
        return 0;
    }
    match s.get_max_datagram_frame_size() {
        0 => DEFAULT_DATAGRAM_FRAME_SIZE,
        v => v,
    }
}

/// lsquic settings are engine-wide; matches Node's per-endpoint listen options.
fn apply_transport_params(
    global: &JSGlobalObject,
    s: &mut lsquic::Settings,
    options: JSValue,
    local_tp: &mut lsquic::NqTransportParams,
) -> JsResult<()> {
    // Node's default max_idle_timeout is 10 seconds
    // (node/src/quic/transportparams.h DEFAULT_MAX_IDLE_TIMEOUT); lsquic's is 30.
    s.idle_timeout(10);
    if !options.is_object() {
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
        for (key, is_v4) in [
            ("preferredAddressIpv4", true),
            ("preferredAddressIpv6", false),
        ] {
            let addr = tp.get(global, key)?.and_then(StoredAddr::from_js);
            match addr.and_then(|addr| addr.decode()) {
                Some(SocketAddr::V4(addr)) if is_v4 => {
                    pref[0..4].copy_from_slice(&addr.ip().octets());
                    pref[4..6].copy_from_slice(&addr.port().to_ne_bytes());
                    have_pref = true;
                }
                Some(SocketAddr::V6(addr)) if !is_v4 => {
                    pref[6..22].copy_from_slice(&addr.ip().octets());
                    pref[22..24].copy_from_slice(&addr.port().to_ne_bytes());
                    have_pref = true;
                }
                _ => {}
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
        let name = bun_core::String::from_js(cc, global)?.to_owned_slice();
        // lsquic.h es_cc_algo: 0=default(→3 Adaptive), 1=Cubic, 2=BBRv1,
        // 3=Adaptive. lsquic ships no Reno (NGTCP2_CC_ALGO_RENO in node's
        // backend), so map 'reno' to Cubic, the closest loss-based option,
        // rather than silently falling through to Adaptive which may pick BBR.
        let algo = match name.as_slice() {
            b"cubic" | b"reno" => 1,
            b"bbr" => 2,
            _ => 0,
        };
        s.cc_algo(algo);
    }
    Ok(())
}

impl QuicEndpoint {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        options: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let mut bind_config = BindConfig::default();
        let mut block_list = None;
        let mut block_list_allow = false;
        let mut disable_stateless_reset = false;
        let mut stateless_reset_burst = 0;
        let mut stateless_reset_rate = 0.0;
        let options = options.to_js();
        if options.is_object() {
            let global = cx.global();
            let address = options.get(global, "address")?;
            if let Some(addr) = address.and_then(|v| StoredAddr::from_js(v)?.decode()) {
                bind_config = BindConfig {
                    host: format!("{}\0", addr.ip()).into_bytes(),
                    port: addr.port(),
                };
            }
            if let Some(bl_js) = options.get(global, "blockList")?.filter(|v| v.is_object()) {
                block_list = crate::generated_bindgen::block_list::js_BlockList::from_js(bl_js)
                    // SAFETY: `bl_js` holds a ref.
                    .map(|bl| unsafe { RefPtr::init_ref(bl.as_ptr()) });
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
                stateless_reset_burst = v.as_number().max(0.0).min(u32::MAX as f64) as u32;
            }
            if let Some(v) = options
                .get(global, "statelessResetRate")?
                .filter(|v| v.is_number())
            {
                stateless_reset_rate = v.as_number().max(0.0);
            }
        }

        let this = QuicEndpoint {
            state: AliasedStruct::zeroed(),
            stats: AliasedStruct::zeroed(),
            closing: Cell::new(false),
            closed: Cell::new(false),
            socket: Cell::new(None),
            bind_config,
            local_addr: Cell::new(StoredAddr::default()),
            poll_ref: KeepAlive::init(),
            this_value: StrongWrapperCell::new(None),
            registry_key: Cell::new(None),
            server_engine: EngineCell::default(),
            client_engine: EngineCell::default(),
            sni_contexts: Cell::new(Vec::new()),
            server_alpn_wire: Cell::new(Vec::new()),
            send_scratch: Cell::new(Vec::new()),
            client_alpn: Cell::new(Vec::new()),
            server_alpn: Cell::new(Vec::new()),
            server_is_http: Cell::new(false),
            server_verify_client: Cell::new(false),
            server_session_options: Cell::new(SessionOptions::default()),
            disable_stateless_reset,
            stateless_reset_burst,
            stateless_reset_rate,
            client_is_http: Cell::new(false),
            processing: Cell::new(false),
            followup_due: Cell::new(false),
            sessions: StrongWrapperMap::default(),
            server_local_tp: Cell::new(lsquic::NqTransportParams::default()),
            client_local_tp: Cell::new(lsquic::NqTransportParams::default()),
            pending_new_sessions: Cell::new(Vec::new()),
            provisional: Cell::new(Vec::new()),
            pending_verneg: Cell::new(Vec::new()),
            dead_provisional_peers: Cell::new(Vec::new()),
            block_list,
            early_keylog: Cell::new(Vec::new()),
            block_list_allow,
            event_loop_timer: OwnedTimer::init_paused(EventLoopTimerTag::QuicEndpoint),
            pending_endpoint_close: Cell::new(false),
            close_context: Cell::new(CLOSECONTEXT_CLOSE),
            nq_driver: UsNqDriver::default(),
            nq_registered: Cell::new(false),
            send_scope_depth: Cell::new(0),
        };
        this.write_stat(IDX_STATS_CREATED_AT, now_ns());
        let state = this.state.to_array_buffer(cx.global())?;
        let stats = this.stats.to_array_buffer(cx.global())?;
        let this_value = structure.create(&cx.heap, this);
        put_state_and_stats(cx.global(), this_value.to_js(), state, stats, 0);
        Ok(this_value)
    }

    fn with_state<R>(&self, f: impl FnOnce(&mut EndpointState) -> R) -> R {
        self.state.with_mut(f)
    }
    fn write_stat(&self, idx: usize, value: u64) {
        self.stats.with_mut(|stats| stats[idx] = value);
    }
    fn add_stat(&self, idx: usize, value: u64) {
        self.stats
            .with_mut(|stats| stats[idx] = stats[idx].wrapping_add(value));
    }

    fn peer_blocked(&self, peer: &StoredAddr) -> bool {
        let Some(bl) = &self.block_list else {
            return false;
        };
        let blocked = bl.check_sockaddr(&peer.0) != self.block_list_allow;
        if blocked {
            self.add_stat(IDX_STATS_PACKETS_BLOCKED, 1);
        }
        blocked
    }

    fn throw_if_closed(&self, global: &JSGlobalObject) -> JsResult<()> {
        if self.closed.get() || self.closing.get() {
            return Err(global
                .err(
                    jsc::ErrorCode::QUIC_ENDPOINT_CLOSED,
                    format_args!("Endpoint is closed"),
                )
                .throw());
        }
        Ok(())
    }

    /// Returns false when the bind fails: Node does not throw here.
    fn ensure_bound(&self, global: &JSGlobalObject, this_value: JsWrapper<'_, Self>) -> bool {
        if self.socket.get().is_none() {
            self.this_value.set(StrongWrapper::new(this_value, global));
            self.this_value.with(Self::bind);
        }
        self.socket.get().is_some()
    }

    fn bind(this: BorrowedWrapper<'_, Self>) {
        let mut err: c_int = 0;
        let socket = uws::udp::Socket::create(
            uws::Loop::get(),
            on_data,
            on_drain,
            on_close,
            on_recv_error,
            bun_core::ZStr::from_slice_with_nul(&this.bind_config.host),
            this.bind_config.port,
            0,
            Some(&mut err),
            core::ptr::from_ref(this.payload()).cast_mut().cast(),
        );
        if socket.is_null() {
            this.teardown();
            this.deliver_endpoint_close(CLOSECONTEXT_BIND_FAILURE, err);
            return;
        }
        // Linked only while bound, so an idle endpoint costs the loop nothing.
        Self::link_loop_driver(this);
        this.socket.set(Some(socket));
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
        this.local_addr.set(StoredAddr(addr._addr));
        this.with_state(|s| {
            s.bound = 1;
            s.receiving = 1;
        });
        this.update_keepalive();
        let registry = endpoint_registry();
        let key = registry.next_key();
        registry.insert(key, this.to_strong());
        this.registry_key.set(Some(key));
    }

    fn update_keepalive(&self) {
        if self.closed.get() {
            return;
        }
        let busy = self.with_state(|s| s.listening) != 0 || !self.sessions.is_empty();
        let ctx = bun_io::js_vm_ctx();
        if busy {
            self.poll_ref.ref_(ctx);
        } else {
            self.poll_ref.unref(ctx);
        }
    }

    /// `Closes::Defer`: the pass runs from the microtask drain, so Closed events wait for the next loop point.
    fn process(this: BorrowedWrapper<'_, Self>, closes: Closes) {
        if this.closed.get() {
            return;
        }
        if this.processing.replace(true) {
            return;
        }
        let global = this.global();
        // A depth-0 pass runs after the previous flight left the socket: safe
        // point for graceful closes stashed during a dispatch.
        if this.send_scope_depth.get() == 0 {
            this.sessions.for_each(|session| {
                session.flush_pending_graceful();
            });
        }
        let send_scope = this.send_scope();
        this.followup_due.set(false);
        // Not from the mid-turn drain pass: a deferred abort is dropped when
        // a later stream writes first, and node decides that over the whole
        // turn -- flushing mid-chain puts a RESET on the wire node never sends.
        if closes == Closes::Deliver {
            this.sessions
                .for_each(|session| session.flush_deferred_aborts());
        }
        bun_boringssl_sys::ERR_clear_error();
        this.for_each_engine(|engine| engine.process_conns(&this));
        this.processing.set(false);
        if let Some((sent, limited)) = this
            .server_engine
            .with_taken(|engine| engine.sreset_stats())
        {
            this.write_stat(IDX_STATS_STATELESS_RESET_COUNT, sent);
            this.write_stat(IDX_STATS_STATELESS_RESET_RATE_LIMITED, limited);
        }

        loop {
            // Arrival order: both push sites append, and a burst of Initials in
            // one recvmmsg batch must announce in the order the sessions loop
            // below then walks them.
            let Some(session) = this.pending_new_sessions.with_taken(|v| {
                if v.is_empty() {
                    None
                } else {
                    Some(v.remove(0))
                }
            }) else {
                break;
            };
            this.sessions.with(session, |session| {
                if let Some(callback) = callbacks::get(global, "onSessionNew") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        callback,
                        global,
                        this.to_js(),
                        &[session.to_js()],
                    );
                }
            });
        }
        this.sessions.for_each(|session| {
            session.process_events(session.to_js(), global, closes);
            session.maybe_finish_deferred_close();
        });
        this.sweep_provisional();
        this.rearm_timer();
        this.update_keepalive();
        if this.closing.get()
            && this.sessions.is_empty()
            && this.engine_conn_count() == 0
            && !this.closed.get()
        {
            this.finish_close();
        }
        drop(send_scope);
        // Writes made by the dispatch above could not flush inline (the scope
        // was held). Send them at the pass's outer edge, where node's
        // SendPendingDataScope flushes, not a loop turn later.
        if this.nq_driver.pending.replace(0) != 0 {
            this.drive_engines_once();
        }
    }

    fn engine_conn_count(&self) -> u32 {
        let mut n = 0u32;
        self.for_each_engine(|engine| n += engine.conn_count());
        n
    }

    /// Whether a native dispatch (on_data, process) is on the stack.
    pub(super) fn scope_held(&self) -> bool {
        self.send_scope_depth.get() != 0
    }

    pub(super) fn schedule_process(&self) {
        if self.closed.get() {
            return;
        }
        self.followup_due.set(true);
        // Flush at the outermost native exit (node's SendPendingDataScope):
        // a response must leave before a later handler's close, or lsquic's
        // control-stream priority coalesces GOAWAY ahead of the data.
        if self.send_scope_depth.get() == 0 {
            self.drive_engines_once();
        }
        // The loop driver dispatches what the flush queued at the next loop
        // point; the timer below is only the backstop for lsquic's
        // time-driven state (RTO, ACK delay, idle) and the deferred close.
        self.mark_driver_pending();
        let next = bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, 1);
        timer_all().update(OwnedTimer::node(&raw const self.event_loop_timer), &next);
    }

    fn rearm_timer(&self) {
        if self.closed.get() {
            return;
        }
        let mut earliest_us: Option<i32> = None;
        self.for_each_engine(|engine| {
            if let Some(diff) = engine.earliest_adv_tick() {
                earliest_us = Some(earliest_us.map_or(diff, |e| e.min(diff)));
            }
        });
        let mut ms = earliest_us.map(|us| (us.max(0) as u64).div_ceil(1000).max(1));
        // Both of these are settled only by `sweep_provisional`, and neither
        // keeps an engine ticking on its own -- a probe has no engine at all,
        // and an idle engine stops advising a tick -- so without a poll the
        // sweep never runs and an announced session never settles.
        const SWEEP_POLL_MS: u64 = 250;
        if !self.pending_verneg.is_empty() || !self.provisional.is_empty() {
            ms = Some(ms.map_or(SWEEP_POLL_MS, |m| m.min(SWEEP_POLL_MS)));
        }
        if self.followup_due.get() {
            ms = Some(ms.map_or(1, |m| m.min(1)));
        }
        if let Some(ms) = ms {
            let next = bun_core::Timespec::ms_from_now(
                bun_core::TimespecMockMode::ForceRealTime,
                ms as i64,
            );
            timer_all().update(OwnedTimer::node(&raw const self.event_loop_timer), &next);
        }
    }

    pub(crate) fn on_timer_fire(&self) {
        self.event_loop_timer.state.set(EventLoopTimerState::FIRED);
        if self.pending_endpoint_close.replace(false) {
            self.deliver_endpoint_close(self.close_context.get(), 0);
            return;
        }
        self.this_value
            .with(|this| Self::process(this, Closes::Deliver));
    }

    /// Node announces server sessions at Initial receipt.
    fn maybe_announce_provisional(
        this: BorrowedWrapper<'_, Self>,
        payload: &[u8],
        peer: &StoredAddr,
    ) -> JsResult<()> {
        if !this.server_engine.is_some()
            || this.with_state(|s| s.listening) == 0
            || this.closing.get()
        {
            return Ok(());
        }
        // Long header: 0b1xxx_xxxx; version != 0 (0 = version negotiation);
        // DCID length-prefixed at byte 5 (RFC 8999 §5.1).
        if payload.len() < LONG_HEADER_MIN_LEN || payload[0] & LONG_HEADER_FORM_BIT == 0 {
            return Ok(());
        }
        let version = u32::from_be_bytes([payload[1], payload[2], payload[3], payload[4]]);
        // Type bits (byte0 5:4): v1 Initial = 0b00 (RFC 9000 §17.2), v2
        // Initial = 0b01 (RFC 9369 §3.2).
        let type_bits = (payload[0] >> 4) & LONG_HEADER_TYPE_MASK;
        let is_initial = match version {
            QUIC_VERSION_1 => type_bits == INITIAL_TYPE_V1,
            QUIC_VERSION_2 => type_bits == INITIAL_TYPE_V2,
            _ => false,
        };
        if !is_initial {
            return Ok(());
        }
        let dcid_len = payload[LONG_HEADER_DCID_LEN_OFFSET] as usize;
        let dcid_start = LONG_HEADER_DCID_LEN_OFFSET + 1;
        if dcid_len == 0 || dcid_len > MAX_CID_LEN || payload.len() < dcid_start + dcid_len {
            return Ok(());
        }
        let dcid = &payload[dcid_start..dcid_start + dcid_len];
        if this
            .provisional
            .with_taken(|v| v.iter().any(|p| p.dcid == dcid))
        {
            return Ok(());
        }
        // On a dual-mode endpoint the peer's Initial *response* carries our
        // client's SCID, which only the client engine hashes -- checking the
        // server engine alone would announce a phantom server session for it.
        if this.cid_owner_is_server(dcid).is_some() {
            return Ok(());
        }
        // `on_new_conn` refuses a session at capacity, so it could never open.
        if this.is_at_capacity() {
            return Ok(());
        }
        bun_core::scoped_log!(
            quic,
            "announce provisional dcid={:02x?} peer={:?}",
            dcid,
            peer.decode()
        );
        let (key, session) = Self::create_server_session(this)?;
        this.add_server_session(key, session);
        this.provisional.push(ProvisionalSession {
            dcid: dcid.to_vec(),
            peer: *peer,
            created_ns: now_ns(),
            session: key,
        });
        Ok(())
    }

    fn is_at_capacity(&self) -> bool {
        let (busy, max_conns) = self.with_state(|s| (s.busy, s.max_connections_total));
        busy != 0 || (max_conns > 0 && self.sessions.len() >= max_conns as usize)
    }

    fn create_server_session(
        this: BorrowedWrapper<'_, Self>,
    ) -> JsResult<(Key, StrongCtx<QuicSession>)> {
        let key = this.sessions.next_key();
        let global = this.global();
        let options = this
            .server_session_options
            .with_taken(|options| options.clone_with_global(global));
        let application = this.application(true);
        let session =
            QuicSession::create(global, this.to_strong(), key, true, application, options)?;
        Ok((key, session))
    }

    fn add_server_session(&self, key: Key, session: StrongCtx<QuicSession>) {
        self.sessions.insert(key, session);
        self.pending_new_sessions.push(key);
        self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
    }

    fn take_provisional(&self, peer: &StoredAddr) -> Option<Key> {
        let peer = peer.decode();
        self.provisional.with_taken(|v| {
            let idx = v.iter().position(|p| p.peer.decode() == peer)?;
            Some(v.remove(idx).session)
        })
    }

    /// Queues the handshake-failure close both timeout lists deliver.
    fn expire_session(&self, session: Key) -> bool {
        self.sessions
            .with(session, |session| {
                session.push_event(session::SessionEvent::PeerClose {
                    app_error: false,
                    code: CRYPTO_ERROR_HANDSHAKE_FAILURE,
                    reason: b"handshake failed".to_vec(),
                });
                session.push_event(session::SessionEvent::Closed);
            })
            .is_some()
    }

    fn sweep_provisional(&self) {
        let now = now_ns();
        let mut n_expired = 0usize;
        // Unbounded, like `pending_verneg` below: a fixed cap left the overflow
        // in `provisional`, where `on_new_conn` can still match it and promote
        // a session that was already past its deadline as a successful one.
        let mut expired: Vec<Key> = Vec::new();
        self.provisional.with_taken(|v| {
            v.retain(|p| {
                if now.saturating_sub(p.created_ns) < PROVISIONAL_TIMEOUT_NS {
                    return true;
                }
                expired.push(p.session);
                false
            });
        });
        // A probe has no lsquic conn, so no handshake or idle timeout covers
        // it, and RFC 9000 s6.1 makes the reply optional with no retransmit:
        // without this a dropped reply hangs `opened` and `close()` forever.
        self.pending_verneg.with_taken(|v| {
            v.retain(|(session, _, created_ns)| {
                if now.saturating_sub(*created_ns) < PROVISIONAL_TIMEOUT_NS {
                    return true;
                }
                expired.push(*session);
                false
            });
        });
        for session in expired {
            if self.expire_session(session) {
                n_expired += 1;
            }
        }
        if n_expired > 0 {
            // This runs after `process()` already drained the event queues, so
            // ask `rearm_timer` for the follow-up pass that delivers these.
            self.followup_due.set(true);
        }
        self.dead_provisional_peers
            .with_taken(|d| d.retain(|&(_, at)| now.saturating_sub(at) < PROVISIONAL_TIMEOUT_NS));
    }

    /// lsquic promotes a server conn after its handshake and never calls `on_hsk_done` for it.
    pub(super) fn on_new_conn(&self, handshaken: &lsquic::Conn) {
        let peer = engine::conn_sockaddrs(handshaken).map(|(_, peer)| peer);
        if let Some(key) = peer.and_then(|peer| self.take_provisional(&peer)) {
            self.sessions
                .with_taken(key, |session| session.bind(handshaken));
            let promoted = self.sessions.with(key, |session| {
                session.on_promoted(self.take_early_keylog(handshaken));
                session.note_handshake_ok();
            });
            if promoted.is_some() {
                return;
            }
        }
        // A close() must stop accepting: a session promoted now keeps
        // `sessions` non-empty and the finish gate never trips. CONNECTION_
        // REFUSED (not a code-0 close) is what makes the client reject.
        if self.closing.get() {
            handshaken.abort_error(false, QUIC_TRANSPORT_CONNECTION_REFUSED, c"");
            return;
        }
        if self.is_at_capacity() {
            handshaken.abort_error(false, QUIC_TRANSPORT_CONNECTION_REFUSED, c"");
            self.add_stat(IDX_STATS_SERVER_BUSY_COUNT, 1);
            return;
        }
        // One marker per destroyed provisional, so consume exactly one:
        // draining them all would treat a peer's later retries as live.
        let dead = peer.and_then(|peer| peer.decode()).and_then(|peer| {
            self.dead_provisional_peers.with_taken(|d| {
                let i = d.iter().position(|(addr, _)| addr.decode() == Some(peer))?;
                Some(d.swap_remove(i))
            })
        });
        if dead.is_some() {
            // Node's dead server goes silent, and `lsquic_conn_abort` sends a
            // CONNECTION_CLOSE -- use the silent variant the sibling in
            // session.rs uses.
            handshaken.abort_silent();
            return;
        }
        match self.this_value.with(Self::create_server_session) {
            Some(Ok((key, session))) => {
                session.bind(handshaken);
                session.payload().cache_sockaddrs();
                session.payload().note_handshake_ok();
                self.add_server_session(key, session);
            }
            failed => {
                // Abort like the branches above, or the conn lingers with no session behind it.
                handshaken.abort_silent();
                if let Some(Err(e)) = failed {
                    crate::dispatch::fold(Err(e));
                }
            }
        }
    }

    pub(super) fn configured_alpn(&self, is_server: bool) -> Option<Vec<u8>> {
        let alpn = if is_server {
            &self.server_alpn
        } else {
            &self.client_alpn
        };
        alpn.with_taken(|alpn| {
            let bytes = alpn.strip_suffix(b"\0").unwrap_or(alpn);
            (!bytes.is_empty()).then(|| bytes.to_vec())
        })
    }

    pub(super) fn local_tp(&self, is_server: bool) -> lsquic::NqTransportParams {
        if is_server {
            self.server_local_tp.get()
        } else {
            self.client_local_tp.get()
        }
    }

    pub(super) fn is_http(&self, is_server: bool) -> bool {
        if is_server {
            self.server_is_http.get()
        } else {
            self.client_is_http.get()
        }
    }

    fn application(&self, is_server: bool) -> session::Application {
        if self.is_http(is_server) {
            session::Application::Http3
        } else {
            session::Application::Default
        }
    }

    fn send_scope(&self) -> SendScope<'_> {
        self.send_scope_depth.update(|depth| depth + 1);
        SendScope(&self.send_scope_depth)
    }

    pub(super) fn drive_engines_once(&self) {
        if self.processing.replace(true) {
            return;
        }
        let send_scope = self.send_scope();
        bun_boringssl_sys::ERR_clear_error();
        self.for_each_engine(|engine| {
            engine.process_conns(self);
            if engine.has_unsent_packets() {
                engine.send_unsent_packets(self);
            }
        });
        drop(send_scope);
        self.processing.set(false);
    }

    pub(super) fn make_stream(&self, is_server: bool, conn: &lsquic::Conn, unidirectional: bool) {
        self.engine(is_server)
            .with_taken(|engine| engine.make_stream(conn, unidirectional));
    }

    pub(super) fn unregister_session(&self, session: Key) {
        self.sessions.remove(session);
        self.pending_new_sessions
            .with_taken(|v| v.retain(|&s| s != session));
        self.pending_verneg
            .with_taken(|v| v.retain(|&(s, _, _)| s != session));
        let now = now_ns();
        self.provisional.with_taken(|v| {
            v.retain(|p| {
                if p.session != session {
                    return true;
                }
                self.dead_provisional_peers.push((p.peer, now));
                false
            })
        });
    }

    fn read_engine_settings(
        &self,
        config: &TlsConfig,
        options: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<EngineSettings> {
        let is_server = config.is_server;
        let alpn_cstr = TlsContext::alpn_cstr(config);
        let mut settings = lsquic::Settings::new(is_server, alpn_cstr_is_http(&alpn_cstr));
        // Node always advertises datagram support.
        settings.datagrams(1);
        settings.delayed_acks(0);
        // Node's `closed` promise on the peer resolves on receipt of CONNECTION_CLOSE.
        settings.silent_close(0);
        // RFC 9000 sec 10.3: stateless reset.
        settings.send_prst(!self.disable_stateless_reset as c_int);
        settings.honor_prst(1);
        if is_server {
            let burst = self.stateless_reset_burst;
            if burst > 0 {
                settings.sreset_burst(burst as c_uint);
                settings.sreset_rate(self.stateless_reset_rate);
            }
        }
        let mut local_tp = lsquic::NqTransportParams::default();
        apply_transport_params(global, &mut settings, options, &mut local_tp)?;
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
        Ok(EngineSettings {
            settings,
            local_tp,
            alpn_cstr,
        })
    }

    fn build_engine(
        &self,
        config: &TlsConfig,
        settings: EngineSettings,
        origin_blob: Vec<u8>,
        global: &JSGlobalObject,
    ) -> JsResult<Engine> {
        let EngineSettings {
            settings,
            local_tp,
            alpn_cstr,
        } = settings;
        let is_server = config.is_server;
        let tls = TlsContext::new(config).map_err(|e| global.throw(format_args!("tls: {}", e)))?;
        let is_http = alpn_cstr_is_http(&alpn_cstr);
        if is_server && !alpn_list_is_uniform(&config.alpn) {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "options.alpn cannot mix HTTP/3 and non-HTTP/3 protocols on one endpoint; use a separate QuicEndpoint for each"
                    ),
                )
                .throw());
        }
        let Some(engine) = Engine::new(is_server, is_http, settings, tls, origin_blob) else {
            return Err(global.throw(format_args!("failed to create QUIC engine")));
        };
        if is_server {
            self.server_alpn.set(alpn_cstr);
            self.server_is_http.set(is_http);
            self.server_verify_client.set(config.verify_client);
            self.server_local_tp.set(local_tp);
        } else {
            self.client_alpn.set(alpn_cstr);
            self.client_is_http.set(is_http);
            self.client_local_tp.set(local_tp);
        }
        Ok(engine)
    }

    fn release_native(&self) -> bool {
        if self.closed.replace(true) {
            return false;
        }
        // Unlink first: the driver walk must never reach a freed endpoint.
        self.unlink_loop_driver();
        self.event_loop_timer.disarm();
        self.server_engine.clear();
        self.client_engine.clear();
        if let Some(socket) = self.socket.take() {
            uws::udp::Socket::opaque_mut(socket).close();
        }
        if let Some(key) = self.registry_key.take() {
            endpoint_registry().remove(key);
        }
        true
    }

    /// `closed` is set FIRST: it gates `schedule_process`/`rearm_timer`, so a
    /// callback running below cannot re-arm a tick onto engines this function
    /// is about to free.
    fn teardown(&self) -> bool {
        if !self.release_native() {
            return false;
        }
        self.sni_contexts.take();
        self.server_session_options.take();
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

    pub(super) fn buffer_early_keylog(&self, ssl: usize, peer: StoredAddr, line: &[u8]) {
        self.early_keylog.push((ssl, peer, line.to_vec()));
    }

    /// Without this, buffered lines outlive the freed `SSL*` and a later
    /// handshake at the recycled address claims a dead handshake's secrets.
    fn discard_early_keylog(&self, peer: &StoredAddr) {
        let peer_decoded = peer.decode();
        self.early_keylog
            .with_taken(|v| v.retain(|(_, p, _)| p.decode() != peer_decoded));
    }
    fn take_early_keylog(&self, conn: &lsquic::Conn) -> Vec<Vec<u8>> {
        let ssl = conn.ssl().map_or(0, |ssl| ssl.addr().get());
        self.early_keylog.with_taken(|v| {
            v.extract_if(.., |(s, _, _)| *s == ssl)
                .map(|(_, _, line)| line)
                .collect()
        })
    }

    fn deliver_endpoint_close(&self, context: u8, status: c_int) {
        debug_assert!(self.closed.get());
        self.poll_ref.disable();
        self.this_value.with(|this| {
            let global = this.global();
            if let Some(callback) = callbacks::get(global, "onEndpointClose") {
                let vm = global.bun_vm();
                vm.event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
                    callback,
                    global,
                    this.to_js(),
                    &[
                        JSValue::js_number(context as f64),
                        JSValue::js_number(status as f64),
                    ],
                );
            }
            this.this_value.take();
        });
    }

    pub(crate) fn listen(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        self.throw_if_closed(global)?;
        if !self.ensure_bound(global, this_value) {
            return Ok(());
        }
        if !self.server_engine.is_some() {
            let options = options.to_js();
            let session_options = SessionOptions::from_js(global, options)?;
            let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
            let mut origin_blob = Vec::new();
            // Authoritative origins for the HTTP/3 ORIGIN frame (RFC 9412
            // sec 2): each Origin-Entry is a 16-bit length prefix followed
            // by the ASCII origin.
            if tls.is_object() {
                if let Some(origins) = tls.get(global, "origins")?.filter(|v| v.is_array()) {
                    let len = origins.get_length(global)? as u32;
                    for i in 0..len {
                        let v = origins.get_index(global, i)?;
                        if !v.is_string() {
                            continue;
                        }
                        let bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
                        if bytes.is_empty() || bytes.len() > u16::MAX as usize {
                            continue;
                        }
                        origin_blob.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
                        origin_blob.extend_from_slice(&bytes);
                    }
                }
            }
            let mut config = TlsConfig::from_js(global, tls, true)?;
            if config.alpn.is_empty() {
                // Node's default ALPN is `h3`.
                config.alpn = b"\x02h3".to_vec();
            }
            let mut sni_contexts = None;
            if tls.is_object() {
                if let Some(sni) = tls.get(global, "sni")?.filter(|v| v.is_object()) {
                    sni_contexts = Some(Self::build_sni_contexts(global, sni, &config.alpn)?);
                }
            }
            let settings = self.read_engine_settings(&config, options, global)?;
            // A getter on `options` can call close() or listen().
            self.throw_if_closed(global)?;
            if !self.server_engine.is_some() {
                let engine = self.build_engine(&config, settings, origin_blob, global)?;
                self.server_engine.set(engine);
                self.server_session_options.set(session_options);
                self.server_alpn_wire.set(config.alpn);
                if let Some(sni_contexts) = sni_contexts {
                    self.sni_contexts.set(sni_contexts);
                }
            }
        }
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
        self.throw_if_closed(global)?;
        if !self.ensure_bound(global, this_value) {
            return Ok(JSValue::UNDEFINED);
        }
        let options = options.to_js();
        let session_ticket = session_ticket.to_js();
        let Some(remote) = StoredAddr::from_js(address.to_js()) else {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"address\" argument must be an instance of SocketAddress"),
                )
                .throw());
        };
        if let Some(version) = read_u64_option(global, options, "version")?
            .map(|v| v as u32)
            .filter(|v| *v != QUIC_VERSION_1 && *v != QUIC_VERSION_2)
        {
            let min_version = read_u64_option(global, options, "minVersion")?
                .map_or(QUIC_VERSION_1, |v| v as u32);
            self.throw_if_closed(global)?;
            return self.connect_verneg_probe(global, this_value, remote, version, min_version);
        }
        let tls = options.get(global, "tls")?.unwrap_or(JSValue::UNDEFINED);
        let config = TlsConfig::from_js(global, tls, false)?;
        let settings = if self.client_engine.is_some() {
            None
        } else {
            Some(self.read_engine_settings(&config, options, global)?)
        };
        // Node's DEFAULT_MAX_IDLE_TIMEOUT is 10 seconds when unspecified.
        let idle_ms = options
            .get(global, "transportParams")?
            .filter(|v| v.is_object())
            .map(|tp| read_u64_option(global, tp, "maxIdleTimeout"))
            .transpose()?
            .flatten()
            .map(|secs| secs.saturating_mul(MS_PER_SEC))
            .unwrap_or(DEFAULT_MAX_IDLE_TIMEOUT_SECS * MS_PER_SEC);
        let keepalive_us =
            read_u64_option(global, options, "keepAlive")?.map_or(0, |ms| ms.saturating_mul(1000));
        let use_preferred = read_u64_option(global, options, "preferredAddressPolicy")?
            == Some(PREFERRED_ADDRESS_USE);
        let session_options = SessionOptions::from_js(global, options)?;
        // A getter on `options` can call close() or connect().
        self.throw_if_closed(global)?;
        match settings.filter(|_| !self.client_engine.is_some()) {
            Some(settings) => {
                let engine = self.build_engine(&config, settings, Vec::new(), global)?;
                self.client_engine.set(engine);
            }
            None => self.replace_client_tls(&config, global)?,
        }
        // A reused endpoint must not report the first session's value in localTransportParams().
        self.client_local_tp.update(|tp| lsquic::NqTransportParams {
            max_idle_timeout: idle_ms,
            ..tp
        });
        let ticket = session_ticket
            .as_array_buffer(global)
            .filter(|_| config.enable_early_data);
        let sess_resume = ticket.as_ref().map_or(&[][..], |buf| buf.byte_slice());
        let key = self.sessions.next_key();
        let strong = QuicSession::create(
            global,
            StrongWrapper::new(this_value, global),
            key,
            false,
            self.application(false),
            session_options,
        )?;
        // `TlsConfig::from_js` defaults servername to "localhost\0" (Node parity).
        let sni = config
            .servername
            .as_deref()
            .and_then(|s| CStr::from_bytes_until_nul(s).ok());
        self.client_engine.with_taken(|engine| {
            engine.set_idle_timeout_ms(idle_ms.min(c_uint::MAX as u64) as c_uint);
            engine.connect(&strong, &self.local_addr.get(), &remote, sni, sess_resume);
        });
        let session = strong.payload();
        if session.conn.is_null() {
            session.teardown(global);
            return Ok(JSValue::UNDEFINED);
        }
        session.cache_sockaddrs();
        if !sess_resume.is_empty() {
            session.apply_peer_datagram_budget();
        }
        // keepAlive is per-session in Node.
        session.conn.set_ping_period_us(keepalive_us);
        if use_preferred {
            session.conn.use_preferred_address(true);
        }
        let handle = strong.to_js();
        self.sessions.insert(key, strong);
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        self.schedule_process();
        Ok(handle)
    }

    /// Node's TLS options are per-session, but the lsquic engine is per-endpoint.
    fn replace_client_tls(&self, config: &TlsConfig, global: &JSGlobalObject) -> JsResult<()> {
        if alpn_cstr_is_http(&TlsContext::alpn_cstr(config)) != self.client_is_http.get() {
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
        let tls = TlsContext::new(config).map_err(|e| global.throw(format_args!("{e}")))?;
        self.client_engine
            .with_taken(|engine| engine.set_client_tls(tls));
        Ok(())
    }

    fn connect_verneg_probe(
        &self,
        global: &JSGlobalObject,
        this_value: JsWrapper<'_, Self>,
        remote: StoredAddr,
        version: u32,
        min_version: u32,
    ) -> JsResult<JSValue> {
        let key = self.sessions.next_key();
        let strong = QuicSession::create(
            global,
            StrongWrapper::new(this_value, global),
            key,
            false,
            session::Application::None,
            SessionOptions::default(),
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
        let session = strong.payload();
        session.verneg.set(Some((version, min_version)));
        session.remote_addr.set(remote);
        let handle = strong.to_js();
        self.pending_verneg.push((key, scid, now_ns()));
        // A probe has no engine, so nothing else would ever arm the timer that
        // runs the sweep expiring it.
        self.schedule_process();
        self.sessions.insert(key, strong);
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        if let Some(socket) = self.socket.get() {
            uws::udp::Socket::opaque_mut(socket).send(
                &[probe.as_ptr()],
                &[probe.len()],
                &[remote.as_ptr()],
            );
            self.add_stat(IDX_STATS_PACKETS_SENT, 1);
            self.add_stat(IDX_STATS_BYTES_SENT, probe.len() as u64);
        }
        Ok(handle)
    }

    /// The VN packet's DCID echoes the probe's SCID — RFC 8999 sec 6.
    fn handle_version_negotiation(&self, payload: &[u8]) -> bool {
        if self.pending_verneg.is_empty() {
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
        let session = self.pending_verneg.with_taken(|v| {
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
        self.sessions.with(session, |session| {
            session.push_event(session::SessionEvent::VersionNegotiation { server_versions })
        });
        self.schedule_process();
        true
    }

    fn mark_closing(&self) {
        self.closing.set(true);
        self.with_state(|s| {
            s.closing = 1;
            s.listening = 0;
        });
    }

    pub(crate) fn close_gracefully(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) {
        if self.closed.get() || self.closing.get() {
            return;
        }
        self.mark_closing();
        if self.this_value.is_none() {
            self.this_value
                .set(StrongWrapper::new(this_value, cx.global()));
        }
        if self.sessions.is_empty() && self.engine_conn_count() == 0 {
            self.finish_close();
        } else {
            self.schedule_process();
        }
    }

    pub(crate) fn release_socket(&self, _: &mut JsScope<'_>) {
        self.pending_endpoint_close.set(false);
        self.teardown();
        self.poll_ref.disable();
    }

    pub(crate) fn address(&self, cx: &mut JsScope<'_>) -> JSValue {
        self.local_addr.get().to_js_socket_address(cx.global())
    }
    pub(crate) fn mark_busy(&self, busy: bool) {
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
        let mut alpn = self.server_alpn_wire.with_taken(|alpn| alpn.clone());
        if alpn.is_empty() {
            alpn = b"\x02h3".to_vec();
        }
        let built = Self::build_sni_contexts(global, entries, &alpn)?;
        self.sni_contexts.with_taken(|map| {
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
        Ok(())
    }
}

struct SendScope<'a>(&'a Cell<u32>);

impl Drop for SendScope<'_> {
    fn drop(&mut self) {
        self.0.update(|depth| depth - 1);
    }
}

impl Drop for QuicEndpoint {
    fn drop(&mut self) {
        self.release_native();
    }
}
