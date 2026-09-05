//! `QuicEndpoint` native handle (lsquic-backed) — Node's
//! `internalBinding('quic').Endpoint` analog (node/src/quic/endpoint.{h,cc}).

use core::cell::Cell;
use core::ffi::{CStr, c_int, c_uint};
use core::ptr::NonNull;
use std::ffi::CString;

use bun_io::KeepAlive;
use bun_jsc::{
    self as jsc, AliasedStruct, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsRef,
    JsResult, StringJsc,
};
use bun_lsquic_sys as lsquic;
use bun_ptr::{BackRef, RefPtr, Root, ThisPtr};
use bun_uws as uws;

use crate::jsc_hooks::timer_all_mut as timer_all;
use crate::node::net::block_list::BlockList;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

use super::callbacks;
use super::now_ns;
use super::session::{self, QuicSession, StoredAddr};
use super::tls::{TlsConfig, TlsContext};

bun_core::declare_scope!(quic, hidden);

bun_jsc::aliased_struct! {
    /// Mirrors Node's `Endpoint::State`; shared with JS as the `state` buffer.
    pub struct EndpointState {
        pub bound: u8,
        pub(crate) receiving: u8,
        pub(crate) listening: u8,
        pub(crate) closing: u8,
        pub(crate) busy: u8,
        pub(crate) max_connections_per_host: u16,
        pub(crate) max_connections_total: u16,
        pub(crate) pending_callbacks: u64,
    }
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
type EndpointStats = [Cell<u64>; ENDPOINT_STATS_FIELDS.len()];

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

struct ProvisionalSession {
    dcid: Vec<u8>,
    peer: StoredAddr,
    created_ns: u64,
    session: session::Id,
}

struct BindConfig {
    host: CString,
    port: u16,
}

impl Default for BindConfig {
    fn default() -> Self {
        BindConfig {
            host: c"127.0.0.1".to_owned(),
            port: 0,
        }
    }
}

/// The one lsquic callback table for this endpoint type.
static NQ_VTABLE: lsquic::NqVtable<QuicEndpoint> = lsquic::NqVtable::new();

#[derive(bun_ptr::CellRefCounted)]
pub struct QuicEndpoint {
    ref_count: Cell<u32>,
    /// Set from the allocating `RefPtr` so `&self` paths can mint the refs
    /// held by sessions, engines, the socket and the loop driver.
    self_ref: Cell<BackRef<QuicEndpoint, Root>>,
    state: AliasedStruct<EndpointState>,
    stats: AliasedStruct<EndpointStats>,
    closing: Cell<bool>,
    closed: Cell<bool>,

    /// The bound UDP socket; its user slot holds a ref on this endpoint.
    socket: JsCell<Option<uws::udp::UdpSocket<QuicEndpoint>>>,
    bind_config: JsCell<BindConfig>,
    local_addr: Cell<StoredAddr>,
    poll_ref: JsCell<KeepAlive>,
    this_value: JsCell<JsRef>,

    /// Both can coexist on one endpoint — Node allows that.
    server_engine: JsCell<Option<lsquic::Engine<QuicEndpoint>>>,
    client_engine: JsCell<Option<lsquic::Engine<QuicEndpoint>>>,
    server_tls: JsCell<Option<TlsContext>>,
    client_tls: JsCell<Option<TlsContext>>,
    sni_contexts: JsCell<Vec<(Vec<u8>, TlsContext)>>,
    server_alpn_wire: JsCell<Vec<u8>>,
    send_scratch: JsCell<Vec<u8>>,
    /// The first ALPN protocol, NUL-terminated (empty when none configured).
    client_alpn: JsCell<Vec<u8>>,
    server_alpn: JsCell<Vec<u8>>,
    server_is_http: Cell<bool>,
    client_is_http: Cell<bool>,
    pub(super) server_verify_client: Cell<bool>,
    server_session_options: JsCell<Option<bun_jsc::Strong>>,
    disable_stateless_reset: Cell<bool>,
    stateless_reset_burst: Cell<u32>,
    stateless_reset_rate: Cell<f64>,
    /// Pre-encoded HTTP/3 ORIGIN frame payload (RFC 9412), handed to the
    /// server engine's settings at creation.
    origin_blob: JsCell<Vec<u8>>,

    processing: Cell<bool>,
    followup_due: Cell<bool>,
    sessions: JsCell<Vec<RefPtr<QuicSession>>>,
    pub(super) server_local_tp: JsCell<lsquic::NqTransportParams>,
    pub(super) client_local_tp: JsCell<lsquic::NqTransportParams>,
    pending_new_sessions: JsCell<Vec<session::Id>>,
    /// Server sessions announced at Initial receipt (Node's event order).
    provisional: JsCell<Vec<ProvisionalSession>>,
    pending_verneg: JsCell<Vec<(session::Id, [u8; VERNEG_PROBE_CID_LEN], u64)>>,
    dead_provisional_peers: JsCell<Vec<(StoredAddr, u64)>>,
    /// Released in `Drop`.
    block_list: JsCell<Option<RefPtr<BlockList>>>,
    /// Key log lines that arrived before the session was bound, keyed by the
    /// handshake's `SSL` identity and peer.
    early_keylog: JsCell<Vec<(NonNull<bun_boringssl_sys::SSL>, StoredAddr, Vec<u8>)>>,
    block_list_js: JsCell<Option<bun_jsc::Strong>>,
    block_list_allow: Cell<bool>,
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pending_endpoint_close: Cell<bool>,
    /// This endpoint's node on the loop's node:quic driver list; registered
    /// only while it holds a socket. `us_nq_loop_flush_if_pending` runs the
    /// process pass once per loop turn when it is marked pending.
    driver: lsquic::NqDriver<QuicEndpoint>,
    /// Set while the pass runs from the microtask drain: session Closed events
    /// are requeued for the next loop point instead of dispatching mid-chain.
    pub(super) defer_closes: Cell<bool>,
    /// Native-entry depth, node's Session::SendPendingDataScope. Non-zero means
    /// a native callback (on_data, the timer) is on the stack and owns the
    /// flush when it unwinds -- JS it dispatches (onSessionNew and friends) must
    /// not re-enter lsquic mid-callback, which is why `processing` alone is not
    /// enough: on_data announces to JS *before* it feeds packets.
    send_scope_depth: Cell<u32>,

    global: GlobalRef,
}

impl Drop for QuicEndpoint {
    fn drop(&mut self) {
        // The heap must not keep a node that points into freed storage.
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
    }
}

impl QuicEndpoint {
    fn this_ptr(&self) -> ThisPtr<QuicEndpoint> {
        self.self_ref.get().this_ptr()
    }

    /// Links this endpoint into the loop's driver list. Idempotent.
    fn link_loop_driver(&self) {
        self.driver.register(self.this_ptr());
    }

    /// Unlinks from the loop's driver list. Idempotent.
    fn unlink_loop_driver(&self) {
        self.driver.unregister();
    }

    /// Marks that lsquic has work queued, so the next driver pass runs.
    fn mark_driver_pending(&self) {
        self.driver.mark_pending();
    }

    /// Runs a driver pass, or hands `pending` back when one cannot run now.
    /// `defer_closes` distinguishes the microtask-drain pass, which must not
    /// let a session end mid-chain, from the loop_pre/loop_post pass.
    fn run_driver_pass(&self, defer_closes: bool) {
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
        self.defer_closes.set(defer_closes);
        self.process(&self.global);
        self.defer_closes.set(false);
    }
}

impl lsquic::NqDriverOwner for QuicEndpoint {
    /// One process pass per loop turn (loop_pre/loop_post): the writes a JS
    /// turn queued leave as one engine pass and one sendmmsg batch.
    fn process_pass(this: ThisPtr<Self>) {
        let _keep = RefPtr::from_this(this);
        this.run_driver_pass(false);
    }

    /// The microtask-drain pass: full processing, but session close events
    /// hold until the next loop point so a running microtask chain never
    /// observes a session ending mid-chain (node's loop never interleaves
    /// that way).
    fn drain_pass(this: ThisPtr<Self>) {
        let _keep = RefPtr::from_this(this);
        this.run_driver_pass(true);
    }
}

thread_local! {
    /// A server may advertise another local endpoint's address as its
    /// preferred_address (RFC 9000 sec 9.6). Holds a ref on every bound
    /// endpoint until `release_native`; never released by thread exit, which
    /// comes after the VM (and the timer heap an endpoint unlinks from) is gone.
    static ENDPOINT_REGISTRY: core::cell::RefCell<core::mem::ManuallyDrop<Vec<RefPtr<QuicEndpoint>>>> =
        const { core::cell::RefCell::new(core::mem::ManuallyDrop::new(Vec::new())) };
}

/// Every other registered endpoint, each with a ref held for the caller's
/// scope: a pass on one runs JS that can close and release another.
fn registry_others(not: &QuicEndpoint) -> Vec<(ThisPtr<QuicEndpoint>, RefPtr<QuicEndpoint>)> {
    ENDPOINT_REGISTRY.with_borrow(|v| {
        v.iter()
            .filter(|e| !core::ptr::eq(e.as_ptr(), not))
            .map(|e| (e.this_ptr(), e.clone()))
            .collect()
    })
}

fn registry_contains(ep: ThisPtr<QuicEndpoint>) -> bool {
    ENDPOINT_REGISTRY.with_borrow(|v| v.iter().any(|e| core::ptr::eq(e.as_ptr(), ep.as_ptr())))
}

fn registry_find_by_addr(addr: &StoredAddr, not: &QuicEndpoint) -> Option<ThisPtr<QuicEndpoint>> {
    let want = addr.decode().map(|(f, p, ip)| (f, p, ip.to_vec()));
    ENDPOINT_REGISTRY.with_borrow(|v| {
        v.iter()
            .filter(|e| !core::ptr::eq(e.as_ptr(), not))
            .find(|e| {
                let theirs = e.local_addr.get();
                theirs.decode().map(|(f, p, ip)| (f, p, ip.to_vec())) == want
            })
            .map(RefPtr::this_ptr)
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
const VERSION_FIELD_LEN: usize = 4;
const VERNEG_PROBE_CID_LEN: usize = 8;
/// RFC 9000 sec 14.1: servers may drop Initial-like datagrams smaller than
/// 1200 bytes, so the probe pads to the minimum.
const VERNEG_PROBE_LEN: usize = 1200;
const SHORT_HEADER_DCID_LEN: usize = 8;

impl uws::udp::UdpHandler for QuicEndpoint {
    fn on_drain(this: ThisPtr<Self>, _socket: &mut uws::udp::Socket) {
        if this.closed.get() {
            return;
        }
        this.with_engines(|engine| engine.send_unsent_packets());
        this.schedule_process();
    }

    /// Our own `close()` has already taken the handle; a poll-error close by
    /// uSockets has not, and the socket is freed after this returns.
    fn on_close(this: ThisPtr<Self>, _socket: &mut uws::udp::Socket) {
        if let Some(socket) = this.socket.replace(None) {
            socket.closed();
            this.unlink_loop_driver();
        }
    }

    fn on_data(
        this: ThisPtr<Self>,
        _socket: &mut uws::udp::Socket,
        buf: &mut uws::udp::PacketBuffer,
        packets: c_int,
    ) {
        let _keep = RefPtr::from_this(this);
        let this: &QuicEndpoint = &this;
        let global: &JSGlobalObject = &this.global;
        let local = this.local_addr.get();
        // Apply a stashed close before feeding: a closing peer discards new
        // streams rather than announcing them (RFC 9000 s10.2.1), and ci_close
        // only schedules, so the engines have to run for it to take effect.
        let mut closed_any = false;
        for id in this.session_ids() {
            if let Some(session) = this.live_session(id) {
                closed_any |= session.flush_pending_graceful();
            }
        }
        if closed_any {
            this.drive_engines_once();
        }
        // This callback dispatches JS (provisional announce) before it feeds
        // packets; hold the send scope so that JS cannot flush lsquic underneath us.
        this.send_scope_depth.set(this.send_scope_depth.get() + 1);
        bun_boringssl_sys::ERR_clear_error();
        for i in 0..packets {
            let peer_sa = StoredAddr::from_lsquic(lsquic::SockAddr::from_storage(buf.get_peer(i)));
            let peer = peer_sa.as_sockaddr();
            let payload: &[u8] = buf.get_payload(i);
            if payload.is_empty() {
                continue;
            }
            this.add_stat(IDX_STATS_PACKETS_RECEIVED, 1);
            this.add_stat(IDX_STATS_BYTES_RECEIVED, payload.len() as u64);
            if this.peer_blocked(&peer_sa) {
                continue;
            }
            // Which of our engines already hashes this DCID, if either. Feeding the
            // other one a packet it cannot match makes it answer with a stateless
            // reset, so remember the owner for the feed below.
            let mut owner_engine: Option<bool> = None;
            if payload[0] & HEADER_FORM_LONG == 0 && payload.len() > 1 + SHORT_HEADER_DCID_LEN {
                let dcid = &payload[1..1 + SHORT_HEADER_DCID_LEN];
                owner_engine = this.engine_with_cid(dcid);
                if owner_engine.is_none() {
                    // Keep which engine hashed the DCID, as the local path above
                    // does: feeding the sibling engine too makes it treat the
                    // packet as an unknown-CID arrival.
                    let owner = registry_others(this).into_iter().find_map(|(other, keep)| {
                        other.engine_with_cid(dcid).map(|e| (other, keep, e))
                    });
                    if let Some((other, _keep_other, is_server)) = owner {
                        if other.peer_blocked(&peer_sa) {
                            continue;
                        }
                        // Fed with OUR local address (the migration target).
                        other.with_engine(is_server, |engine| {
                            engine.packet_in(payload, local.as_sockaddr(), peer, 0);
                        });
                        other.process(global);
                        continue;
                    }
                    // May be a stateless reset (RFC 9000 sec 10.3).
                    if payload.len() >= STATELESS_RESET_MIN_LEN {
                        for (other, _keep_other) in registry_others(this) {
                            // A pass on an earlier entry runs JS that can close
                            // a later one; skip those.
                            if !registry_contains(other) {
                                continue;
                            }
                            if other.peer_blocked(&peer_sa) {
                                continue;
                            }
                            other.with_engines(|engine| {
                                engine.packet_in(payload, local.as_sockaddr(), peer, 0);
                            });
                            other.process(global);
                        }
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
            // Node announces server sessions at Initial receipt — before the
            // handshake — so `onsession` precedes the client's `opened`.
            if let Err(err) = this.maybe_announce_provisional(global, payload, peer_sa) {
                crate::dispatch::fold(Err(err));
            }
            match owner_engine {
                // Already matched above: the other engine would only miss it.
                Some(is_server) => this.with_engine(is_server, |engine| {
                    engine.packet_in(payload, local.as_sockaddr(), peer, 0);
                }),
                None => this.with_engines(|engine| {
                    engine.packet_in(payload, local.as_sockaddr(), peer, 0);
                }),
            }
        }
        // Keep the scope through the tail pass: a graceful close a handler queued
        // during this dispatch must not join the same flight as the data the
        // handlers wrote (sessions stash it; the next depth-0 pass applies it).
        this.process(global);
        this.send_scope_depth.set(this.send_scope_depth.get() - 1);
    }
}

impl lsquic::NqEndpoint for QuicEndpoint {
    type Session = QuicSession;

    fn on_new_conn(this: ThisPtr<Self>, conn: lsquic::Conn) -> Option<RefPtr<QuicSession>> {
        this.accept_conn(conn)
    }

    fn on_mini_conn_failed(&self, peer: &lsquic::SockAddr, error_code: u64) {
        /// CRYPTO_ERROR base (RFC 9001 §4.8) + TLS no_application_protocol(120).
        const CRYPTO_ERROR_NO_APPLICATION_PROTOCOL: u64 = 0x0100 + 120;
        let peer = StoredAddr::from_lsquic(peer);
        self.discard_early_keylog(&peer);
        let peer_decoded = peer.decode();
        let failed = self.provisional.with_mut(|v| {
            let idx = v.iter().position(|p| p.peer.decode() == peer_decoded);
            idx.map(|i| v.remove(i).session)
        });
        /// Bit 63 marks "the peer sent its own CONNECTION_CLOSE" (QUIC codes
        /// fit in 62 bits); the low bits carry the peer's code. See the
        /// connection-close-pns lsquic patch.
        const PEER_CLOSE_BIT: u64 = 1 << 63;
        if let Some(session) = failed {
            if let Some(session) = self.live_session(session) {
                if error_code & PEER_CLOSE_BIT != 0 {
                    // Not a failure: the client closed during the handshake
                    // (connect() then immediate close()). Report the peer's
                    // own code so `closed` settles the way node's does.
                    session.push_event(session::SessionEvent::PeerClose {
                        app_error: false,
                        code: error_code & !PEER_CLOSE_BIT,
                        reason: Vec::new(),
                    });
                    session.push_event(session::SessionEvent::Closed);
                    session.schedule_process();
                    return;
                }
                if error_code == 0 {
                    // The peer went away without a frame (destroyed client,
                    // dropped packets): node's server surfaces the idle death
                    // of a handshaking session as a clean close, not an error.
                    session.push_event(session::SessionEvent::PeerClose {
                        app_error: false,
                        code: 0,
                        reason: Vec::new(),
                    });
                    session.push_event(session::SessionEvent::Closed);
                    session.schedule_process();
                    return;
                }
                let code = error_code;
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

    fn packets_out(this: ThisPtr<Self>, specs: lsquic::OutSpecs<'_>) -> c_int {
        let Some(socket) = this.socket_ptr() else {
            return 0;
        };
        let my_addr = this.local_addr.get();
        let mut sent = 0;
        for spec in specs.iter() {
            let mut iov = spec.iov();
            let first = iov.next();
            let second = iov.next();
            let payload: &[u8] = match (first, second) {
                (None, _) => &[],
                (Some(only), None) => only,
                (Some(a), Some(b)) => {
                    this.send_scratch.with_mut(|buf| {
                        buf.clear();
                        buf.extend_from_slice(a);
                        buf.extend_from_slice(b);
                        for more in iov {
                            buf.extend_from_slice(more);
                        }
                    });
                    // Nothing below touches `send_scratch`.
                    this.send_scratch.get()
                }
            };
            let dest = spec
                .dest()
                .map(StoredAddr::from_lsquic_full)
                .unwrap_or_default();
            if payload.is_empty() || !dest.is_set() {
                sent += 1;
                continue;
            }
            let spec_local = spec
                .local()
                .map(StoredAddr::from_lsquic_full)
                .unwrap_or_default();
            let out_socket = if spec_local.is_set() && spec_local.decode() != my_addr.decode() {
                registry_find_by_addr(&spec_local, &this)
                    .and_then(|other| other.socket_ptr())
                    .unwrap_or(socket)
            } else {
                socket
            };
            let rv = uws::udp::Socket::opaque_mut(out_socket.as_ptr()).send(
                &[payload.as_ptr()],
                &[payload.len()],
                &[dest.as_sockaddr_ptr()],
            );
            if rv < 1 {
                // EMSGSIZE has to survive: it is how lsquic learns to drop an
                // oversized packet and feed DPLPMTUD (ci_packet_too_large).
                // Anything else it cannot act on becomes backpressure.
                let e = bun_sys::last_errno();
                if e != libc::EAGAIN && e != libc::EWOULDBLOCK && e != libc::EMSGSIZE {
                    bun_sys::set_last_errno(libc::EAGAIN);
                }
                break;
            }
            this.add_stat(IDX_STATS_PACKETS_SENT, 1);
            this.add_stat(IDX_STATS_BYTES_SENT, payload.len() as u64);
            sent += 1;
        }
        sent
    }

    fn ssl_ctx(&self) -> *mut lsquic::SSL_CTX {
        self.server_tls
            .get()
            .as_ref()
            .or_else(|| self.client_tls.get().as_ref())
            .map(TlsContext::raw)
            .unwrap_or(core::ptr::null_mut())
    }

    fn client_ssl_ctx(&self) -> *mut lsquic::SSL_CTX {
        self.client_tls
            .get()
            .as_ref()
            .or_else(|| self.server_tls.get().as_ref())
            .map(TlsContext::raw)
            .unwrap_or(core::ptr::null_mut())
    }

    fn lookup_cert(&self, sni: Option<&CStr>) -> *mut lsquic::SSL_CTX {
        if let Some(sni) = sni {
            let entries = self.sni_contexts.get();
            if let Some(ctx) = match_sni(entries, sni.to_bytes()) {
                return ctx.raw();
            }
        }
        lsquic::NqEndpoint::ssl_ctx(self)
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
            let Some(addr_js) = tp.get(global, key)?.filter(|v| v.is_object()) else {
                continue;
            };
            let Some(addr) = addr_js.as_class_ref::<crate::socket::SocketAddress>() else {
                continue;
            };
            let stored = StoredAddr::from_socket_address(addr);
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

/// Publish `state`/`stats` buffers on a handle the way Node's JS layer reads
/// them (`kState`/`kStats` over `handle.state`/`handle.stats`).
pub(super) fn expose_state_buffers<S: bun_jsc::AliasedCells, const N: usize>(
    global: &JSGlobalObject,
    holder: JSValue,
    state: &AliasedStruct<S>,
    stats: &AliasedStruct<[Cell<u64>; N]>,
) -> JsResult<()> {
    holder.put(global, b"state", state.to_array_buffer(global)?);
    holder.put(global, b"stats", stats.to_array_buffer(global)?);
    holder.put(global, b"stateByteOffset", JSValue::js_number(0.0));
    holder.put(global, b"statsByteOffset", JSValue::js_number(0.0));
    Ok(())
}

impl QuicEndpoint {
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut Self> {
        static INIT: std::sync::Once = std::sync::Once::new();
        INIT.call_once(|| {
            lsquic::global_init();
            if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_lsquic")).is_some() {
                lsquic::enable_logging(c"debug");
            }
        });
        lsquic::assert_layout();

        let this = RefPtr::new(QuicEndpoint {
            ref_count: Cell::new(1),
            self_ref: Cell::new(BackRef::dangling()),
            state: AliasedStruct::zeroed(),
            stats: AliasedStruct::zeroed(),
            closing: Cell::new(false),
            closed: Cell::new(false),
            socket: JsCell::new(None),
            bind_config: JsCell::new(BindConfig::default()),
            local_addr: Cell::new(StoredAddr::default()),
            poll_ref: JsCell::new(KeepAlive::init()),
            this_value: JsCell::new(JsRef::empty()),
            server_engine: JsCell::new(None),
            client_engine: JsCell::new(None),
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
            followup_due: Cell::new(false),
            sessions: JsCell::new(Vec::new()),
            server_local_tp: JsCell::new(lsquic::NqTransportParams::default()),
            client_local_tp: JsCell::new(lsquic::NqTransportParams::default()),
            pending_new_sessions: JsCell::new(Vec::new()),
            provisional: JsCell::new(Vec::new()),
            pending_verneg: JsCell::new(Vec::new()),
            dead_provisional_peers: JsCell::new(Vec::new()),
            block_list: JsCell::new(None),
            early_keylog: JsCell::new(Vec::new()),
            block_list_js: JsCell::new(None),
            block_list_allow: Cell::new(false),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::QuicEndpoint,
            )),
            pending_endpoint_close: Cell::new(false),
            driver: lsquic::NqDriver::new(),
            defer_closes: Cell::new(false),
            send_scope_depth: Cell::new(0),
            global: GlobalRef::new(global),
        });
        this.self_ref.set(BackRef::from(this.this_ptr()));
        // Codegen installs the pointer on the JS object only after this
        // returns Ok, so a throw from any option read below must release
        // the endpoint and any Strong already stored in it.
        Self::construct_options(&this, global, frame, this_value)?;
        Ok(RefPtr::into_raw(this))
    }

    fn construct_options(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<()> {
        let [options] = frame.arguments_as_array::<1>();
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
                        let host = CString::new(host).unwrap_or_default();
                        self.bind_config.set(BindConfig { host, port });
                    }
                }
            }
            if let Some(bl_js) = options.get(global, "blockList")?.filter(|v| v.is_object()) {
                if let Some(bl) = bl_js.as_class_this_ptr::<BlockList>() {
                    // The Strong keeps the BlockList wrapper alive for the
                    // endpoint's lifetime, as node does.
                    self.block_list.set(Some(RefPtr::from_this(bl)));
                    self.block_list_js
                        .with_mut(|s| *s = Some(bun_jsc::Strong::create(bl_js, global)));
                }
            }
            if let Some(policy) = options
                .get(global, "blockListPolicy")?
                .filter(|v| v.is_string())
            {
                let policy = bun_core::String::from_js(policy, global)?.to_owned_slice();
                self.block_list_allow.set(policy == b"allow");
            }
            if let Some(v) = options
                .get(global, "disableStatelessReset")?
                .filter(|v| v.is_boolean())
            {
                self.disable_stateless_reset.set(v.to_boolean());
            }
            if let Some(v) = options
                .get(global, "statelessResetBurst")?
                .filter(|v| v.is_number())
            {
                let burst = v.as_number().max(0.0).min(u32::MAX as f64) as u32;
                self.stateless_reset_burst.set(burst);
            }
            if let Some(v) = options
                .get(global, "statelessResetRate")?
                .filter(|v| v.is_number())
            {
                self.stateless_reset_rate.set(v.as_number().max(0.0));
            }
        }

        expose_state_buffers(global, this_value, &self.state, &self.stats)?;
        self.write_stat(IDX_STATS_CREATED_AT, now_ns());
        Ok(())
    }

    fn socket_ptr(&self) -> Option<NonNull<uws::udp::Socket>> {
        self.socket.get().as_ref().map(uws::udp::UdpSocket::as_ptr)
    }
    fn session_ids(&self) -> Vec<session::Id> {
        self.sessions.get().iter().map(|s| s.id()).collect()
    }
    /// A session still in the `sessions` registry — `unregister_session`
    /// always precedes the session's teardown, and the registry entry holds
    /// a ref, so the handle is live while it is registered.
    fn live_session(&self, id: session::Id) -> Option<ThisPtr<QuicSession>> {
        self.sessions
            .get()
            .iter()
            .find(|s| s.id() == id)
            .map(RefPtr::this_ptr)
    }
    fn register_session(&self, session: &RefPtr<QuicSession>) {
        self.sessions.with_mut(|v| v.push(session.clone()));
    }
    fn write_stat(&self, idx: usize, value: u64) {
        if let Some(slot) = self.stats.get(idx) {
            slot.set(value);
        }
    }
    fn add_stat(&self, idx: usize, value: u64) {
        if let Some(slot) = self.stats.get(idx) {
            slot.set(slot.get().wrapping_add(value));
        }
    }

    fn with_engine(&self, is_server: bool, f: impl FnOnce(&lsquic::Engine<QuicEndpoint>)) {
        let slot = if is_server {
            &self.server_engine
        } else {
            &self.client_engine
        };
        if let Some(engine) = slot.get().as_ref() {
            f(engine);
        }
    }
    /// `f` on the server engine, then the client engine, for those that exist.
    fn with_engines(&self, mut f: impl FnMut(&lsquic::Engine<QuicEndpoint>)) {
        for slot in [&self.server_engine, &self.client_engine] {
            if let Some(engine) = slot.get().as_ref() {
                f(engine);
            }
        }
    }
    fn has_engine(&self, is_server: bool) -> bool {
        if is_server {
            self.server_engine.get().is_some()
        } else {
            self.client_engine.get().is_some()
        }
    }
    /// Which engine (`true` = server) already hashes `cid`, if either.
    fn engine_with_cid(&self, cid: &[u8]) -> Option<bool> {
        [(true, &self.server_engine), (false, &self.client_engine)]
            .into_iter()
            .find(|(_, slot)| slot.get().as_ref().is_some_and(|e| e.cid_in_use(cid)))
            .map(|(is_server, _)| is_server)
    }

    fn peer_blocked(&self, peer: &StoredAddr) -> bool {
        let Some(bl) = self.block_list.get().as_ref() else {
            return false;
        };
        let Some(addr) = peer.to_socket_address() else {
            return false;
        };
        let blocked = bl.check_sockaddr(&addr._addr) != self.block_list_allow.get();
        if blocked {
            self.add_stat(IDX_STATS_PACKETS_BLOCKED, 1);
        }
        blocked
    }

    /// Returns `Ok(false)` when the bind fails: Node does not throw here.
    fn ensure_bound(&self, global: &JSGlobalObject, this_value: JSValue) -> JsResult<bool> {
        if self.socket.get().is_some() {
            return Ok(true);
        }
        let created = {
            let cfg = self.bind_config.get();
            uws::udp::UdpSocket::create(&cfg.host, cfg.port, 0, self.this_ptr())
        };
        let socket = match created {
            Ok(socket) => socket,
            Err(err) => {
                self.this_value
                    .with_mut(|r| r.set_strong(this_value, global));
                self.finish_close();
                self.pending_endpoint_close.set(false);
                self.deliver_endpoint_close(global, CLOSECONTEXT_BIND_FAILURE, err);
                return Ok(false);
            }
        };
        // Linked only while we hold a socket, so an idle endpoint costs the
        // loop nothing.
        self.link_loop_driver();
        let sock = socket.get();
        let port = sock.bound_port();
        let mut ip = [0u8; IPV6_ADDR_LEN];
        let len = sock.bound_ip_into(&mut ip);
        let addr = match len {
            IPV4_ADDR_LEN => {
                crate::socket::SocketAddress::init_ipv4([ip[0], ip[1], ip[2], ip[3]], port as u16)
            }
            IPV6_ADDR_LEN => crate::socket::SocketAddress::init_ipv6(ip, port as u16, 0, 0),
            _ => crate::socket::SocketAddress::init_ipv4([127, 0, 0, 1], port as u16),
        };
        self.socket.set(Some(socket));
        self.local_addr.set(StoredAddr::from_socket_address(&addr));
        self.state.bound.set(1);
        self.state.receiving.set(1);
        self.this_value
            .with_mut(|r| r.set_strong(this_value, global));
        self.update_keepalive();
        ENDPOINT_REGISTRY.with_borrow_mut(|v| {
            if !v.iter().any(|e| core::ptr::eq(e.as_ptr(), self)) {
                v.push(RefPtr::from_this(self.this_ptr()));
            }
        });
        Ok(true)
    }

    fn update_keepalive(&self) {
        if self.closed.get() || self.socket.get().is_none() {
            return;
        }
        let listening = self.state.listening.get() != 0;
        let busy = listening || !self.sessions.get().is_empty();
        let ctx = bun_io::js_vm_ctx();
        self.poll_ref
            .with_mut(|p| if busy { p.ref_(ctx) } else { p.unref(ctx) });
    }

    fn process(&self, global: &JSGlobalObject) {
        if self.closed.get() {
            return;
        }
        if self.processing.replace(true) {
            return;
        }
        let _keep_self = RefPtr::from_this(self.this_ptr());
        // A depth-0 pass runs after the previous flight left the socket: safe
        // point for graceful closes stashed during a dispatch.
        if self.send_scope_depth.get() == 0 {
            for id in self.session_ids() {
                if let Some(session) = self.live_session(id) {
                    session.flush_pending_graceful();
                }
            }
        }
        self.send_scope_depth.set(self.send_scope_depth.get() + 1);
        self.followup_due.set(false);
        // Not from the mid-turn drain pass: a deferred abort is dropped when
        // a later stream writes first, and node decides that over the whole
        // turn -- flushing mid-chain puts a RESET on the wire node never sends.
        if !self.defer_closes.get() {
            for id in self.session_ids() {
                if let Some(session) = self.live_session(id) {
                    session.flush_deferred_aborts();
                }
            }
        }
        bun_boringssl_sys::ERR_clear_error();
        self.with_engines(|engine| engine.process_conns());
        self.processing.set(false);
        if let Some(server_engine) = self.server_engine.get().as_ref() {
            let (sent, limited) = server_engine.sreset_stats();
            self.write_stat(IDX_STATS_STATELESS_RESET_COUNT, sent);
            self.write_stat(IDX_STATS_STATELESS_RESET_RATE_LIMITED, limited);
        }

        // Every callback below runs user JS that can synchronously destroy
        // sessions and (via close()) drop the endpoint's wrapper Strong;
        // hold one for the duration so the wrapper survives GC.
        let _keep_wrapper = bun_jsc::Strong::create(self.this_value.get().get(), global);

        loop {
            // Arrival order: both push sites append, and a burst of Initials in
            // one recvmmsg batch must announce in the order the sessions loop
            // below then walks them.
            let Some(id) = self.pending_new_sessions.with_mut(|v| {
                if v.is_empty() {
                    None
                } else {
                    Some(v.remove(0))
                }
            }) else {
                break;
            };
            let Some(session) = self.live_session(id) else {
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
        for id in self.session_ids() {
            let Some(session) = self.live_session(id) else {
                continue;
            };
            let _keep = RefPtr::from_this(session);
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
        self.send_scope_depth.set(self.send_scope_depth.get() - 1);
        // Writes made by the dispatch above could not flush inline (the scope
        // was held). Send them at the pass's outer edge, where node's
        // SendPendingDataScope flushes, not a loop turn later.
        if self.driver.take_pending() {
            self.drive_engines_once();
        }
    }

    fn engine_conn_count(&self) -> u32 {
        let mut n = 0u32;
        self.with_engines(|engine| n += engine.conn_count());
        n
    }

    /// Whether a native dispatch (on_data, process) is on the stack.
    pub(super) fn scope_held(&self) -> bool {
        self.send_scope_depth.get() != 0
    }

    fn arm_timer_ms(&self, ms: i64) {
        let next = bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, ms);
        timer_all().update(self.event_loop_timer.as_ptr(), &next);
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
        self.arm_timer_ms(1);
    }

    fn rearm_timer(&self) {
        if self.closed.get() {
            return;
        }
        let mut earliest_us: Option<i32> = None;
        self.with_engines(|engine| {
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
        if !self.pending_verneg.get().is_empty() || !self.provisional.get().is_empty() {
            ms = Some(ms.map_or(SWEEP_POLL_MS, |m| m.min(SWEEP_POLL_MS)));
        }
        if self.followup_due.get() {
            ms = Some(ms.map_or(1, |m| m.min(1)));
        }
        if let Some(ms) = ms {
            self.arm_timer_ms(ms as i64);
        }
    }

    pub(crate) fn on_timer_fire(this: ThisPtr<Self>) {
        let _keep = RefPtr::from_this(this);
        this.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        let global: &JSGlobalObject = &this.global;
        if this.pending_endpoint_close.replace(false) {
            this.deliver_endpoint_close(global, CLOSECONTEXT_CLOSE, 0);
            return;
        }
        this.process(global);
    }

    /// Node announces server sessions at Initial receipt.
    fn maybe_announce_provisional(
        &self,
        global: &JSGlobalObject,
        payload: &[u8],
        peer_stored: StoredAddr,
    ) -> JsResult<()> {
        if !self.has_engine(true) || self.state.listening.get() == 0 || self.closing.get() {
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
        if self.provisional.get().iter().any(|p| p.dcid == dcid) {
            return Ok(());
        }
        // On a dual-mode endpoint the peer's Initial *response* carries our
        // client's SCID, which only the client engine hashes -- checking the
        // server engine alone would announce a phantom server session for it.
        if self.engine_with_cid(dcid).is_some() {
            return Ok(());
        }
        let peer_decoded = peer_stored.decode();
        let (busy, max_conns) = (
            self.state.busy.get(),
            self.state.max_connections_total.get(),
        );
        // `closing`: on_new_conn refuses these at promotion, so announcing one
        // here would surface a session that can never open.
        if self.closing.get()
            || busy != 0
            || (max_conns > 0 && self.sessions.get().len() >= max_conns as usize)
        {
            return Ok(());
        }
        bun_core::scoped_log!(
            quic,
            "announce provisional dcid={:02x?} peer={:?}",
            dcid,
            peer_decoded
        );
        let endpoint_handle = self.this_value.get().get();
        let (session, _handle) =
            QuicSession::create(global, self.this_ptr(), endpoint_handle, None, true)?;
        let applied = self.apply_server_session_options(global, &session);
        let id = session.id();
        self.register_session(&session);
        drop(session);
        self.pending_new_sessions.with_mut(|v| v.push(id));
        self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
        self.provisional.with_mut(|v| {
            v.push(ProvisionalSession {
                dcid: dcid.to_vec(),
                peer: peer_stored,
                created_ns: now_ns(),
                session: id,
            })
        });
        applied
    }

    /// Queues the handshake-failure close both timeout lists deliver.
    fn expire_session(&self, session: session::Id) -> bool {
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

    fn sweep_provisional(&self) {
        let now = now_ns();
        let mut n_expired = 0usize;
        // Unbounded, like `pending_verneg` below: a fixed cap left the overflow
        // in `provisional`, where `on_new_conn` can still match it and promote
        // a session that was already past its deadline as a successful one.
        let mut expired: Vec<session::Id> = Vec::new();
        self.provisional.with_mut(|v| {
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
        self.pending_verneg.with_mut(|v| {
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
            .with_mut(|d| d.retain(|&(_, at)| now.saturating_sub(at) < PROVISIONAL_TIMEOUT_NS));
    }

    /// Returns the ref lsquic's conn context will hold.
    fn accept_conn(&self, conn: lsquic::Conn) -> Option<RefPtr<QuicSession>> {
        let global: &JSGlobalObject = &self.global;
        let endpoint_handle = self.this_value.get().get();
        let peer = conn
            .sockaddrs()
            .map(|(_, peer)| StoredAddr::from_lsquic(&peer));
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
                return Some(RefPtr::from_this(live));
            }
        }
        // A close() must stop accepting: a session promoted now keeps
        // `sessions` non-empty and the finish gate never trips. CONNECTION_
        // REFUSED (not a code-0 close) is what makes the client reject.
        if self.closing.get() {
            conn.abort_error(false, QUIC_TRANSPORT_CONNECTION_REFUSED, c"");
            return None;
        }
        let (busy, max_conns) = (
            self.state.busy.get(),
            self.state.max_connections_total.get(),
        );
        if busy != 0 || (max_conns > 0 && self.sessions.get().len() >= max_conns as usize) {
            conn.abort_error(false, QUIC_TRANSPORT_CONNECTION_REFUSED, c"");
            self.add_stat(IDX_STATS_SERVER_BUSY_COUNT, 1);
            return None;
        }
        let peer_decoded = peer.as_ref().and_then(StoredAddr::decode);
        let was_dead = peer_decoded.is_some()
            && self
                .dead_provisional_peers
                .get()
                .iter()
                .any(|(addr, _)| addr.decode() == peer_decoded);
        if was_dead {
            // One marker per destroyed provisional, so consume exactly one:
            // draining them all would treat a peer's later retries as live.
            self.dead_provisional_peers.with_mut(|d| {
                if let Some(i) = d.iter().position(|(addr, _)| addr.decode() == peer_decoded) {
                    d.swap_remove(i);
                }
            });
            // Node's dead server goes silent, and `lsquic_conn_abort` sends a
            // CONNECTION_CLOSE -- use the silent variant the sibling in
            // session.rs uses.
            conn.abort_silent();
            return None;
        }
        match QuicSession::create(global, self.this_ptr(), endpoint_handle, Some(conn), true) {
            Ok((session, _handle)) => {
                if let Err(err) = self.apply_server_session_options(global, &session) {
                    crate::dispatch::fold(Err(err));
                }
                self.register_session(&session);
                self.pending_new_sessions.with_mut(|v| v.push(session.id()));
                self.add_stat(IDX_STATS_SERVER_SESSIONS, 1);
                session.push_event(session::SessionEvent::HandshakeDone { ok: true });
                Some(session)
            }
            Err(e) => {
                // Abort like the sibling null-return branches, or the conn
                // lingers with no session behind it.
                crate::dispatch::fold(Err(e));
                conn.abort_silent();
                None
            }
        }
    }

    pub(super) fn configured_alpn(&self, is_server: bool) -> Option<Vec<u8>> {
        let alpn = if is_server {
            self.server_alpn.get()
        } else {
            self.client_alpn.get()
        };
        let bytes = alpn.strip_suffix(b"\0").unwrap_or(alpn);
        if bytes.is_empty() {
            None
        } else {
            Some(bytes.to_vec())
        }
    }

    pub(super) fn is_http(&self, is_server: bool) -> bool {
        if is_server {
            self.server_is_http.get()
        } else {
            self.client_is_http.get()
        }
    }

    pub(super) fn drive_engines_once(&self) {
        if self.processing.replace(true) {
            return;
        }
        self.send_scope_depth.set(self.send_scope_depth.get() + 1);
        bun_boringssl_sys::ERR_clear_error();
        self.with_engines(|engine| {
            engine.process_conns();
            if engine.has_unsent_packets() {
                engine.send_unsent_packets();
            }
        });
        self.send_scope_depth.set(self.send_scope_depth.get() - 1);
        self.processing.set(false);
    }

    /// Drops `session` from every list and releases the registry's ref.
    pub(super) fn unregister_session(&self, session: session::Id) {
        let removed = self.sessions.with_mut(|v| {
            v.iter()
                .position(|s| s.id() == session)
                .map(|i| v.remove(i))
        });
        self.pending_new_sessions
            .with_mut(|v| v.retain(|&s| s != session));
        self.pending_verneg
            .with_mut(|v| v.retain(|&(s, _, _)| s != session));
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
        drop(removed);
    }

    fn build_engine(
        &self,
        is_server: bool,
        config: &TlsConfig,
        options: JSValue,
        global: &JSGlobalObject,
    ) -> JsResult<lsquic::Engine<QuicEndpoint>> {
        let tls = TlsContext::new(config).map_err(|e| global.throw(format_args!("tls: {}", e)))?;
        // Node accepts a list, so own ALPN on the SSL_CTX and pass NULL here.
        let alpn_cstr = TlsContext::alpn_cstr(config);
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
        // Node always advertises datagram support.
        settings.datagrams(1);
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
        if is_server {
            self.server_local_tp.set(local_tp);
        } else {
            self.client_local_tp.set(local_tp);
        }
        lsquic::Engine::new(&NQ_VTABLE, self.this_ptr(), is_server, is_http, settings)
            .ok_or_else(|| global.throw(format_args!("failed to create QUIC engine")))
    }

    fn release_native(&self) -> bool {
        if self.closed.replace(true) {
            return false;
        }
        // Unlink first: the driver walk must never reach a closed endpoint.
        self.unlink_loop_driver();
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        // Destroying an engine closes its conns (on_conn_closed) and may
        // still send (packets_out), so the socket goes after.
        drop(self.server_engine.replace(None));
        drop(self.client_engine.replace(None));
        if let Some(socket) = self.socket.replace(None) {
            socket.close();
        }
        let removed = ENDPOINT_REGISTRY.with_borrow_mut(|v| {
            v.iter()
                .position(|e| core::ptr::eq(e.as_ptr(), self))
                .map(|i| v.remove(i))
        });
        drop(removed);
        true
    }

    /// `closed` is set FIRST: it gates `schedule_process`/`rearm_timer`, so a
    /// callback running below cannot re-arm a tick onto engines this function
    /// is about to free.
    fn teardown(&self) -> bool {
        if !self.release_native() {
            return false;
        }
        self.server_tls.set(None);
        self.client_tls.set(None);
        self.sni_contexts.with_mut(Vec::clear);
        self.server_session_options.set(None);
        self.state.closing.set(1);
        self.state.bound.set(0);
        self.state.receiving.set(0);
        self.state.listening.set(0);
        self.write_stat(IDX_STATS_DESTROYED_AT, now_ns());
        true
    }

    fn finish_close(&self) {
        if !self.teardown() {
            return;
        }
        // Defer onEndpointClose to the next turn (Node closes asynchronously).
        self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        self.pending_endpoint_close.set(true);
        self.arm_timer_ms(1);
    }

    fn apply_server_session_options(
        &self,
        global: &JSGlobalObject,
        session: &RefPtr<QuicSession>,
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

    pub(super) fn buffer_early_keylog(
        &self,
        ssl: &bun_boringssl_sys::SSL,
        peer: StoredAddr,
        line: Vec<u8>,
    ) {
        self.early_keylog
            .with_mut(|v| v.push((NonNull::from(ssl), peer, line)));
    }

    /// Without this, buffered lines outlive the freed `SSL*` and a later
    /// handshake at the recycled address claims a dead handshake's secrets.
    fn discard_early_keylog(&self, peer: &StoredAddr) {
        let peer_decoded = peer.decode();
        self.early_keylog
            .with_mut(|v| v.retain(|(_, p, _)| p.decode() != peer_decoded));
    }
    pub(super) fn take_early_keylog(&self, ssl: &bun_boringssl_sys::SSL) -> Vec<Vec<u8>> {
        let ssl = NonNull::from(ssl);
        self.early_keylog.with_mut(|v| {
            let mut out = Vec::new();
            v.retain_mut(|(s, _, line)| {
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
    }

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
        if !self.has_engine(true) {
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
            let engine = self.build_engine(true, &config, options, global)?;
            self.server_engine.set(Some(engine));
        }
        self.state.listening.set(1);
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
            return Ok(JSValue::UNDEFINED);
        }
        let [address, options, session_ticket_arg] = frame.arguments_as_array::<3>();
        let Some(addr) = address.as_class_ref::<crate::socket::SocketAddress>() else {
            return Err(global
                .err(
                    jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"address\" argument must be an instance of SocketAddress"),
                )
                .throw());
        };
        let remote = StoredAddr::from_socket_address(addr);
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
        if !self.has_engine(false) {
            let engine = self.build_engine(false, &config, options, global)?;
            self.client_engine.set(Some(engine));
        } else {
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
            // Node's TLS options are per-session, but the lsquic engine is
            // per-endpoint. Each conn's SSL holds a reference to its SSL_CTX,
            // so replacing ours is safe for earlier sessions.
            match TlsContext::new(&config) {
                Ok(fresh) => self.client_tls.set(Some(fresh)),
                Err(e) => return Err(global.throw(format_args!("{e}"))),
            }
        }
        // Node's DEFAULT_MAX_IDLE_TIMEOUT is 10 seconds when unspecified.
        let idle_ms = options
            .get(global, "transportParams")?
            .filter(|v| v.is_object())
            .map(|tp| read_u64_option(global, tp, "maxIdleTimeout"))
            .transpose()?
            .flatten()
            .map(|secs| secs.saturating_mul(MS_PER_SEC))
            .unwrap_or(DEFAULT_MAX_IDLE_TIMEOUT_SECS * MS_PER_SEC);
        self.with_engine(false, |engine| {
            engine.set_idle_timeout_ms(idle_ms.min(c_uint::MAX as u64) as c_uint)
        });
        // Keep what localTransportParams() reports in step with what this
        // connect() just put on the wire; a reused endpoint would otherwise
        // still echo the first session's value.
        self.client_local_tp
            .with_mut(|tp| tp.max_idle_timeout = idle_ms);
        // Read before the session exists: `QuicSession::create` self-roots, and
        // the conn that follows holds it as its ctx, so a throw after either
        // point has to unwind state that a plain `?` here avoids creating.
        let keepalive_us =
            read_u64_option(global, options, "keepAlive")?.map_or(0, |ms| ms.saturating_mul(1000));
        let use_preferred = read_u64_option(global, options, "preferredAddressPolicy")?
            == Some(PREFERRED_ADDRESS_USE);
        let (session, handle) =
            QuicSession::create(global, self.this_ptr(), frame.this(), None, false)?;
        // `TlsConfig::from_js` defaults servername to "localhost" (Node parity).
        let sni = config.servername_cstr();
        let local = self.local_addr.get();
        let resume_blob: Vec<u8> = if config.enable_early_data {
            session_ticket_arg
                .as_array_buffer(global)
                .map(|buf| buf.byte_slice().to_vec())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        // engine_connect fires on_new_conn synchronously; hold the scope so a
        // schedule_process from inside it cannot re-enter the engine.
        self.send_scope_depth.set(self.send_scope_depth.get() + 1);
        // lsquic copies the resume blob; the conn context holds the ref
        // handed in here.
        let connected = self.client_engine.get().as_ref().map(|engine| {
            engine.connect(
                lsquic::N_LSQVER,
                local.as_sockaddr(),
                remote.as_sockaddr(),
                session.clone(),
                sni.as_deref(),
                0,
                &resume_blob,
                // `options.token` is validated in JS but deliberately not
                // replayed: handing it to lsquic breaks the token and zero-rtt
                // tests, at the cost of the Retry RTT it would have saved.
                &[],
            )
        });
        self.send_scope_depth.set(self.send_scope_depth.get() - 1);
        let conn = match connected {
            Some(Ok(conn)) => conn,
            Some(Err(unused)) => {
                drop(unused);
                session.teardown(global);
                return Ok(JSValue::UNDEFINED);
            }
            None => {
                session.teardown(global);
                return Ok(JSValue::UNDEFINED);
            }
        };
        session.conn.set(Some(conn));
        session.cache_sockaddrs(conn);
        // `conn` is set above, so teardown clears the conn's ctx and the
        // late callbacks no-op instead of reaching an unrooted session.
        if let Err(e) = session.apply_options(global, options) {
            session.teardown(global);
            return Err(e);
        }
        if !resume_blob.is_empty() {
            session.apply_peer_datagram_budget();
        }
        // keepAlive is per-session in Node.
        conn.set_ping_period_us(keepalive_us);
        if use_preferred {
            conn.use_preferred_address(true);
        }
        self.register_session(&session);
        drop(session);
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
        let (session, handle) =
            QuicSession::create(global, self.this_ptr(), this_value, None, false)?;
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
        session.verneg.set(Some((version, min_version)));
        session.remote_addr.set(remote);
        self.pending_verneg
            .with_mut(|v| v.push((session.id(), scid, now_ns())));
        // A probe has no engine, so nothing else would ever arm the timer that
        // runs the sweep expiring it.
        self.schedule_process();
        self.register_session(&session);
        drop(session);
        self.add_stat(IDX_STATS_CLIENT_SESSIONS, 1);
        if let Some(socket) = self.socket_ptr() {
            uws::udp::Socket::opaque_mut(socket.as_ptr()).send(
                &[probe.as_ptr()],
                &[probe.len()],
                &[remote.as_sockaddr_ptr()],
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
        // Pending entries are pruned in `unregister_session`, so a matched
        // session is still registered.
        if let Some(session) = self.live_session(session) {
            session.push_event(session::SessionEvent::VersionNegotiation { server_versions });
        }
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
        self.state.closing.set(1);
        self.state.listening.set(0);
        if self.this_value.get().is_empty() {
            self.this_value
                .with_mut(|r| r.set_strong(frame.this(), _global));
        }
        if self.sessions.get().is_empty() && self.engine_conn_count() == 0 {
            self.finish_close();
        } else {
            self.schedule_process();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn release_socket(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.pending_endpoint_close.set(false);
        self.teardown();
        self.poll_ref.with_mut(|p| p.disable());
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn address(&self, global: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        Ok(self.local_addr.get().to_js_socket_address(global))
    }
    pub(crate) fn mark_busy(&self, _g: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let busy = frame.arguments_as_array::<1>()[0].to_boolean();
        self.state.busy.set(busy as u8);
        Ok(JSValue::UNDEFINED)
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

    pub(crate) fn finalize(&self) {
        self.this_value.with_mut(JsRef::finalize);
        // A deferred onEndpointClose has no wrapper left to report to.
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.release_native();
    }
}
