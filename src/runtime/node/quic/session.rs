//! `QuicSession` native handle (lsquic-backed) — Node's
//! `internalBinding('quic').Session` analog (node/src/quic/session.{h,cc}).
//!
//! Phase 2 (handshake-only): the JS-facing surface is complete so codegen and
//! the JS layer link, and the lsquic conn lifecycle (`on_new_conn` →
//! `on_hsk_done` → `on_conn_closed`) drives `onSessionHandshake` /
//! `onSessionClose`. Streams, datagrams, tokens, and the rest are stubbed
//! until later phases.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{null, null_mut};
use std::collections::VecDeque;

use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, StringJsc, Strong,
};

use crate::timer::{EventLoopTimer, EventLoopTimerTag};
use bun_lsquic_sys as lsquic;

use super::callbacks;
use super::endpoint::{MS_PER_SEC, QuicEndpoint, alloc_exposed_array_buffer};
use super::ffi::lsquic_callback;
use super::now_ns;
use super::tls;

bun_core::declare_scope!(quic_session, hidden);

/// `Session::State.listener_flags` bits the JS layer sets when the matching
/// callback is installed (`src/js/internal/quic/state.ts`).
/// DATAGRAM frame overhead: type byte + 2-byte length varint (RFC 9221 §4).
const DATAGRAM_FRAME_OVERHEAD: u64 = 3;
/// Conservative per-packet datagram payload budget: 1200-byte minimum QUIC
/// packet minus short header + AEAD tag overhead.
const DATAGRAM_PAYLOAD_BUDGET: u64 = 1150;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS certificate_required(116).
const CRYPTO_ERROR_CERTIFICATE_REQUIRED: u64 = 0x0100 + 116;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS handshake_failure(40).
const CRYPTO_ERROR_HANDSHAKE_FAILURE: u64 = 0x0100 + 40;

const LISTENER_FLAG_PATH_VALIDATION: u32 = 0x1;
const LISTENER_FLAG_DATAGRAM: u32 = 0x2;
const LISTENER_FLAG_DATAGRAM_STATUS: u32 = 0x4;
const LISTENER_FLAG_SESSION_TICKET: u32 = 0x8;
const LISTENER_FLAG_NEW_TOKEN: u32 = 0x10;
const LISTENER_FLAG_ORIGIN: u32 = 0x20;

/// RFC 9412 sec 2: each Origin-Entry is a 16-bit length prefix followed by
/// the ASCII origin.
const ORIGIN_LEN_PREFIX: usize = 2;

/// Stream-id bit 1 selects the direction: 0 = bidirectional,
/// 1 = unidirectional (RFC 9000 §2.1).
const STREAM_ID_UNI_BIT: u64 = 0x2;

/// HTTP/3 application error codes (RFC 9114 §8.1): H3_NO_ERROR and
/// H3_INTERNAL_ERROR, surfaced as `state.no_error_code` /
/// `state.internal_error_code` when the session negotiates h3.
const H3_NO_ERROR: u64 = 0x100;
const H3_INTERNAL_ERROR: u64 = 0x102;

/// Node's DefaultApplication normalized option defaults
/// (node/src/quic/session.cc).
const DEFAULT_MAX_HEADER_PAIRS: u64 = 128;
const DEFAULT_MAX_HEADER_LENGTH: u64 = 16384;

/// `lsquic_conn_status` error-description scratch size (matches lsquic's
/// own errbuf sizing in test tools).
const CONN_STATUS_ERRBUF_LEN: usize = 256;

/// Spacing between the first and subsequent session-ticket callbacks (see
/// `pending_tickets`): long enough for a JS `close()` issued on receipt of
/// the first ticket to win even on slow debug builds. A session that opens
/// a stream (i.e. keeps working) receives held tickets immediately.
const TICKET_DELIVERY_DELAY_NS: u64 = 500_000_000;

/// Indices into the session stats buffer — must match
/// [`SESSION_STATS_FIELDS`] positions exactly (the JS layer reads the
/// buffer through the same table).
const IDX_STATS_SESSION_CREATED_AT: usize = 0;
const IDX_STATS_SESSION_DESTROYED_AT: usize = 2;
const IDX_STATS_SESSION_HANDSHAKE_COMPLETED_AT: usize = 3;
const IDX_STATS_SESSION_HANDSHAKE_CONFIRMED_AT: usize = 4;
const IDX_STATS_SESSION_BYTES_RECEIVED: usize = 6;
const IDX_STATS_SESSION_BYTES_SENT: usize = 7;
const IDX_STATS_SESSION_BIDI_IN_STREAM_COUNT: usize = 8;
const IDX_STATS_SESSION_BIDI_OUT_STREAM_COUNT: usize = 9;
const IDX_STATS_SESSION_UNI_IN_STREAM_COUNT: usize = 10;
const IDX_STATS_SESSION_UNI_OUT_STREAM_COUNT: usize = 11;
const IDX_STATS_SESSION_LOSS_RETRANSMIT_COUNT: usize = 13;
const IDX_STATS_SESSION_CWND: usize = 17;
const IDX_STATS_SESSION_LATEST_RTT: usize = 18;
const IDX_STATS_SESSION_MIN_RTT: usize = 19;
const IDX_STATS_SESSION_RTTVAR: usize = 20;
const IDX_STATS_SESSION_SMOOTHED_RTT: usize = 21;
const IDX_STATS_SESSION_DATAGRAMS_RECEIVED: usize = 23;
const IDX_STATS_SESSION_DATAGRAMS_SENT: usize = 24;
const IDX_STATS_SESSION_DATAGRAMS_ACKNOWLEDGED: usize = 25;
const IDX_STATS_SESSION_DATAGRAMS_LOST: usize = 26;
const IDX_STATS_SESSION_PKT_SENT: usize = 28;
const IDX_STATS_SESSION_PKT_RECV: usize = 29;
const IDX_STATS_SESSION_PKT_LOST: usize = 30;
const IDX_STATS_SESSION_BYTES_RECV: usize = 31;
// Wired by the in-flight keepalive work (lsquic_conn_pings_received).
const IDX_STATS_SESSION_PING_RECV: usize = 33;

/// `sizeof(struct sockaddr_in)` / `sizeof(struct sockaddr_in6)` — the
/// StoredAddr backing size and the family-dependent valid prefix.
pub(super) const SOCKADDR_IN_LEN: usize = 16;
pub(super) const SOCKADDR_IN6_LEN: usize = 28;

/// A copied sockaddr — the bytes are an in-place `sockaddr_in[6]` so the same
/// pointer works for both lsquic (`struct sockaddr*`) and the uSockets UDP
/// send. Both read `sockaddr_in6`'s 2- and 4-byte fields through that pointer,
/// so the buffer must carry sockaddr alignment, not `[u8; N]`'s align-1.
#[repr(C, align(8))]
#[derive(Copy, Clone)]
pub struct StoredAddr {
    bytes: [u8; SOCKADDR_IN6_LEN],
    len: u8,
}

impl Default for StoredAddr {
    fn default() -> Self {
        Self {
            bytes: [0; SOCKADDR_IN6_LEN],
            len: 0,
        }
    }
}

impl StoredAddr {
    pub(super) fn from_raw(ptr: *const u8, len: usize) -> Self {
        let mut out = Self::default();
        let n = len.min(out.bytes.len());
        if !ptr.is_null() && n > 0 {
            // SAFETY: caller guarantees `ptr[..len]` is a live sockaddr.
            unsafe { core::ptr::copy_nonoverlapping(ptr, out.bytes.as_mut_ptr(), n) };
            out.len = n as u8;
        }
        out
    }
    pub(super) fn from_socket_address(addr: &crate::socket::SocketAddress) -> Self {
        Self::from_raw(
            core::ptr::from_ref(&addr._addr).cast::<u8>(),
            addr.socklen() as usize,
        )
    }
    pub(super) fn as_ptr(&self) -> *const u8 {
        self.bytes.as_ptr()
    }
    pub(super) fn is_set(&self) -> bool {
        self.len > 0
    }
    /// Returns `(family, port, ip-bytes)` when this is a recognized AF.
    pub(super) fn decode(&self) -> Option<(u16, u16, &[u8])> {
        use crate::socket::socket_address::inet;
        if self.len == 0 {
            return None;
        }
        // Platform-aware family read: BSD-style sockaddr stores `sa_len` in
        // byte 0 and `sa_family` (u8) in byte 1; Linux/Windows store
        // `sa_family` as a u16 at byte 0.
        #[cfg(any(target_os = "macos", target_os = "freebsd", target_os = "ios"))]
        let family = self.bytes[1] as u16;
        #[cfg(not(any(target_os = "macos", target_os = "freebsd", target_os = "ios")))]
        let family = u16::from_ne_bytes([self.bytes[0], self.bytes[1]]);
        let port = u16::from_be_bytes([self.bytes[2], self.bytes[3]]);
        if family == inet::AF_INET as u16 && self.len as usize >= SOCKADDR_IN_LEN {
            Some((family, port, &self.bytes[4..8]))
        } else if family == inet::AF_INET6 as u16 && self.len as usize >= SOCKADDR_IN6_LEN {
            Some((family, port, &self.bytes[8..24]))
        } else {
            None
        }
    }
    pub(super) fn to_js_socket_address(&self, global: &JSGlobalObject) -> JSValue {
        use crate::socket::SocketAddress;
        use crate::socket::socket_address::inet;
        let Some((family, port, addr)) = self.decode() else {
            return JSValue::UNDEFINED;
        };
        let socket_address = if family == inet::AF_INET as u16 {
            SocketAddress::init_ipv4([addr[0], addr[1], addr[2], addr[3]], port)
        } else {
            let mut ip = [0u8; 16];
            ip.copy_from_slice(addr);
            SocketAddress::init_ipv6(ip, port, 0, 0)
        };
        crate::generated_classes::js_SocketAddress::to_js(
            bun_core::heap::into_raw(Box::new(socket_address)),
            global,
        )
    }
}

/// Mirrors Node's `Session::State` (`SESSION_STATE` in session.cc). The
/// `IDX_STATE_SESSION_*` constants on the binding are `offset_of!` values
/// into this struct, so the layout must stay in sync with what the JS layer
/// reads (`src/js/internal/quic/state.ts`).
#[repr(C)]
pub struct SessionState {
    pub listener_flags: u32,
    pub closing: u8,
    pub graceful_close: u8,
    pub silent_close: u8,
    pub stateless_reset: u8,
    pub handshake_completed: u8,
    pub handshake_confirmed: u8,
    pub stream_open_allowed: u8,
    pub priority_supported: u8,
    pub headers_supported: u8,
    pub wrapped: u8,
    pub application_type: u8,
    pub no_error_code: u64,
    pub internal_error_code: u64,
    pub max_datagram_size: u16,
    pub last_datagram_id: u64,
    pub max_pending_datagrams: u16,
}

/// Node's `SESSION_STATS` field names, in declaration order.
pub(crate) const SESSION_STATS_FIELDS: &[&str] = &[
    "CREATED_AT",
    "CLOSING_AT",
    "DESTROYED_AT",
    "HANDSHAKE_COMPLETED_AT",
    "HANDSHAKE_CONFIRMED_AT",
    "GRACEFUL_CLOSING_AT",
    "BYTES_RECEIVED",
    "BYTES_SENT",
    "BIDI_IN_STREAM_COUNT",
    "BIDI_OUT_STREAM_COUNT",
    "UNI_IN_STREAM_COUNT",
    "UNI_OUT_STREAM_COUNT",
    "KEY_UPDATE_COUNT",
    "LOSS_RETRANSMIT_COUNT",
    "MAX_BYTES_IN_FLIGHT",
    "BYTES_IN_FLIGHT",
    "BLOCK_COUNT",
    "CWND",
    "LATEST_RTT",
    "MIN_RTT",
    "RTTVAR",
    "SMOOTHED_RTT",
    "SSTHRESH",
    "DATAGRAMS_RECEIVED",
    "DATAGRAMS_SENT",
    "DATAGRAMS_ACKNOWLEDGED",
    "DATAGRAMS_LOST",
    "STREAMS_IDLE_TIMED_OUT",
    "PKT_SENT",
    "PKT_RECV",
    "PKT_LOST",
    "BYTES_RECV",
    "BYTES_LOST",
    "PING_RECV",
    "PKT_DISCARDED",
];

/// TLS handshake facts snapshotted while the SSL object is still alive
/// (lsquic frees it at handshake confirmation).
pub(super) struct HskSnapshot {
    sni: Option<Vec<u8>>,
    cipher: Option<Vec<u8>>,
    alpn: Option<Vec<u8>>,
    validation: Option<&'static str>,
    /// Peer leaf certificate (DER) — `getPeerCertificate` serves this once
    /// the live SSL is gone.
    peer_cert_der: Option<Vec<u8>>,
    /// Our own leaf certificate (DER) — `certificate` serves this once the
    /// live SSL is gone.
    local_cert_der: Option<Vec<u8>>,
    /// `(type, name, bits)` for `getEphemeralKeyInfo`.
    ephemeral: Option<(&'static str, Option<&'static str>, u32)>,
    /// `(early_data_attempted, early_data_accepted)` (RFC 8446 §2.3).
    early_data: (bool, bool),
}

/// Queued events that lsquic callbacks push (never call JS from inside an
/// lsquic callback — it can re-enter `process_conns`). Dispatched after
/// `lsquic_engine_process_conns` returns.
/// A wire abort (RESET_STREAM / STOP_SENDING) deferred to the next process
/// tick for a stream destroyed before anything reached lsquic.
pub(super) struct DeferredAbort {
    /// The raw lsquic stream — alive until the conn dies (entries are
    /// cleared first) and only ever passed back to lsquic, never
    /// dereferenced here.
    ls: *mut lsquic::lsquic_stream,
    reset: Option<u64>,
    stop: Option<u64>,
    /// `write_marker` at defer time.
    marker: u64,
}

pub(super) enum SessionEvent {
    HandshakeDone {
        ok: bool,
    },
    PeerClose {
        app_error: bool,
        code: u64,
        reason: Vec<u8>,
    },
    Closed,
    /// A locally-pending stream bound to its lsquic id, or a remote stream
    /// was created. `remote=true` fires `onStreamCreated`.
    StreamReady {
        stream: *mut super::stream::QuicStream,
        remote: bool,
    },
    /// New inbound data or FIN/reset for the JS reader; fire its wakeup.
    StreamWake {
        stream: *mut super::stream::QuicStream,
    },
    /// Outbound drained below the high-water mark; fire `onStreamDrain`.
    StreamDrain {
        stream: *mut super::stream::QuicStream,
    },
    /// Writes stalled on flow control; fire `onStreamBlocked` once per
    /// episode.
    StreamBlocked {
        stream: *mut super::stream::QuicStream,
    },
    /// Peer reset our readable side (RST_STREAM); fire `onStreamReset`.
    StreamReset {
        stream: *mut super::stream::QuicStream,
        code: u64,
    },
    /// Peer sent STOP_SENDING; the `writeEnded` flip is applied here (at
    /// dispatch) so a same-batch announce still sees a live writer.
    StreamStopSending {
        stream: *mut super::stream::QuicStream,
        code: u64,
    },
    /// Body drained on a stream that requested trailers; fire
    /// `onStreamTrailers` so JS can `sendTrailers()`.
    StreamWantsTrailers {
        stream: *mut super::stream::QuicStream,
    },
    /// HTTP/3 only: a complete header block (initial / informational /
    /// trailing) was decoded for `stream`; fire `onStreamHeaders`.
    StreamHeaders {
        stream: *mut super::stream::QuicStream,
        /// Flat `[name, value, name, value, ...]` raw octets for `parseHeaderPairs`.
        pairs: Vec<Vec<u8>>,
        /// `QUIC_STREAM_HEADERS_KIND_*`.
        kind: u32,
    },
    /// Server sent a NEW_TOKEN; fire `onSessionNewToken`.
    NewToken(Vec<u8>),
    /// One NSS key log line; fire `onSessionKeyLog`.
    Keylog(Vec<u8>),
    /// lsquic has serialized session-resume info (TLS ticket + transport
    /// params); fire `onSessionTicket`.
    SessionResume(Vec<u8>),
    /// lsquic's `on_close` for the stream; fire `onStreamClose`.
    StreamClosed {
        stream: *mut super::stream::QuicStream,
    },
    /// Client handshake confirmed (HANDSHAKE_DONE received).
    HandshakeConfirmed,
    /// Peer sent GOAWAY (HTTP/3 only); fire `onSessionGoaway`.
    GoawayReceived,
    /// A DATAGRAM frame from the peer.
    Datagram {
        payload: Vec<u8>,
        early: bool,
    },
    /// A queued datagram was handed to lsquic (`status: "sent"`); lsquic does
    /// not surface ack/loss per datagram.
    /// A queued datagram was handed to lsquic (`sent`) or could not fit the
    /// packet budget (`!sent` — reported as "abandoned").
    DatagramStatus {
        id: u64,
        sent: bool,
    },
    /// A packet carrying `count` DATAGRAM frames was acknowledged or lost
    /// (from `lsquic_send_ctl`; correlated FIFO with the sent order).
    DatagramAckStatus {
        count: u32,
        acked: bool,
    },
    /// The server rejected our early data: every 0-RTT stream is cancelled
    /// with an application error before its close event dispatches.
    EarlyDataFailed,
    /// A complete HTTP/3 ORIGIN frame payload (RFC 9412) arrived; fire
    /// `onSessionOrigin`.
    Origin(Vec<u8>),
    /// The server answered our unsupported-version probe with a Version
    /// Negotiation packet (RFC 8999 sec 6); fire
    /// `onSessionVersionNegotiation`.
    VersionNegotiation {
        server_versions: Vec<u32>,
    },
    /// The connection switched to a new network path; fire
    /// `onSessionPathValidation`.
    PathValidation {
        validated: bool,
        /// Client migrated to the server's preferred address.
        preferred: bool,
        new_local: StoredAddr,
        new_remote: StoredAddr,
        old_local: StoredAddr,
        old_remote: StoredAddr,
    },
}

/// `#[repr(C)]` so `vtable` is at offset 0 — the C shim reads it via
/// `*(us_nq_vtable**)conn_ctx`. Without it Rust may reorder fields.
#[repr(C)]
pub struct QuicSession {
    /// MUST stay the first field — the C shim's thunks recover the vtable via
    /// `*(us_nq_vtable**)conn_ctx`.
    vtable: *const lsquic::NqVtable,
    /// The lsquic connection this wraps; null after close.
    pub(super) conn: Cell<*mut lsquic::lsquic_conn>,
    /// The owning endpoint (raw pointer; the JS-side Strong keeps it alive).
    endpoint: Cell<*mut QuicEndpoint>,
    endpoint_js: JsCell<Option<Strong>>,
    is_server: Cell<bool>,
    local_addr: Cell<StoredAddr>,
    pub(super) remote_addr: Cell<StoredAddr>,
    /// Borrowed views into JSC-owned ArrayBuffers (see endpoint.rs `state`).
    state: Cell<*mut SessionState>,
    stats: Cell<*mut u64>,
    /// Events queued by lsquic callbacks for dispatch after `process_conns`.
    events: JsCell<Vec<SessionEvent>>,
    /// Partial HTTP/3 ORIGIN frame payload accumulated across `on_origin`
    /// chunks until the final one arrives.
    origin_buf: JsCell<Vec<u8>>,
    /// Wire aborts for streams destroyed before anything reached lsquic,
    /// deferred to the next process tick (Node parity: the reset of a
    /// same-turn-abandoned stream flushes at end of turn — or not at all if
    /// other stream data was written first). Entries hold the raw lsquic
    /// stream (its `QuicStream` ctx is already gone) and are cleared when
    /// the conn dies.
    deferred_aborts: JsCell<Vec<DeferredAbort>>,
    /// Bumped whenever any stream on this session enqueues outbound data;
    /// deferred aborts recorded under an older value are dropped silently.
    write_marker: Cell<u64>,
    /// `(requested_version, min_version)` when this session is a
    /// version-negotiation probe (connect with an unsupported `version`
    /// option): no lsquic conn exists; the endpoint answers the server's
    /// Version Negotiation packet by firing `onSessionVersionNegotiation`.
    pub(super) verneg: Cell<Option<(u32, u32)>>,
    /// The CONNECTION_CLOSE the peer sent, if any (stored on receipt; reported
    /// when `on_conn_closed` fires).
    peer_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    /// What `gracefulClose(options)` sent, echoed by `onSessionClose`.
    self_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    /// `options.datagramDropPolicy === 'drop-newest'` (default drop-oldest).
    datagram_drop_newest: Cell<bool>,
    /// `options.qlog`: emit synthesized JSON-SEQ qlog chunks via
    /// `onSessionQlog` (header at handshake, fin record at close).
    qlog_enabled: Cell<bool>,
    qlog_fin_sent: Cell<bool>,
    /// Outgoing datagram payloads waiting for lsquic's `on_dg_write`.
    datagram_queue: JsCell<VecDeque<(u64, Vec<u8>)>>,
    /// Monotonic id assigned by `sendDatagram` (Node returns it as a BigInt).
    next_datagram_id: Cell<u64>,
    /// Ids of datagrams handed to lsquic, awaiting the peer's ACK. FIFO —
    /// the ack/loss notifications from `lsquic_send_ctl` carry only frame
    /// counts, so ids are correlated in sent order.
    inflight_datagrams: JsCell<VecDeque<u64>>,
    /// The first session ticket has been delivered to JS. BoringSSL bundles
    /// both of the server's NewSessionTickets into the handshake flight, so
    /// without spacing they would both surface in one batch; Node's timing
    /// (OpenSSL post-handshake tickets) lets an immediate `close()` observe
    /// exactly one. Tickets after the first are held in `pending_tickets`.
    ticket_delivered: Cell<bool>,
    /// `(deliver_at_ns, ticket)` for tickets after the first; dropped if the
    /// session starts closing before the delivery time.
    pending_tickets: JsCell<VecDeque<(u64, Vec<u8>)>>,
    /// HTTP/3 graceful shutdown: GOAWAY sent, CONNECTION_CLOSE deferred
    /// until every stream closes (not merely delivers).
    close_after_streams: Cell<bool>,
    /// `lsquic_conn_status` captured in `on_conn_closed` while the conn was
    /// still live (it is freed right after that callback, before the Closed
    /// event dispatches).
    final_conn_status: JsCell<Option<(c_int, Vec<u8>)>>,
    /// Locally-initiated streams that `openStream` queued before lsquic's
    /// `on_new_stream` bound them, in FIFO order.
    pending_local_streams: JsCell<VecDeque<*mut super::stream::QuicStream>>,
    /// All bound streams, for event dispatch and teardown.
    streams: JsCell<Vec<*mut super::stream::QuicStream>>,
    handshake_reported: Cell<bool>,
    /// Client-only: the HandshakeDone event has been requeued once (see
    /// `process_events`).
    /// One NEW_TOKEN forwarded per session (lsquic emits several).
    new_token_reported: Cell<bool>,
    /// `close()` arrived before the provisional session's conn bound; close
    /// the conn as soon as it does.
    close_when_bound: Cell<bool>,
    /// Graceful close deferred until every local stream's outbound is
    /// delivered (lsquic_conn_close resets streams with unacked FINs).
    /// `(app_error, code, NUL-terminated reason)`.
    deferred_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    /// Local handshake completed; the report (which settles `opened`) is
    /// deferred until confirmation — HANDSHAKE_DONE received (client) or
    /// acked (server).
    handshake_pending_ok: Cell<bool>,
    /// TLS facts captured at handshake COMPLETION (lsquic frees the SSL
    /// object at confirmation, so a deferred report can't query it live).
    hsk_snapshot: JsCell<Option<HskSnapshot>>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
    /// Processed `application` options reflected back by `applicationOptions`.
    application_options_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    /// Unused with lsquic (the endpoint's timer drives `process_conns`); kept
    /// so the existing `EventLoopTimerTag::QuicSession` dispatch arm in
    /// `dispatch.rs` and the `impl_timer_owner!` field-offset macro stay
    /// satisfied. Never armed.
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    global: Cell<*const JSGlobalObject>,
}

bun_event_loop::impl_timer_owner!(QuicSession; from_timer_ptr => event_loop_timer);

impl QuicSession {
    fn new(global: &JSGlobalObject, vtable: *const lsquic::NqVtable) -> Self {
        Self {
            vtable,
            conn: Cell::new(null_mut()),
            endpoint: Cell::new(null_mut()),
            endpoint_js: JsCell::new(None),
            is_server: Cell::new(false),
            local_addr: Cell::new(StoredAddr::default()),
            remote_addr: Cell::new(StoredAddr::default()),
            state: Cell::new(null_mut()),
            stats: Cell::new(null_mut()),
            events: JsCell::new(Vec::new()),
            origin_buf: JsCell::new(Vec::new()),
            deferred_aborts: JsCell::new(Vec::new()),
            write_marker: Cell::new(0),
            verneg: Cell::new(None),
            peer_close: JsCell::new(None),
            self_close: JsCell::new(None),
            datagram_drop_newest: Cell::new(false),
            qlog_enabled: Cell::new(false),
            qlog_fin_sent: Cell::new(false),
            datagram_queue: JsCell::new(VecDeque::new()),
            next_datagram_id: Cell::new(1),
            inflight_datagrams: JsCell::new(VecDeque::new()),
            ticket_delivered: Cell::new(false),
            pending_tickets: JsCell::new(VecDeque::new()),
            close_after_streams: Cell::new(false),
            final_conn_status: JsCell::new(None),
            pending_local_streams: JsCell::new(VecDeque::new()),
            streams: JsCell::new(Vec::new()),
            handshake_reported: Cell::new(false),
            new_token_reported: Cell::new(false),
            close_when_bound: Cell::new(false),
            deferred_close: JsCell::new(None),
            handshake_pending_ok: Cell::new(false),
            hsk_snapshot: JsCell::new(None),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
            application_options_js: JsCell::new(None),
            this_value: JsCell::new(JsRef::empty()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::QuicSession,
            )),
            global: Cell::new(core::ptr::from_ref(global)),
        }
    }

    /// Timer-fire dispatch target (never armed under lsquic; see field docs).
    pub(crate) fn on_timer_fire(_this: *mut Self) {}

    /// Create a session and its JS wrapper. Called from `on_new_conn` (server)
    /// and from `endpoint.connect()` (client, after `lsquic_engine_connect`).
    pub(super) fn create(
        global: &JSGlobalObject,
        vtable: *const lsquic::NqVtable,
        endpoint: *mut QuicEndpoint,
        endpoint_handle: JSValue,
        conn: *mut lsquic::lsquic_conn,
        is_server: bool,
    ) -> JsResult<(*mut QuicSession, JSValue)> {
        let raw = bun_core::heap::into_raw(Box::new(Self::new(global, vtable)));
        let handle = crate::generated_classes::js_QuicSession::to_js(raw, global);

        let state_ptr = alloc_exposed_array_buffer(
            global,
            handle,
            b"state",
            core::mem::size_of::<SessionState>(),
        )?;
        let stats_ptr = alloc_exposed_array_buffer(
            global,
            handle,
            b"stats",
            SESSION_STATS_FIELDS.len() * core::mem::size_of::<u64>(),
        )?;
        handle.put(global, b"stateByteOffset", JSValue::js_number(0.0));
        handle.put(global, b"statsByteOffset", JSValue::js_number(0.0));

        // SAFETY: `raw` was just created and is uniquely owned by the wrapper.
        let this = unsafe { &*raw };
        #[expect(
            clippy::cast_ptr_alignment,
            reason = "`state_ptr` is the base of a fresh JSC ArrayBuffer (byteOffset 0); JSC allocates its backing store through Gigacage/fastMalloc, which is at least 16-byte aligned"
        )]
        this.state.set(state_ptr.cast::<SessionState>());
        this.with_state(|s| {
            // The DefaultApplication's error codes (raw QUIC; HTTP/3 sets
            // 0/0x100). The JS layer derives the destroy/reset code from
            // `internalErrorCode` for non-QuicError throws.
            s.no_error_code = 0;
            s.internal_error_code = 1;
            s.stream_open_allowed = 1;
            // 0 = "unknown" until ALPN settles: pre-handshake pending
            // streams may sendHeaders (h3-pending-stream); the non-h3 path
            // sets 2 ("no") in `maybe_report_handshake`.
            s.headers_supported = 0;
        });
        #[expect(
            clippy::cast_ptr_alignment,
            reason = "`stats_ptr` is the base of a fresh JSC ArrayBuffer (byteOffset 0), 16-byte aligned as above"
        )]
        this.stats.set(stats_ptr.cast::<u64>());
        this.conn.set(conn);
        this.endpoint.set(endpoint);
        this.endpoint_js
            .set(Some(Strong::create(endpoint_handle, global)));
        this.is_server.set(is_server);
        this.this_value.with_mut(|r| r.set_strong(handle, global));
        this.write_stat(IDX_STATS_SESSION_CREATED_AT, now_ns());
        let _ = this.vtable;
        // Cache the path now — lsquic owns the sockaddr storage and frees it
        // with the conn, so the JS getters need a copy.
        if !conn.is_null() {
            this.cache_sockaddrs(conn);
        }
        Ok((raw, handle))
    }

    /// Copy lsquic's sockaddr storage so the JS getters can read it after the
    /// conn is freed. Called from `create()` (server) and from
    /// `connect()` once `lsquic_engine_connect` returns a conn (client
    /// sessions are created with `conn = null`).
    /// Bind a promoted lsquic conn to a provisional server session
    /// (announced at Initial receipt with `conn = null`).
    pub(super) fn bind_conn(&self, conn: *mut lsquic::lsquic_conn) {
        self.conn.set(conn);
        // SAFETY: `conn` is the live conn lsquic just promoted; `self` is
        // the heap-allocated session (conn-ctx contract).
        unsafe { lsquic::lsquic_conn_set_ctx(conn, core::ptr::from_ref(self).cast_mut().cast()) };
        // Handshake keylog lines fired during the mini-conn phase were
        // buffered on the endpoint (no conn-ctx yet) — claim them now.
        // SAFETY: `conn` is the live conn lsquic just promoted.
        let promoted = unsafe { lsquic::Conn::from_raw(conn) };
        if let (Some(ep), Some(c)) = (self.endpoint_ref(), promoted) {
            for line in ep.take_early_keylog(c.ssl()) {
                self.push_event(SessionEvent::Keylog(line));
            }
        }
        self.cache_sockaddrs(conn);
        // JS asked to close while the handshake was still in flight.
        if self.close_when_bound.get() {
            if let Some(c) = self.conn() {
                c.close();
            }
        }
    }

    pub(super) fn cache_sockaddrs(&self, conn: *mut lsquic::lsquic_conn) {
        let mut local: *const c_void = null();
        let mut peer: *const c_void = null();
        // SAFETY: `conn` is live; out-params point at stack slots.
        if unsafe {
            lsquic::lsquic_conn_get_sockaddr(
                conn,
                core::ptr::from_mut(&mut local),
                core::ptr::from_mut(&mut peer),
            )
        } == 0
        {
            self.local_addr
                .set(StoredAddr::from_raw(local.cast(), SOCKADDR_IN6_LEN));
            self.remote_addr
                .set(StoredAddr::from_raw(peer.cast(), SOCKADDR_IN6_LEN));
        }
    }

    fn state_mut(&self) -> *mut SessionState {
        self.state.get()
    }
    /// Run `f` against the shared state buffer. The buffer is a JSC
    /// ArrayBuffer owned by the JS wrapper: it is allocated in `create()`
    /// before any other method can run, outlives `self` (the wrapper keeps
    /// both alive), and is only touched from the JS thread — so the single
    /// raw access below is in-bounds and unaliased.
    pub(super) fn with_state<R>(&self, f: impl FnOnce(&mut SessionState) -> R) -> R {
        // SAFETY: see doc comment.
        unsafe { f(&mut *self.state_mut()) }
    }
    fn has_listener(&self, flag: u32) -> bool {
        self.with_state(|s| s.listener_flags & flag != 0)
    }
    fn add_stat(&self, idx: usize, delta: u64) {
        let stats = self.stats.get();
        if !stats.is_null() && idx < SESSION_STATS_FIELDS.len() {
            // SAFETY: as in write_stat.
            unsafe {
                stats
                    .add(idx)
                    .write_unaligned(stats.add(idx).read_unaligned().wrapping_add(delta))
            };
        }
    }
    fn write_stat(&self, idx: usize, value: u64) {
        let stats = self.stats.get();
        if !stats.is_null() && idx < SESSION_STATS_FIELDS.len() {
            // SAFETY: `stats` is a live `[u64; N]` view into a JSC-owned buffer.
            unsafe { *stats.add(idx) = value };
        }
    }
    pub(super) fn handle(&self) -> JSValue {
        self.this_value.get().get()
    }
    /// Read per-session options that aren't transport params or TLS.
    pub(super) fn apply_options(&self, global: &JSGlobalObject, options: JSValue) -> JsResult<()> {
        if !options.is_object() {
            return Ok(());
        }
        if let Some(v) = options
            .get(global, "datagramDropPolicy")?
            .filter(|v| v.is_string())
        {
            self.datagram_drop_newest
                .set(bun_core::String::from_js(v, global)?.to_utf8_bytes() == b"drop-newest");
        }
        if let Some(v) = options.get(global, "qlog")? {
            self.qlog_enabled.set(v.to_boolean());
        }
        if let Some(app) = options
            .get(global, "application")?
            .filter(|v| v.is_object())
        {
            self.application_options_js
                .set(Some(Strong::create(app, global)));
        }
        Ok(())
    }
    pub(super) fn is_server(&self) -> bool {
        self.is_server.get()
    }
    pub(super) fn push_event(&self, event: SessionEvent) {
        self.events.with_mut(|e| e.push(event));
    }
    /// Ask the endpoint to drive `process_conns` on the next turn.
    /// The owning endpoint, if still attached. The `endpoint_js` Strong
    /// keeps it alive while this session holds the back-pointer; teardown
    /// nulls the pointer before that Strong is dropped, so a non-null
    /// pointer is always dereferenceable on the JS thread.
    fn endpoint_ref(&self) -> Option<&super::endpoint::QuicEndpoint> {
        let p = self.endpoint.get();
        // SAFETY: see doc comment.
        (!p.is_null()).then(|| unsafe { &*p })
    }
    pub(super) fn schedule_process(&self) {
        if let Some(ep) = self.endpoint_ref() {
            ep.schedule_process();
        }
    }
    /// Another stream on this session enqueued outbound data — deferred
    /// aborts recorded before this call are dropped at flush time.
    pub(super) fn note_stream_write(&self) {
        self.write_marker
            .set(self.write_marker.get().wrapping_add(1));
    }
    /// Record (or extend) a deferred wire abort for a stream that never
    /// reached lsquic; applied by `flush_deferred_aborts`.
    pub(super) fn defer_stream_abort(
        &self,
        ls: *mut lsquic::lsquic_stream,
        reset: Option<u64>,
        stop: Option<u64>,
    ) {
        let marker = self.write_marker.get();
        self.deferred_aborts.with_mut(|v| {
            if let Some(e) = v.iter_mut().find(|e| e.ls == ls) {
                e.reset = e.reset.or(reset);
                e.stop = e.stop.or(stop);
            } else {
                v.push(DeferredAbort {
                    ls,
                    reset,
                    stop,
                    marker,
                });
            }
        });
    }
    pub(super) fn has_deferred_abort(&self, ls: *mut lsquic::lsquic_stream) -> bool {
        self.deferred_aborts.get().iter().any(|e| e.ls == ls)
    }
    /// Apply (or drop) deferred stream aborts. Runs at the start of the
    /// endpoint's process tick, before `process_conns` puts the frames on
    /// the wire.
    pub(super) fn flush_deferred_aborts(&self) {
        if self.deferred_aborts.get().is_empty() {
            return;
        }
        let entries = self.deferred_aborts.with_mut(core::mem::take);
        if self.conn.get().is_null() {
            return;
        }
        let marker = self.write_marker.get();
        for e in entries {
            // SAFETY: entries are cleared before the conn (and thus its
            // streams) is freed, so `ls` is a live lsquic stream.
            let Some(s) = (unsafe { lsquic::Stream::from_raw(e.ls) }) else {
                continue;
            };
            if e.marker != marker {
                // Other stream data was written since the destroy: the
                // peer must never learn of the abandoned stream (Node
                // parity — the queued frames are dropped).
                s.shutdown_internal();
                continue;
            }
            if let Some(code) = e.stop {
                s.stop_sending(code);
            }
            if let Some(code) = e.reset {
                s.reset(code);
            } else {
                s.close();
            }
        }
    }
    /// Next locally-initiated stream waiting for lsquic to bind it (FIFO).
    pub(super) fn take_pending_local_stream(&self) -> Option<*mut super::stream::QuicStream> {
        // Skip tombstones: a destroyed pending stream keeps its FIFO slot
        // (its `lsquic_conn_make_stream` request was already issued) but its
        // fulfillment is discarded.
        // Exactly one slot per lsquic fulfillment: a tombstone is consumed and
        // reported as None (the caller shuts the lsquic stream internally)
        // rather than skipped, or the FIFO would drift out of order.
        match self.pending_local_streams.with_mut(VecDeque::pop_front) {
            Some(p) if !p.is_null() && self.streams.get().contains(&p) => Some(p),
            _ => None,
        }
    }
    /// Remove `stream` from the live set (called from QuicStream::teardown
    /// before its wrapper Strong is dropped). Pending entries become
    /// tombstones so the `make_stream` FIFO stays aligned with lsquic's
    /// fulfillment order.
    pub(super) fn remove_stream(&self, stream: *mut super::stream::QuicStream) {
        self.streams.with_mut(|v| v.retain(|&s| s != stream));
    }
    /// `on_new_stream` for a remote-initiated stream: create a QuicStream and
    /// queue it for `onStreamCreated`. Returns the stream-ctx for lsquic.
    fn bump_stream_stat(&self, id: u64, local: bool) {
        let idx = match (id & STREAM_ID_UNI_BIT != 0, local) {
            (false, false) => IDX_STATS_SESSION_BIDI_IN_STREAM_COUNT,
            (false, true) => IDX_STATS_SESSION_BIDI_OUT_STREAM_COUNT,
            (true, false) => IDX_STATS_SESSION_UNI_IN_STREAM_COUNT,
            (true, true) => IDX_STATS_SESSION_UNI_OUT_STREAM_COUNT,
        };
        let stats = self.stats.get();
        if !stats.is_null() {
            // SAFETY: stats is a live `[u64; N]` view; ArrayBuffer storage
            // only guarantees byte alignment.
            unsafe {
                stats
                    .add(idx)
                    .write_unaligned(stats.add(idx).read_unaligned().wrapping_add(1))
            };
        }
    }

    pub(super) fn on_remote_stream(
        &self,
        raw: *mut lsquic::lsquic_stream,
    ) -> *mut super::stream::QuicStream {
        let global_ptr = self.global.get();
        if global_ptr.is_null() {
            return null_mut();
        }
        // SAFETY: sessions only exist on the JS thread of this realm.
        let global = unsafe { &*global_ptr };
        match super::stream::QuicStream::create(
            global,
            self.vtable,
            core::ptr::from_ref(self).cast_mut(),
            self.handle(),
            raw,
        ) {
            Ok((qs, _handle)) => {
                self.streams.with_mut(|v| v.push(qs));
                // The peer opened this stream, so it has wire presence even
                // before we write: `abort_for_destroy` must reset on it rather
                // than defer as if nothing had reached lsquic.
                // SAFETY: `qs` was just created.
                unsafe { (*qs).mark_wrote_to_lsquic() };
                // SAFETY: `raw` is the live stream lsquic just created.
                if let Some(s) = unsafe { lsquic::Stream::from_raw(raw) } {
                    self.bump_stream_stat(s.id(), false);
                }
                self.push_event(SessionEvent::StreamReady {
                    stream: qs,
                    remote: true,
                });
                // If the stream was already reset before on_new_stream
                // (RST arrived before any data), queue StreamReset now —
                // AFTER StreamReady so JS's onstream has set `onreset`.
                // SAFETY: `qs` was just created.
                if let Some(code) = unsafe { (*qs).pre_reset_code() } {
                    self.push_event(SessionEvent::StreamReset { stream: qs, code });
                }
                qs
            }
            Err(_) => null_mut(),
        }
    }

    /// Dispatch queued events to JS. Called by the endpoint after
    /// `lsquic_engine_process_conns` returns.
    /// Copy lsquic's conn-level counters into the stats ArrayBuffer.
    fn refresh_conn_stats(&self) {
        let conn = self.conn.get();
        if conn.is_null() {
            return;
        }
        // SAFETY: `conn` is live until on_conn_closed clears it.
        let Some(info) = (unsafe { lsquic::Conn::from_raw(conn) }).and_then(|c| c.info()) else {
            return;
        };
        // lsquic reports RTT in microseconds; Node's session.stats are
        // BigInt nanoseconds.
        let us_to_ns = |us: u32| u64::from(us) * 1000;
        self.write_stat(IDX_STATS_SESSION_BYTES_RECEIVED, info.bytes_rcvd);
        self.write_stat(IDX_STATS_SESSION_BYTES_SENT, info.bytes_sent);
        self.write_stat(IDX_STATS_SESSION_LOSS_RETRANSMIT_COUNT, info.pkts_retx);
        self.write_stat(IDX_STATS_SESSION_CWND, u64::from(info.cwnd));
        self.write_stat(IDX_STATS_SESSION_LATEST_RTT, us_to_ns(info.rtt));
        self.write_stat(IDX_STATS_SESSION_MIN_RTT, us_to_ns(info.rtt_min));
        self.write_stat(IDX_STATS_SESSION_RTTVAR, us_to_ns(info.rttvar));
        // lsquic has no separate smoothed RTT; the rtt field is the
        // smoothed estimate.
        self.write_stat(IDX_STATS_SESSION_SMOOTHED_RTT, us_to_ns(info.rtt));
        self.write_stat(IDX_STATS_SESSION_PKT_SENT, info.pkts_sent);
        self.write_stat(IDX_STATS_SESSION_PKT_RECV, info.pkts_rcvd);
        self.write_stat(IDX_STATS_SESSION_PKT_LOST, info.pkts_lost);
        self.write_stat(IDX_STATS_SESSION_BYTES_RECV, info.bytes_rcvd);
        if let Some(conn) = self.conn() {
            self.write_stat(IDX_STATS_SESSION_PING_RECV, conn.pings_received());
        }
    }

    /// Whether `stream` is still in the live set (so its raw pointer is safe
    /// to dereference). Stream events queued before teardown can outlive the
    /// stream itself.
    fn stream_is_live(&self, stream: *mut super::stream::QuicStream) -> bool {
        self.streams.get().contains(&stream)
    }
    /// Upgrade a queued stream pointer to a reference, verifying it is still
    /// registered in `self.streams` — teardown removes a stream from the
    /// registry before its allocation is freed, so a registered pointer is
    /// live on the JS thread.
    fn live_stream(&self, p: *mut super::stream::QuicStream) -> Option<&super::stream::QuicStream> {
        // SAFETY: see doc comment.
        self.stream_is_live(p).then(|| unsafe { &*p })
    }

    /// Set `state.max_datagram_size` from the peer's (possibly 0-RTT
    /// remembered) `max_datagram_frame_size` transport parameter, so a
    /// resuming client can `sendDatagram` before the handshake completes.
    pub(super) fn apply_peer_datagram_budget(&self) {
        let Some(tp) = self.conn().and_then(|c| c.peer_transport_params()) else {
            return;
        };
        let sz = tp
            .max_datagram_frame_size
            .saturating_sub(DATAGRAM_FRAME_OVERHEAD)
            .min(DATAGRAM_PAYLOAD_BUDGET) as u16;
        self.with_state(|s| s.max_datagram_size = sz);
    }

    /// Deliver held session tickets whose spacing delay has elapsed (see
    /// `pending_tickets`); drop them all once the session starts closing.
    fn deliver_pending_tickets(&self, global: &JSGlobalObject) {
        if self.pending_tickets.get().is_empty() {
            return;
        }
        if self.destroyed.get()
            || self.close_reported.get()
            || self.with_state(|s| s.graceful_close) != 0
        {
            self.pending_tickets.with_mut(VecDeque::clear);
            return;
        }
        // An actively-used session (it has streams) receives held tickets
        // immediately — the spacing exists only so a session that is closed
        // right after the first ticket never observes the second.
        let now = if self.streams.get().is_empty() {
            now_ns()
        } else {
            u64::MAX
        };
        loop {
            let blob = self.pending_tickets.with_mut(|q| {
                if q.front().is_some_and(|(at, _)| *at <= now) {
                    q.pop_front().map(|(_, b)| b)
                } else {
                    None
                }
            });
            let Some(blob) = blob else { break };
            if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                continue;
            }
            let buf = ArrayBuffer::create_buffer(global, &blob).unwrap_or(JSValue::UNDEFINED);
            if let Some(cb) = callbacks::get(global, "onSessionTicket") {
                let vm = global.bun_vm().as_mut();
                vm.event_loop_ref()
                    .run_callback(cb, global, self.handle(), &[buf]);
            }
        }
        if !self.pending_tickets.get().is_empty() {
            // Not due yet — keep the endpoint timer ticking.
            self.schedule_process();
        }
    }

    pub(super) fn process_events(&self, global: &JSGlobalObject) {
        self.refresh_conn_stats();
        self.deliver_pending_tickets(global);
        // Every callback below can run user JS that synchronously destroys
        // this session (safeCallbackInvoke catches a thrown user callback
        // and calls `session.destroy(err)`, dropping the wrapper Strong),
        // and `run_callback`'s microtask drain can trigger GC. Hold a
        // Strong on the wrapper for the duration so `self` survives.
        let _keep_alive = Strong::create(self.handle(), global);
        loop {
            let Some(event) = self.events.with_mut(|e| {
                if e.is_empty() {
                    None
                } else {
                    Some(e.remove(0))
                }
            }) else {
                break;
            };
            if self.destroyed.get() {
                break;
            }
            match event {
                SessionEvent::HandshakeDone { ok } => {
                    // Capture TLS facts now — lsquic frees the SSL object at
                    // confirmation, so later queries need the snapshot.
                    if ok {
                        self.capture_hsk_snapshot();
                        if self.is_server.get() {
                            // Node's server reports at handshake COMPLETION
                            // (session.cc: server completion == confirmation
                            // per RFC 9001 §4.1.2).
                            self.maybe_report_handshake(global, true);
                        } else {
                            // Node's client `opened` settles only for
                            // connections the server actually accepted: a
                            // refusing server (busy/limits) never finishes
                            // the handshake in Node, so defer the report to
                            // HANDSHAKE_DONE receipt — a refusal's close
                            // preempts it and `opened` rejects through the
                            // close path.
                            self.handshake_pending_ok.set(true);
                        }
                    } else {
                        self.maybe_report_handshake(global, false);
                    }
                }
                SessionEvent::HandshakeConfirmed => {
                    self.with_state(|s| s.handshake_confirmed = 1);
                    if self.handshake_pending_ok.get() {
                        // A peer that closed immediately after the handshake
                        // — refusal, or `close()` right after `opened` with
                        // no application activity — preempts the report, and
                        // `opened` settles through the close path instead. A
                        // close AFTER stream/datagram activity is a normal
                        // close of an opened session, even when a slow batch
                        // delivers both in one dispatch.
                        let close_wins = self.streams.get().is_empty()
                            && self.events.with_mut(|e| {
                                for ev in e.iter() {
                                    match ev {
                                        SessionEvent::StreamReady { .. }
                                        | SessionEvent::Datagram { .. } => return false,
                                        SessionEvent::PeerClose { .. } | SessionEvent::Closed => {
                                            return true;
                                        }
                                        _ => {}
                                    }
                                }
                                false
                            });
                        if !close_wins {
                            self.handshake_pending_ok.set(false);
                            self.maybe_report_handshake(global, true);
                        }
                    }
                }
                SessionEvent::PeerClose {
                    app_error,
                    code,
                    reason,
                } => {
                    self.peer_close.set(Some((app_error, code, reason)));
                }
                SessionEvent::Closed => {
                    self.report_close(global);
                }
                SessionEvent::StreamReady { stream, remote } => {
                    let Some(stream) = self.live_stream(stream) else {
                        continue;
                    };
                    // A remote stream that arrives already-reset while this
                    // session's close is in the same batch must never be
                    // surfaced (Node's onstream count excludes it).
                    if remote && self.conn.get().is_null() && stream.pre_reset_code().is_some() {
                        stream.suppress_announce();
                        continue;
                    }
                    if remote && stream.is_announce_suppressed() {
                        continue;
                    }
                    if remote {
                        let handle = stream.handle();
                        // Direction (0=bidi, 1=uni) is bit 1 of the stream id
                        // (RFC 9000 §2.1).
                        let id = stream.stream_id();
                        let direction = JSValue::js_number(if id as u64 & STREAM_ID_UNI_BIT != 0 {
                            1.0
                        } else {
                            0.0
                        });
                        if let Some(cb) = callbacks::get(global, "onStreamCreated") {
                            let vm = global.bun_vm().as_mut();
                            vm.event_loop_ref().run_callback(
                                cb,
                                global,
                                self.handle(),
                                &[handle, direction],
                            );
                        }
                    }
                }
                SessionEvent::NewToken(token) => {
                    // lsquic emits NEW_TOKEN several times per connection
                    // (initial + per-CID refresh); Node delivers one.
                    if !self.has_listener(LISTENER_FLAG_NEW_TOKEN)
                        || self.new_token_reported.replace(true)
                    {
                        continue;
                    }
                    let buf =
                        ArrayBuffer::create_buffer(global, &token).unwrap_or(JSValue::UNDEFINED);
                    if let Some(cb) = callbacks::get(global, "onSessionNewToken") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref()
                            .run_callback(cb, global, self.handle(), &[buf]);
                    }
                }
                SessionEvent::Keylog(line) => {
                    let Ok(s) = bun_core::String::clone_utf8(&line).to_js(global) else {
                        continue;
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionKeyLog") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref()
                            .run_callback(cb, global, self.handle(), &[s]);
                    }
                }
                SessionEvent::SessionResume(blob) => {
                    if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                        continue;
                    }
                    if self.ticket_delivered.replace(true) {
                        // Subsequent tickets are spaced out (see
                        // `pending_tickets`) and dropped if the session
                        // starts closing first.
                        self.pending_tickets
                            .with_mut(|q| q.push_back((now_ns() + TICKET_DELIVERY_DELAY_NS, blob)));
                        self.schedule_process();
                        continue;
                    }
                    let buf =
                        ArrayBuffer::create_buffer(global, &blob).unwrap_or(JSValue::UNDEFINED);
                    if let Some(cb) = callbacks::get(global, "onSessionTicket") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref()
                            .run_callback(cb, global, self.handle(), &[buf]);
                    }
                }
                SessionEvent::StreamReset { stream, code } => {
                    // The JS layer asserts `inner.onreset` is set; only fire
                    // when the `wants_reset` state bit was set by the
                    // `onreset` setter.
                    let Some(stream) = self
                        .live_stream(stream)
                        .filter(|s| s.wants_reset() && !s.is_announce_suppressed())
                    else {
                        continue;
                    };
                    let handle = stream.handle();
                    if let Ok(err) = make_application_error(global, code) {
                        if let Some(cb) = callbacks::get(global, "onStreamReset") {
                            let vm = global.bun_vm().as_mut();
                            vm.event_loop_ref().run_callback(cb, global, handle, &[err]);
                        }
                    }
                }
                SessionEvent::GoawayReceived => {
                    // lsquic doesn't surface the GOAWAY stream-id; Node
                    // reports -1n when the id is unavailable.
                    let Ok(last_stream_id) = JSValue::from_int64_no_truncate(global, -1) else {
                        continue;
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionGoaway") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(
                            cb,
                            global,
                            self.handle(),
                            &[last_stream_id],
                        );
                    }
                }
                SessionEvent::StreamWantsTrailers { stream } => {
                    let Some(stream) = self.live_stream(stream) else {
                        continue;
                    };
                    let handle = stream.handle();
                    if let Some(cb) = callbacks::get(global, "onStreamTrailers") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(cb, global, handle, &[]);
                    }
                }
                SessionEvent::StreamHeaders {
                    stream,
                    pairs,
                    kind,
                } => {
                    let Some(stream) = self.live_stream(stream).filter(|s| s.wants_headers())
                    else {
                        continue;
                    };
                    let handle = stream.handle();
                    // The JS layer's `parseHeaderPairs` expects a flat
                    // `[name, value, ...]` array.
                    // Latin-1, as node does for HTTP headers: h3 header octets
                    // need not be valid UTF-8, and a lossy decode would corrupt them.
                    let to_js = |s: &Vec<u8>| {
                        bun_core::String::clone_latin1(s)
                            .to_js(global)
                            .unwrap_or(JSValue::UNDEFINED)
                    };
                    let arr = pairs.iter().map(to_js).collect::<Vec<_>>();
                    if let Ok(js_arr) = JSValue::create_array_from_slice(global, &arr) {
                        if let Some(cb) = callbacks::get(global, "onStreamHeaders") {
                            let vm = global.bun_vm().as_mut();
                            vm.event_loop_ref().run_callback(
                                cb,
                                global,
                                handle,
                                &[js_arr, JSValue::js_number(kind as f64)],
                            );
                        }
                    }
                }
                SessionEvent::StreamDrain { stream } => {
                    let Some(stream) = self.live_stream(stream) else {
                        continue;
                    };
                    let handle = stream.handle();
                    if let Some(cb) = callbacks::get(global, "onStreamDrain") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(cb, global, handle, &[]);
                    }
                }
                SessionEvent::StreamBlocked { stream } => {
                    // The JS layer only registers interest via the
                    // `onblocked` setter (`wants_block` state bit).
                    let Some(stream) = self.live_stream(stream).filter(|s| s.wants_block()) else {
                        continue;
                    };
                    let handle = stream.handle();
                    if let Some(cb) = callbacks::get(global, "onStreamBlocked") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(cb, global, handle, &[]);
                    }
                }
                SessionEvent::StreamWake { stream } => {
                    let Some(stream) = self
                        .live_stream(stream)
                        .filter(|s| !s.is_announce_suppressed())
                    else {
                        continue;
                    };
                    if let Some(wakeup) = stream.take_wakeup() {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(
                            wakeup.get(),
                            global,
                            JSValue::UNDEFINED,
                            &[],
                        );
                    }
                }
                SessionEvent::Datagram { payload, early } => {
                    self.add_stat(IDX_STATS_SESSION_DATAGRAMS_RECEIVED, 1);
                    if !self.has_listener(LISTENER_FLAG_DATAGRAM) {
                        continue;
                    }
                    let Ok(buf) = ArrayBuffer::create_buffer(global, &payload) else {
                        continue;
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionDatagram") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(
                            cb,
                            global,
                            self.handle(),
                            &[buf, JSValue::js_boolean(early)],
                        );
                    }
                }
                SessionEvent::DatagramStatus { id, sent } => {
                    if sent {
                        self.add_stat(IDX_STATS_SESSION_DATAGRAMS_SENT, 1);
                        // The "acknowledged"/"lost" status arrives later via
                        // DatagramAckStatus when the carrying packet is
                        // ACKed or declared lost.
                        self.inflight_datagrams.with_mut(|q| q.push_back(id));
                        continue;
                    }
                    if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
                        continue;
                    }
                    let Ok(id_js) = JSValue::from_uint64_no_truncate(global, id) else {
                        continue;
                    };
                    let Ok(status_js) = bun_core::String::static_(b"abandoned").to_js(global)
                    else {
                        continue;
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(
                            cb,
                            global,
                            self.handle(),
                            &[id_js, status_js],
                        );
                    }
                }
                SessionEvent::EarlyDataFailed => {
                    // Cancel every stream opened during the 0-RTT phase
                    // (Node parity: their `closed` promises reject with an
                    // application error). lsquic tears them down on the
                    // wire; the local reset code drives the JS mapping.
                    let code = self.with_state(|s| {
                        if s.internal_error_code != 0 {
                            s.internal_error_code
                        } else {
                            1
                        }
                    });
                    let streams: Vec<*mut super::stream::QuicStream> = self.streams.get().clone();
                    for sp in streams {
                        if let Some(stream) = self.live_stream(sp) {
                            stream.cancel_early_rejected(code);
                        }
                    }
                }
                SessionEvent::DatagramAckStatus { count, acked } => {
                    let status = if acked {
                        b"acknowledged".as_slice()
                    } else {
                        b"lost".as_slice()
                    };
                    for _ in 0..count {
                        let Some(id) = self.inflight_datagrams.with_mut(VecDeque::pop_front) else {
                            break;
                        };
                        if acked {
                            self.add_stat(IDX_STATS_SESSION_DATAGRAMS_ACKNOWLEDGED, 1);
                        } else {
                            self.add_stat(IDX_STATS_SESSION_DATAGRAMS_LOST, 1);
                        }
                        if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
                            continue;
                        }
                        let Ok(id_js) = JSValue::from_uint64_no_truncate(global, id) else {
                            continue;
                        };
                        let Ok(status_js) = bun_core::String::static_(status).to_js(global) else {
                            continue;
                        };
                        if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
                            let vm = global.bun_vm().as_mut();
                            vm.event_loop_ref().run_callback(
                                cb,
                                global,
                                self.handle(),
                                &[id_js, status_js],
                            );
                        }
                    }
                }
                SessionEvent::VersionNegotiation { server_versions } => {
                    let Some((requested, min)) = self.verneg.get() else {
                        continue;
                    };
                    let Ok(requested_arr) =
                        JSValue::create_array_from_iter(global, server_versions.into_iter(), |v| {
                            Ok(JSValue::js_number(v as f64))
                        })
                    else {
                        continue;
                    };
                    // Node passes the locally-configured range as
                    // `[min_version, version]` (session.cc
                    // EmitVersionNegotiation).
                    let Ok(supported_arr) = JSValue::create_array_from_iter(
                        global,
                        [min, requested].into_iter(),
                        |v| Ok(JSValue::js_number(v as f64)),
                    ) else {
                        continue;
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionVersionNegotiation") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(
                            cb,
                            global,
                            self.handle(),
                            &[
                                JSValue::js_number(requested as f64),
                                requested_arr,
                                supported_arr,
                            ],
                        );
                    }
                }
                SessionEvent::Origin(payload) => {
                    if !self.has_listener(LISTENER_FLAG_ORIGIN) {
                        continue;
                    }
                    let mut origins: Vec<JSValue> = Vec::new();
                    let mut off = 0usize;
                    while off + ORIGIN_LEN_PREFIX <= payload.len() {
                        let n = u16::from_be_bytes([payload[off], payload[off + 1]]) as usize;
                        off += ORIGIN_LEN_PREFIX;
                        if off + n > payload.len() {
                            // Malformed entry: stop parsing, keep what we have.
                            break;
                        }
                        if let Ok(s) =
                            bun_core::String::clone_utf8(&payload[off..off + n]).to_js(global)
                        {
                            origins.push(s);
                        }
                        off += n;
                    }
                    let Ok(array) =
                        JSValue::create_array_from_iter(global, origins.into_iter(), Ok)
                    else {
                        continue;
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionOrigin") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref()
                            .run_callback(cb, global, self.handle(), &[array]);
                    }
                }
                SessionEvent::PathValidation {
                    validated,
                    preferred,
                    new_local,
                    new_remote,
                    old_local,
                    old_remote,
                } => {
                    if !self.has_listener(LISTENER_FLAG_PATH_VALIDATION) {
                        continue;
                    }
                    // Node reports 'aborted' when the path switched without
                    // completing validation (a non-probing packet arrived on
                    // the new path first); 'failure' is never produced here.
                    let result = if validated {
                        b"success".as_slice()
                    } else {
                        b"aborted".as_slice()
                    };
                    let Ok(result_js) = bun_core::String::static_(result).to_js(global) else {
                        continue;
                    };
                    // Node only passes the old path and the preferredAddress
                    // flag on the side that owns each fact: the server knows
                    // the previous path, the client knows it migrated to the
                    // preferred address.
                    let (old_local_js, old_remote_js, preferred_js) = if self.is_server.get() {
                        (
                            old_local.to_js_socket_address(global),
                            old_remote.to_js_socket_address(global),
                            JSValue::UNDEFINED,
                        )
                    } else {
                        (
                            JSValue::UNDEFINED,
                            JSValue::UNDEFINED,
                            JSValue::js_boolean(preferred),
                        )
                    };
                    if let Some(cb) = callbacks::get(global, "onSessionPathValidation") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(
                            cb,
                            global,
                            self.handle(),
                            &[
                                result_js,
                                new_local.to_js_socket_address(global),
                                new_remote.to_js_socket_address(global),
                                old_local_js,
                                old_remote_js,
                                preferred_js,
                            ],
                        );
                    }
                }
                SessionEvent::StreamStopSending { stream, code } => {
                    let Some(stream) = self.live_stream(stream) else {
                        continue;
                    };
                    stream.apply_peer_stop_sending(code);
                }
                SessionEvent::StreamClosed { stream: stream_ptr } => {
                    let Some(stream) = self.live_stream(stream_ptr) else {
                        continue;
                    };
                    if stream.mark_close_reported() || stream.is_announce_suppressed() {
                        continue;
                    }
                    // Runs the parked reader wakeup — user JS, which may destroy
                    // this stream and let GC free it. Re-acquire before any
                    // further use; `mark_close_reported` above already fired.
                    stream.end_read_side(global);
                    let Some(stream) = self.live_stream(stream_ptr) else {
                        continue;
                    };
                    let handle = stream.handle();
                    if let Some(cb) = callbacks::get(global, "onStreamClose") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref()
                            .run_callback(cb, global, handle, &[JSValue::UNDEFINED]);
                    }
                    // The JS callback may have torn it down already; this is
                    // a no-op then.
                    self.streams.with_mut(|v| v.retain(|&s| s != stream_ptr));
                }
            }
        }
    }

    fn maybe_report_handshake(&self, global: &JSGlobalObject, ok: bool) {
        if self.handshake_reported.replace(true) || self.destroyed.get() {
            return;
        }
        // `verifyClient`: don't open the stream window until the peer's
        // certificate is confirmed present (the abort below tears the
        // session down, but stream_open_allowed must never be 1 for an
        // unauthenticated connection in the interim).
        // Ensure the SSL-derived facts are captured before any query (the
        // SSL object is freed at handshake confirmation).
        if ok {
            self.capture_hsk_snapshot();
        }
        let cert_ok = {
            if let Some(endpoint) = self.endpoint_ref().filter(|_| ok && self.is_server.get()) {
                let verify_client = endpoint.server_verify_client.get();
                !verify_client
                    || self
                        .hsk_snapshot
                        .get()
                        .as_ref()
                        .is_some_and(|s| s.peer_cert_der.is_some())
            } else {
                true
            }
        };
        // The datagram budget is the peer's max_datagram_frame_size minus
        // DATAGRAM frame overhead (type byte + length varint), clamped to
        // the per-packet budget (1200-byte packets minus short-header +
        // AEAD overhead). 0 (or absent) disables.
        let peer_frame_size = if !ok || self.conn.get().is_null() {
            0
        } else {
            // SAFETY: `conn` is live (handshake just reported on it).
            unsafe { lsquic::Conn::from_raw(self.conn.get()) }
                .and_then(|c| c.peer_transport_params())
                .map(|tp| tp.max_datagram_frame_size)
                .unwrap_or(0)
        };
        self.with_state(|s| {
            s.handshake_completed = ok as u8;
            s.handshake_confirmed = ok as u8;
            s.stream_open_allowed = (ok && cert_ok) as u8;
            s.max_datagram_size = peer_frame_size
                .saturating_sub(DATAGRAM_FRAME_OVERHEAD)
                .min(DATAGRAM_PAYLOAD_BUDGET) as u16;
        });
        self.write_stat(IDX_STATS_SESSION_HANDSHAKE_COMPLETED_AT, now_ns());
        self.write_stat(IDX_STATS_SESSION_HANDSHAKE_CONFIRMED_AT, now_ns());
        if !ok {
            // A failed handshake closes the session; `on_conn_closed` follows.
            return;
        }
        // The SSL-derived facts were snapshotted at handshake completion
        // (the SSL object may already be freed by now — see HskSnapshot).
        // Borrowed, not taken: the JS getters (peerCertificate,
        // ephemeralKeyInfo) keep serving from the snapshot afterwards.
        self.capture_hsk_snapshot();
        let (snap_sni, snap_cipher, alpn_bytes, snap_validation, early_data, have_peer_cert) = {
            let s = self.hsk_snapshot.get();
            match s.as_ref() {
                Some(s) => (
                    s.sni.clone(),
                    s.cipher.clone(),
                    s.alpn.clone(),
                    s.validation,
                    s.early_data,
                    s.peer_cert_der.is_some(),
                ),
                None => (None, None, None, None, (false, false), false),
            }
        };
        let sni = opt_bytes_to_js(global, snap_sni.as_deref());
        let cipher = opt_bytes_to_js(global, snap_cipher.as_deref());
        // HTTP/3 application bits: when the engine runs in `LSENG_HTTP` mode
        // (and ALPN confirms it), enable headers/priority and switch the
        // close-error codes to RFC 9114's H3_NO_ERROR / H3_INTERNAL_ERROR.
        let is_http = self
            .endpoint_ref()
            .map(|ep| ep.is_http(self.is_server.get()))
            .unwrap_or(false)
            && alpn_bytes
                .as_deref()
                .map(|a| a == b"h3" || a.starts_with(b"h3-"))
                .unwrap_or(false);
        if is_http {
            self.with_state(|s| {
                s.headers_supported = 1;
                s.application_type = 1;
                s.priority_supported = 1;
                s.no_error_code = H3_NO_ERROR;
                s.internal_error_code = H3_INTERNAL_ERROR;
            });
        } else {
            // Raw QUIC: headers definitively unsupported now that ALPN is
            // settled (the JS layer's `headersSupported === 2` check throws).
            self.with_state(|s| s.headers_supported = 2);
        }
        let alpn = alpn_bytes
            .and_then(|b| bun_core::String::clone_utf8(&b).to_js(global).ok())
            .unwrap_or(JSValue::UNDEFINED);
        let cipher_version = bun_core::String::static_(b"TLSv1.3")
            .to_js(global)
            .unwrap_or(JSValue::UNDEFINED);
        // Node reports both fields only when validation failed; the JS layer
        // gates the 'auto'-mode rejection on `validationErrorReason !==
        // undefined`, so a clean verify must pass undefined here. A server
        // that received NO client certificate reports X509_V_ERR_UNSPECIFIED
        // (Node: `verifyPeerCertificate()` returns nullopt without a peer
        // cert, mapped through `value_or(X509_V_ERR_UNSPECIFIED)`).
        let (verify_reason, verify_code) = match snap_validation {
            Some(s) => {
                let v = bun_core::String::static_(s.as_bytes())
                    .to_js(global)
                    .unwrap_or(JSValue::UNDEFINED);
                (v, v)
            }
            None if self.is_server.get() && !have_peer_cert => (
                bun_core::String::static_(b"unspecified certificate verification error")
                    .to_js(global)
                    .unwrap_or(JSValue::UNDEFINED),
                bun_core::String::static_(b"UNSPECIFIED")
                    .to_js(global)
                    .unwrap_or(JSValue::UNDEFINED),
            ),
            None => (JSValue::UNDEFINED, JSValue::UNDEFINED),
        };
        if let Some(callback) = callbacks::get(global, "onSessionHandshake") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref().run_callback(
                callback,
                global,
                self.handle(),
                &[
                    sni,
                    alpn,
                    cipher,
                    cipher_version,
                    verify_reason,
                    verify_code,
                    JSValue::js_boolean(early_data.0),
                    JSValue::js_boolean(early_data.1),
                ],
            );
        }

        if self.qlog_enabled.get() {
            // Header record (qlog_version/qlog_format) + first event, in one
            // chunk. Synthesized — lsquic's qlog module is a global logger,
            // not per-connection.
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"qlog_version\":\"0.3\",\"qlog_format\":\"JSON-SEQ\",\"title\":\"bun node:quic\"}}\n\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_started\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(global, &chunk, false);
        }

        // 0-RTT was attempted but the server rejected it (e.g. changed
        // transport parameters): Node destroys the early streams and fires
        // `onearlyrejected` / the `quic.session.early.rejected` channel —
        // on the CLIENT only (the server's TLS also reports the attempt).
        if early_data.0 && !early_data.1 && !self.is_server.get() {
            // The 0-RTT streams were already cancelled by the
            // EarlyDataFailed event (fired the moment the rejection was
            // detected); here only the JS notification remains.
            if let Some(callback) = callbacks::get(global, "onSessionEarlyDataRejected") {
                let vm = global.bun_vm().as_mut();
                vm.event_loop_ref()
                    .run_callback(callback, global, self.handle(), &[]);
            }
        }

        // `verifyClient` post-handshake enforcement: in TLS 1.3 the client's
        // certificate arrives with its final flight, so a missing cert is
        // rejected only after the handshake completes — matching Node, where
        // the server session exists and then closes with a
        // certificate_required transport error.
        if !cert_ok && !self.destroyed.get() && !self.conn.get().is_null() {
            // Record so report_close surfaces the error on OUR side too —
            // both peers' `closed` reject with the transport error.
            self.self_close.with_mut(|s| {
                *s = Some((
                    false,
                    CRYPTO_ERROR_CERTIFICATE_REQUIRED,
                    b"peer did not provide a certificate".to_vec(),
                ));
            });
            if let Some(c) = self.conn() {
                c.abort_error(
                    false,
                    CRYPTO_ERROR_CERTIFICATE_REQUIRED as c_uint,
                    c"peer did not provide a certificate",
                );
            }
            self.schedule_process();
        }
    }

    /// Snapshot the SSL-derived handshake facts while the SSL object is
    /// still alive (lsquic frees it once the handshake is confirmed).
    /// Idempotent; safe to call from event dispatch on the JS thread.
    fn capture_hsk_snapshot(&self) {
        if self.hsk_snapshot.get().is_some() {
            return;
        }
        let Some(conn) = self.conn() else {
            return;
        };
        let sni = conn.sni().map(|s| s.to_bytes().to_vec());
        let cipher = conn.cipher().map(|s| s.to_bytes().to_vec());
        let ssl = conn.ssl().cast();
        let alpn = tls::negotiated_alpn(ssl).or_else(|| {
            // lsquic doesn't run the ALPN callback for raw-QUIC clients;
            // fall back to what we configured if BoringSSL has nothing.
            self.endpoint_ref()
                .and_then(|ep| ep.configured_alpn(self.is_server.get()))
        });
        let validation = tls::validation_error(ssl).map(|(_, s)| s);
        let peer_cert_der = tls::peer_certificate_der(ssl);
        let local_cert_der = tls::local_certificate_der(ssl);
        let ephemeral = tls::ephemeral_key_info(ssl);
        let early_data = tls::early_data_info(ssl);
        self.hsk_snapshot.with_mut(|s| {
            *s = Some(HskSnapshot {
                sni,
                cipher,
                alpn,
                validation,
                peer_cert_der,
                local_cert_der,
                ephemeral,
                early_data,
            });
        });
    }

    /// Deliver one qlog chunk (RFC 7464 JSON-SEQ records) via
    /// `onSessionQlog(data, fin)`.
    fn emit_qlog(&self, global: &JSGlobalObject, data: &str, fin: bool) {
        if !self.qlog_enabled.get() || self.qlog_fin_sent.get() {
            return;
        }
        if fin {
            self.qlog_fin_sent.set(true);
        }
        let Ok(data_js) = bun_core::String::clone_utf8(data.as_bytes()).to_js(global) else {
            return;
        };
        if let Some(cb) = callbacks::get(global, "onSessionQlog") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref().run_callback(
                cb,
                global,
                self.handle(),
                &[data_js, JSValue::js_boolean(fin)],
            );
        }
    }

    fn report_close(&self, global: &JSGlobalObject) {
        if self.close_reported.replace(true) {
            return;
        }
        self.with_state(|s| s.closing = 1);
        self.write_stat(IDX_STATS_SESSION_DESTROYED_AT, now_ns());
        if self.qlog_enabled.get() {
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_closed\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(global, &chunk, true);
        }
        // The JS layer's `onSessionClose(type, code, reason, errorName)` shape
        // (`type`: 0=transport, 1=application, 2=version-neg, 3=idle).
        let (error_type, code, reason): (i32, u64, Option<Vec<u8>>) = match self
            .peer_close
            .with_mut(Option::take)
            .or_else(|| self.self_close.with_mut(Option::take))
        {
            Some((app, code, reason)) => (if app { 1 } else { 0 }, code, Some(reason)),
            None if self.conn.get().is_null() => {
                // The conn is already freed; use the status captured in
                // `on_conn_closed` (a session that never had a conn — or
                // whose conn closed with no local error — reports clean).
                match self.final_conn_status.with_mut(Option::take) {
                    Some((status, msg)) => {
                        map_conn_status(status, msg, self.handshake_reported.get())
                    }
                    None => (0, 0, None),
                }
            }
            None => {
                // Map the lsquic conn status to Node's QuicError shape.
                let mut buf = [0 as c_char; CONN_STATUS_ERRBUF_LEN];
                // SAFETY: `conn` is non-null (checked above) and live
                // until lsquic frees it after `on_conn_closed` returns.
                let status = unsafe {
                    lsquic::lsquic_conn_status(self.conn.get(), buf.as_mut_ptr(), buf.len())
                };
                // SAFETY: `buf` is NUL-terminated by lsquic.
                let msg = unsafe { core::ffi::CStr::from_ptr(buf.as_ptr()) }
                    .to_bytes()
                    .to_vec();
                map_conn_status(status, msg, self.handshake_reported.get())
            }
        };
        let Ok(code_js) = JSValue::from_uint64_no_truncate(global, code) else {
            return;
        };
        let reason_js = reason
            .filter(|r| !r.is_empty())
            .and_then(|r| bun_core::String::clone_utf8(&r).to_js(global).ok())
            .unwrap_or(JSValue::UNDEFINED);
        // Unregister first: the JS close callback runs `destroy()` →
        // `teardown()`, which clears `self.endpoint`, so the pointer would be
        // gone afterward.
        let endpoint = self.endpoint.get();
        if !endpoint.is_null() {
            // SAFETY: endpoint is alive (endpoint_js Strong still held).
            unsafe { (*endpoint).unregister_session(core::ptr::from_ref(self).cast_mut()) };
        }
        if let Some(callback) = callbacks::get(global, "onSessionClose") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref().run_callback(
                callback,
                global,
                self.handle(),
                &[
                    JSValue::js_number(error_type as f64),
                    code_js,
                    reason_js,
                    JSValue::UNDEFINED,
                ],
            );
        }
    }

    fn teardown(&self, _global: &JSGlobalObject) {
        if self.destroyed.replace(true) {
            return;
        }
        for qs in self.streams.with_mut(core::mem::take) {
            // SAFETY: streams are kept alive by their wrapper Strong;
            // teardown is idempotent.
            unsafe { (*qs).teardown(_global) };
        }
        self.pending_local_streams.with_mut(VecDeque::clear);
        let conn = self.conn.replace(null_mut());
        if !conn.is_null() {
            // SAFETY: `conn` is live until lsquic frees it inside
            // `on_conn_closed`; clearing the ctx breaks the back-pointer so
            // late callbacks no-op.
            unsafe { lsquic::lsquic_conn_set_ctx(conn, null_mut()) };
        }
        self.events.with_mut(Vec::clear);
        let ep = self.endpoint.replace(null_mut());
        if !ep.is_null() {
            // SAFETY: endpoint is alive (endpoint_js Strong still held below).
            // The endpoint's `process()` re-validates against this set before
            // touching any session, so removing here is what makes the
            // pointer it snapshotted safe to skip.
            unsafe { (*ep).unregister_session(core::ptr::from_ref(self).cast_mut()) };
        }
        self.endpoint_js.set(None);
        self.application_options_js.set(None);
        self.this_value.with_mut(|r| r.downgrade());
    }

    // ── JS-facing surface ────────────────────────────────────────────────

    pub(crate) fn get_remote_address(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self.remote_addr.get().to_js_socket_address(global))
    }
    pub(crate) fn get_local_address(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(self.local_addr.get().to_js_socket_address(global))
    }
    /// Send CONNECTION_CLOSE for `options` (`{type, code, reason}` or
    /// undefined → transport NO_ERROR) and record it for `onSessionClose`.
    /// Parse `{type, code, reason}` (undefined → transport NO_ERROR) into
    /// `(app_error, code, NUL-terminated reason)` and record it for
    /// `onSessionClose`.
    fn parse_close_options(
        &self,
        global: &JSGlobalObject,
        options: JSValue,
    ) -> JsResult<(bool, u64, Vec<u8>)> {
        let mut app = false;
        let mut code = 0u64;
        let mut reason = Vec::new();
        if options.is_object() {
            app = options
                .get(global, "type")?
                .map(|v| {
                    bun_core::String::from_js(v, global)
                        .map(|s| s.to_utf8_bytes() == b"application")
                        .unwrap_or(false)
                })
                .unwrap_or(false);
            code = super::endpoint::read_u64_option(global, options, "code")?.unwrap_or(0);
            reason = options
                .get(global, "reason")?
                .filter(|v| v.is_string())
                .map(|v| bun_core::String::from_js(v, global).map(|s| s.to_utf8_bytes()))
                .transpose()?
                .unwrap_or_default();
            self.self_close.with_mut(|s| {
                *s = Some((app, code, reason.clone()));
            });
        }
        reason.push(0);
        Ok((app, code, reason))
    }

    /// Send CONNECTION_CLOSE for previously parsed close options.
    fn apply_close(&self, app: bool, code: u64, reason: &[u8]) {
        let Some(c) = self.conn() else { return };
        if app || code != 0 || reason.len() > 1 {
            // `reason` is NUL-terminated; an interior NUL truncates,
            // matching the previous raw-pointer pass.
            let creason = core::ffi::CStr::from_bytes_until_nul(reason).unwrap_or(c"close");
            c.abort_error(app, code.min(u32::MAX as u64) as core::ffi::c_uint, creason);
        } else {
            c.close();
        }
    }

    fn close_with_options(&self, global: &JSGlobalObject, options: JSValue) -> JsResult<()> {
        let (app, code, reason) = self.parse_close_options(global, options)?;
        self.apply_close(app, code, &reason);
        Ok(())
    }

    /// Whether any registered stream still has undelivered outbound bytes.
    fn any_stream_undelivered(&self) -> bool {
        self.streams.get().iter().any(|&s| {
            // SAFETY: pointers in `streams` are unregistered before their
            // owner is destroyed (registry invariant).
            unsafe { (*s).has_undelivered_outbound() }
        })
    }

    /// Complete a deferred graceful close once all streams have delivered.
    pub(super) fn maybe_finish_deferred_close(&self) {
        if self.deferred_close.get().is_none() || self.destroyed.get() {
            return;
        }
        if self.any_stream_undelivered() {
            return;
        }
        if self.close_after_streams.get() && !self.streams.get().is_empty() {
            return;
        }
        if let Some((app, code, reason)) = self.deferred_close.with_mut(Option::take) {
            self.apply_close(app, code, &reason);
            self.schedule_process();
        }
    }

    pub(crate) fn graceful_close(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if !self.destroyed.get() {
            self.with_state(|s| s.graceful_close = 1);
            if self.conn.get().is_null() {
                if self.is_server.get() && !self.close_reported.get() {
                    // Provisional session: the mini-conn handshake is still
                    // in flight. Defer — `bind_conn` closes the conn the
                    // moment it exists, and the JS `closed` promise settles
                    // through the normal close flow.
                    self.close_when_bound.set(true);
                } else {
                    // Client (or already-detached) session with no conn:
                    // nothing on the wire — settle `closed` now.
                    self.report_close(global);
                }
            } else {
                let (app, code, reason) =
                    self.parse_close_options(global, frame.arguments_as_array::<1>()[0])?;
                let is_http = self
                    .endpoint_ref()
                    .map(|ep| ep.is_http(self.is_server.get()))
                    .unwrap_or(false);
                if is_http && !app && code == 0 && !self.streams.get().is_empty() {
                    // HTTP/3 graceful shutdown with streams still open:
                    // GOAWAY goes out now (peers see the shutdown notice and
                    // fire `ongoaway`), the CONNECTION_CLOSE once the
                    // remaining streams finish (RFC 9114 §5.2).
                    if let Some(c) = self.conn() {
                        c.going_away();
                    }
                    self.close_after_streams.set(true);
                    self.deferred_close
                        .with_mut(|d| *d = Some((app, code, reason)));
                } else if self.any_stream_undelivered() {
                    // lsquic_conn_close resets streams whose FINs aren't yet
                    // acked; hold the CONNECTION_CLOSE until they deliver
                    // (checked after every process_conns).
                    self.deferred_close
                        .with_mut(|d| *d = Some((app, code, reason)));
                } else {
                    self.apply_close(app, code, &reason);
                }
                self.schedule_process();
            }
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn silent_close(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        if !self.destroyed.get() {
            if let Some(c) = self.conn() {
                c.abort();
                self.schedule_process();
            }
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn destroy(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        if !self.close_reported.get() && !self.conn.get().is_null() {
            let options = frame.arguments_as_array::<1>()[0];
            if options.is_object() {
                // Explicit close options: put the CONNECTION_CLOSE on the
                // wire before destroying (Node's Destroy with close options).
                self.close_with_options(global, options)?;
                // `abort_error` only QUEUES the frame; `teardown()` below kills
                // the conn, so without a synchronous engine pass the frame can
                // lose the race to the scheduled tick and never reach the wire
                // — the peer then idles out and sees a graceful close.
                if let Some(endpoint) = self.endpoint_ref() {
                    endpoint.drive_engines_once();
                }
            } else if let Some(c) = self.conn() {
                // Flush the delayed ACK for the peer's last packets before
                // dying: Node's server acks the packet that triggered the
                // destroying callback, so the peer quietly idles out
                // instead of retransmitting into a stateless reset.
                c.ack_now();
                if let Some(endpoint) = self.endpoint_ref() {
                    endpoint.drive_engines_once();
                }
                // The engine pass can close the conn (a handshake failure or
                // pending error ticks to completion); `on_conn_closed` nulls
                // `self.conn`, so re-acquire instead of using the pre-drive
                // handle.
                if let Some(c) = self.conn() {
                    // Plain destroy(): silent — no CONNECTION_CLOSE. The
                    // peer discovers the death via stateless reset or idle
                    // timeout (Node parity: Session::Destroy without close
                    // options).
                    c.abort_silent();
                }
            }
            self.schedule_process();
        }
        self.teardown(global);
        Ok(JSValue::UNDEFINED)
    }
    /// `openStream(direction, body)` — locally initiate a stream. lsquic only
    /// supports bidi via `lsquic_conn_make_stream`; uni-stream creation needs
    /// an lsquic patch (see project memory). The stream is created in the
    /// pending state; lsquic's `on_new_stream` binds it.
    pub(crate) fn open_stream(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() || self.conn.get().is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        let [direction, body] = frame.arguments_as_array::<2>();
        let (qs, handle) = super::stream::QuicStream::create(
            global,
            self.vtable,
            core::ptr::from_ref(self).cast_mut(),
            frame.this(),
            null_mut(),
        )?;
        self.pending_local_streams.with_mut(|q| q.push_back(qs));
        self.streams.with_mut(|v| v.push(qs));
        // direction: 0=bidi, 1=uni; the stream id isn't assigned yet so use
        // the requested direction.
        self.bump_stream_stat(
            if direction.to_int32() == 1 {
                STREAM_ID_UNI_BIT
            } else {
                0
            },
            true,
        );
        // Queue a one-shot body if given (the JS layer also calls
        // attachSource for non-buffer sources afterwards).
        if let Some(buf) = body.as_array_buffer(global) {
            // SAFETY: `qs` was just created.
            unsafe {
                (*qs).outbound.with_mut(|o| {
                    o.started = true;
                    o.data.extend(buf.byte_slice().iter().copied());
                    o.fin_pending = true;
                });
            }
        }
        let unidirectional = direction.is_number() && direction.as_number() == 1.0;
        // SAFETY: `conn` is non-null (checked above) and live.
        if let Some(conn) = unsafe { lsquic::Conn::from_raw(self.conn.get()) } {
            if unidirectional {
                conn.make_uni_stream();
            } else {
                conn.make_stream();
            }
        }
        self.schedule_process();
        Ok(handle)
    }
    /// `sendDatagram(view)` — queue an unreliable datagram. Returns its id as
    /// a BigInt (`0n` when it could not be queued). Transmission happens via
    /// lsquic's `on_dg_write` on the next `process_conns`.
    pub(crate) fn send_datagram(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() || self.conn.get().is_null() {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        let [data] = frame.arguments_as_array::<1>();
        let Some(buf) = data.as_array_buffer(global) else {
            return JSValue::from_uint64_no_truncate(global, 0);
        };
        // HTTP/3: the peer must have advertised SETTINGS_H3_DATAGRAM
        // (RFC 9297 §2.1.1); otherwise not sent (0n).
        let is_http = self
            .endpoint_ref()
            .is_some_and(|ep| ep.is_http(self.is_server.get()));
        // Only an explicit peer SETTINGS_H3_DATAGRAM=0 (or absent from a
        // received SETTINGS frame) refuses; while the peer's SETTINGS have
        // not yet arrived (they race the first application data) the
        // datagram is queued optimistically.
        if is_http && self.conn().and_then(|c| c.peer_h3_datagram()) == Some(false) {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        // Oversized for the negotiated budget: not sent (Node returns 0n).
        // SAFETY: state buffer is live.
        let max_size = self.with_state(|s| s.max_datagram_size);
        if max_size == 0 || buf.byte_slice().len() > max_size as usize {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        let id = self
            .next_datagram_id
            .replace(self.next_datagram_id.get() + 1);
        // SAFETY: state buffer is live.
        let max_pending = self.with_state(|s| s.max_pending_datagrams);
        if max_pending > 0 && self.datagram_queue.get().len() >= max_pending as usize {
            // Queue full. With drop-newest (default false → drop-oldest;
            // true → drop-newest), abandon either this datagram or the
            // oldest queued one. Node reports the abandonment synchronously
            // from within sendDatagram.
            if self.datagram_drop_newest.get() {
                self.report_datagram_abandoned(global, id);
                // SAFETY: as above.
                unsafe { (&raw mut (*self.state_mut()).last_datagram_id).write_unaligned(id) };
                return JSValue::from_uint64_no_truncate(global, id);
            }
            if let Some((dropped_id, _)) = self.datagram_queue.with_mut(VecDeque::pop_front) {
                self.report_datagram_abandoned(global, dropped_id);
            }
        }
        self.datagram_queue
            .with_mut(|q| q.push_back((id, buf.byte_slice().to_vec())));
        // SAFETY: state buffer is live; ArrayBuffer storage is byte-aligned.
        unsafe { (&raw mut (*self.state_mut()).last_datagram_id).write_unaligned(id) };
        // SAFETY: `conn` is non-null (checked above) and live.
        if let Some(c) = unsafe { lsquic::Conn::from_raw(self.conn.get()) } {
            c.want_datagram_write(true);
        }
        self.schedule_process();
        JSValue::from_uint64_no_truncate(global, id)
    }
    /// Fire `onSessionDatagramStatus(id, "abandoned")` synchronously —
    /// sendDatagram's queue-overflow contract (unlike wire-driven statuses,
    /// which queue through `SessionEvent::DatagramStatus`).
    fn report_datagram_abandoned(&self, global: &JSGlobalObject, id: u64) {
        if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
            return;
        }
        let Ok(id_js) = JSValue::from_uint64_no_truncate(global, id) else {
            return;
        };
        let Ok(status_js) = bun_core::String::static_(b"abandoned").to_js(global) else {
            return;
        };
        if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref()
                .run_callback(cb, global, self.handle(), &[id_js, status_js]);
        }
    }

    /// `session.updateKey()` — always reports "not updated". lsquic only
    /// *responds* to a peer-initiated key update (it flips `esi_key_phase` on
    /// receipt in `lsquic_enc_sess_ietf.c`); it exposes no way to initiate
    /// one. Node's JS layer discards this return value, matching upstream.
    pub(crate) fn update_key(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(false))
    }
    pub(crate) fn get_certificate(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        if let Some(der) = self.conn_ssl().and_then(tls::local_certificate_der) {
            return ArrayBuffer::create_buffer(global, der.as_slice());
        }
        // The SSL object is freed at handshake confirmation; serve the DER
        // snapshotted at completion.
        if let Some(der) = self
            .hsk_snapshot
            .get()
            .as_ref()
            .and_then(|s| s.local_cert_der.clone())
        {
            return ArrayBuffer::create_buffer(global, &der);
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn get_peer_certificate(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        if let Some(conn) = self.conn() {
            // lsquic returns a STACK_OF(X509)* the callee frees
            // (sk_X509_pop_free inside leaf_certificate_der).
            if let Some(der) = tls::leaf_certificate_der(conn.server_cert_chain()) {
                return ArrayBuffer::create_buffer(global, &der);
            }
            // lsquic only tracks the SERVER's chain; for a server session
            // the client's certificate (requested via verifyClient) comes
            // from the TLS session directly.
            if let Some(ssl) = self.conn_ssl() {
                if let Some(der) = tls::peer_certificate_der(ssl) {
                    return ArrayBuffer::create_buffer(global, &der);
                }
            }
        }
        // The SSL object is freed at handshake confirmation (and the conn
        // itself once the peer closes); serve the DER snapshotted at
        // completion.
        if let Some(der) = self
            .hsk_snapshot
            .get()
            .as_ref()
            .and_then(|s| s.peer_cert_der.clone())
        {
            return ArrayBuffer::create_buffer(global, &der);
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn get_ephemeral_key(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        // Live SSL when available; snapshot after confirmation frees it.
        let Some((kind, name, bits)) = self
            .conn_ssl()
            .and_then(tls::ephemeral_key_info)
            .or_else(|| self.hsk_snapshot.get().as_ref().and_then(|s| s.ephemeral))
        else {
            return Ok(JSValue::UNDEFINED);
        };
        let obj = JSValue::create_empty_object(global, 3);
        obj.put(
            global,
            b"type",
            bun_core::String::static_(kind.as_bytes()).to_js(global)?,
        );
        if let Some(name) = name {
            obj.put(
                global,
                b"name",
                bun_core::String::static_(name.as_bytes()).to_js(global)?,
            );
        }
        obj.put(global, b"size", JSValue::js_number(f64::from(bits)));
        Ok(obj)
    }
    /// The lsquic conn while it is attached. Non-null between binding
    /// (create/connect) and `on_conn_closed` clearing it, so it is live for
    /// the duration of any JS-thread call that observes `Some`.
    fn conn(&self) -> Option<lsquic::Conn> {
        // SAFETY: see doc comment.
        unsafe { lsquic::Conn::from_raw(self.conn.get()) }
    }
    fn conn_ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        let ssl = self.conn()?.ssl().cast::<bun_boringssl_sys::SSL>();
        (!ssl.is_null()).then_some(ssl)
    }
    pub(crate) fn application_options(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        if let Some(stored) = self.application_options_js.get().as_ref().map(Strong::get) {
            if !stored.is_empty_or_undefined_or_null() {
                return Ok(stored);
            }
        }
        // No application configured: return the default-application object so
        // the JS layer's `applicationOptions !== undefined` check passes.
        let obj = JSValue::create_empty_object_with_null_prototype(global);
        let big = |v: u64| JSValue::from_uint64_no_truncate(global, v);
        // Match Node's DefaultApplication normalized defaults (`session.cc`).
        obj.put(global, b"maxHeaderPairs", big(DEFAULT_MAX_HEADER_PAIRS)?);
        obj.put(global, b"maxHeaderLength", big(DEFAULT_MAX_HEADER_LENGTH)?);
        obj.put(global, b"maxFieldSectionSize", big(0)?);
        obj.put(global, b"qpackMaxDtableCapacity", big(0)?);
        obj.put(global, b"qpackEncoderMaxDtableCapacity", big(0)?);
        obj.put(global, b"qpackBlockedStreams", big(0)?);
        obj.put(global, b"enableConnectProtocol", JSValue::js_boolean(false));
        obj.put(global, b"enableDatagrams", JSValue::js_boolean(true));
        // Cache it so subsequent calls return the same object.
        self.application_options_js
            .set(Some(Strong::create(obj, global)));
        Ok(obj)
    }
    /// Build the `{__proto__: null, ...BigInt fields, disableActiveMigration}`
    /// object Node returns from `local/remoteTransportParams`.
    fn transport_params_to_js(
        global: &JSGlobalObject,
        tp: &lsquic::NqTransportParams,
    ) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object_with_null_prototype(global);
        let put = |name: &[u8], v: u64| -> JsResult<()> {
            obj.put(global, name, JSValue::from_uint64_no_truncate(global, v)?);
            Ok(())
        };
        put(
            b"initialMaxStreamDataBidiLocal",
            tp.initial_max_stream_data_bidi_local,
        )?;
        put(
            b"initialMaxStreamDataBidiRemote",
            tp.initial_max_stream_data_bidi_remote,
        )?;
        put(b"initialMaxStreamDataUni", tp.initial_max_stream_data_uni)?;
        put(b"initialMaxData", tp.initial_max_data)?;
        put(b"initialMaxStreamsBidi", tp.initial_max_streams_bidi)?;
        put(b"initialMaxStreamsUni", tp.initial_max_streams_uni)?;
        // Node reports this in seconds (transportparams.cc:473 divides the
        // stored value by NGTCP2_SECONDS); the snapshot holds milliseconds.
        put(b"maxIdleTimeout", tp.max_idle_timeout / MS_PER_SEC)?;
        put(b"maxUdpPayloadSize", tp.max_udp_payload_size)?;
        put(b"ackDelayExponent", tp.ack_delay_exponent)?;
        put(b"maxAckDelay", tp.max_ack_delay)?;
        put(b"activeConnectionIDLimit", tp.active_connection_id_limit)?;
        put(b"maxDatagramFrameSize", tp.max_datagram_frame_size)?;
        obj.put(
            global,
            b"disableActiveMigration",
            JSValue::js_boolean(tp.disable_active_migration != 0),
        );
        let put_cid = |name: &[u8], s: &str| {
            let v = if s.is_empty() {
                JSValue::UNDEFINED
            } else {
                bun_core::String::clone_utf8(s.as_bytes())
                    .to_js(global)
                    .unwrap_or(JSValue::UNDEFINED)
            };
            obj.put(global, name, v);
        };
        put_cid(b"initialSCID", tp.initial_scid_str());
        put_cid(b"retrySCID", tp.retry_scid_str());
        put_cid(b"originalDCID", tp.original_dcid_str());
        Ok(obj)
    }
}

/// `Some(bytes)` → JS string; `None` → `undefined`.
fn opt_bytes_to_js(global: &JSGlobalObject, bytes: Option<&[u8]>) -> JSValue {
    match bytes {
        Some(b) => bun_core::String::clone_utf8(b)
            .to_js(global)
            .unwrap_or(JSValue::UNDEFINED),
        None => JSValue::UNDEFINED,
    }
}

/// Build the raw `["application", code]` array `convertQuicError` expects.
fn make_application_error(global: &JSGlobalObject, code: u64) -> JsResult<JSValue> {
    let kind = bun_core::String::static_(b"application").to_js(global)?;
    let code = JSValue::from_uint64_no_truncate(global, code)?;
    JSValue::create_array_from_slice(
        global,
        &[kind, code, JSValue::UNDEFINED, JSValue::UNDEFINED],
    )
}

impl QuicSession {
    pub(crate) fn local_transport_params(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(ep) = self.endpoint_ref() else {
            return Ok(JSValue::UNDEFINED);
        };
        let tp = if self.is_server.get() {
            ep.server_local_tp.get()
        } else {
            ep.client_local_tp.get()
        };
        Self::transport_params_to_js(global, tp)
    }
    pub(crate) fn remote_transport_params(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        let conn = self.conn.get();
        if conn.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: `conn` is live until on_conn_closed clears it.
        let Some(tp) =
            (unsafe { lsquic::Conn::from_raw(conn) }).and_then(|c| c.peer_transport_params())
        else {
            return Ok(JSValue::UNDEFINED);
        };
        Self::transport_params_to_js(global, &tp)
    }

    #[expect(
        clippy::boxed_local,
        reason = "codegen's host_fn_finalize calls this as `|b| QuicSession::finalize(b)` and requires `self: Box<Self>`"
    )]
    pub(crate) fn finalize(self: Box<Self>) {
        // Same hazard as QuicEndpoint::finalize: a GC'd session must not
        // leave its timer registered in the global heap. ACTIVE is the
        // canonical "in the heap" state (see `All::update`).
        if self.event_loop_timer.get().state == crate::timer::EventLoopTimerState::ACTIVE {
            crate::jsc_hooks::timer_all_mut().remove(self.event_loop_timer.as_ptr());
        }
    }
}

// ── lsquic callback targets (see node_quic_shim.c thunks) ────────────────

lsquic_callback! {
    /// `on_new_conn`: allocate a QuicSession, install it as the conn-ctx. The JS
    /// `onSessionNew` callback is fired by the endpoint after `process_conns`
    /// returns (server side); for clients the endpoint's `connect()` returns the
    /// handle directly.
    pub(super) fn on_new_conn(
        endpoint: &QuicEndpoint,
        c: *mut lsquic::lsquic_conn,
    ) -> *mut c_void = null_mut(); {
        if c.is_null() {
            return null_mut();
        }
        endpoint.on_new_conn(c).cast()
    }

    pub(super) fn on_goaway_received(session: &QuicSession) {
        session.push_event(SessionEvent::GoawayReceived);
    }

    pub(super) fn on_hsk_confirmed(session: &QuicSession) {
        session.push_event(SessionEvent::HandshakeConfirmed);
    }

    pub(super) fn on_hsk_done(session: &QuicSession, status: c_int) {
        let ok = status == lsquic::LSQ_HSK_OK || status == lsquic::LSQ_HSK_RESUMED_OK;
        session.push_event(SessionEvent::HandshakeDone { ok });
    }
}

/// Map an `lsquic_conn_status` to Node's `onSessionClose(type, code,
/// reason)` shape (`type`: 0=transport, 1=application, 2=version-neg,
/// 3=idle).
fn map_conn_status(
    status: c_int,
    msg: Vec<u8>,
    handshake_reported: bool,
) -> (i32, u64, Option<Vec<u8>>) {
    match status {
        // A timeout before the handshake ever completed is a failed
        // connection attempt (blocked/blackholed peer), not an idle close —
        // Node rejects `opened` with a transport error.
        lsquic::LSCONN_ST_TIMED_OUT if !handshake_reported => (
            0,
            CRYPTO_ERROR_HANDSHAKE_FAILURE,
            Some(b"handshake timed out".to_vec()),
        ),
        lsquic::LSCONN_ST_TIMED_OUT => (3, 0, None),
        lsquic::LSCONN_ST_VERNEG_FAILURE => (2, 0, None),
        lsquic::LSCONN_ST_RESET | lsquic::LSCONN_ST_HSK_FAILURE | lsquic::LSCONN_ST_ERROR => {
            (0, 1, Some(msg))
        }
        _ => (0, 0, None),
    }
}

lsquic_callback! {
    pub(super) fn on_conn_closed(session: &QuicSession) {
        // The conn's streams die with it — pending deferred aborts hold raw
        // lsquic stream pointers that are about to be freed.
        session.deferred_aborts.with_mut(Vec::clear);
        let conn = session.conn.get();
        if !conn.is_null() {
            let mut buf = [0 as c_char; CONN_STATUS_ERRBUF_LEN];
            // SAFETY: `conn` is live for the duration of this callback.
            let status = unsafe { lsquic::lsquic_conn_status(conn, buf.as_mut_ptr(), buf.len()) };
            // SAFETY: `buf` is NUL-terminated by lsquic.
            let msg = unsafe { core::ffi::CStr::from_ptr(buf.as_ptr()) }
                .to_bytes()
                .to_vec();
            session
                .final_conn_status
                .with_mut(|f| *f = Some((status, msg)));
        }
        session.push_event(SessionEvent::Closed);
        // The lsquic_conn is freed immediately after this callback returns.
        session.conn.set(null_mut());
    }

    pub(super) fn on_conncloseframe(
        session: &QuicSession,
        app_error: c_int,
        code: u64,
        reason: *const c_char,
        reason_len: c_int,
    ) {
        let reason = if reason.is_null() || reason_len <= 0 {
            Vec::new()
        } else {
            // SAFETY: lsquic guarantees `reason[..reason_len]` is valid for this
            // callback.
            unsafe {
                core::slice::from_raw_parts(reason.cast::<u8>(), reason_len as usize).to_vec()
            }
        };
        session.push_event(SessionEvent::PeerClose {
            app_error: app_error == 1,
            code,
            reason,
        });
    }
}

lsquic_callback! {
    /// The node-quic-accessors.patch makes lsquic pass the conn to
    /// `on_new_token` (upstream passes the engine-wide `enp_stream_if_ctx`,
    /// which would let one client session receive another's token). The shim
    /// recovers the per-conn QuicSession via `lsquic_conn_get_ctx`.
    pub(super) fn on_new_token(session: &QuicSession, t: *const u8, n: usize) {
        if t.is_null() || n == 0 {
            return;
        }
        // SAFETY: lsquic guarantees `t[..n]` is valid for this callback.
        let token = unsafe { core::slice::from_raw_parts(t, n).to_vec() };
        session.push_event(SessionEvent::NewToken(token));
    }

    pub(super) fn on_sess_resume(session: &QuicSession, b: *const u8, n: usize) {
        if b.is_null() || n == 0 {
            return;
        }
        // SAFETY: lsquic guarantees `b[..n]` is valid for this callback.
        let blob = unsafe { core::slice::from_raw_parts(b, n).to_vec() };
        session.push_event(SessionEvent::SessionResume(blob));
    }
}

lsquic_callback! {
    /// `lsquic_stream_if::on_dg_write` — fill `buf[..sz]` with the next queued
    /// datagram, return bytes written (0 to stop). lsquic calls this after
    /// `want_datagram_write(true)`; `es_rw_once` governs whether it loops.
    // -1, not 0: lsquic loops while the datagram writer keeps succeeding and
    // reads 0 as "wrote a 0-byte datagram", not "stop".
    pub(super) fn on_dg_write(session: &QuicSession, buf: *mut c_void, sz: usize) -> isize = -1; {
        if buf.is_null() {
            return 0;
        }
        let Some((id, len)) = session
            .datagram_queue
            .get()
            .front()
            .map(|(id, p)| (*id, p.len()))
        else {
            // lsquic loops `while (WANT_DG_WRITE && write_datagram())` and treats
            // a 0 return as a 0-byte datagram (not "stop"); -1 makes
            // `pf_gen_datagram_frame` return <0 so the loop exits.
            // SAFETY: the conn is live for this callback.
            if let Some(c) = unsafe { lsquic::Conn::from_raw(session.conn.get()) } {
                c.want_datagram_write(false);
            }
            return -1;
        };
        if len > sz {
            // `sz` is what's left in the packet lsquic is currently building, and
            // shrinks when ACK/STREAM frames landed first. Leave the datagram
            // queued and retry on a fresh packet instead of destroying it; only
            // abandon it when it could not fit an empty packet either.
            let max = session.with_state(|s| s.max_datagram_size) as usize;
            if max == 0 || len > max {
                session.datagram_queue.with_mut(VecDeque::pop_front);
                session.push_event(SessionEvent::DatagramStatus { id, sent: false });
                // SAFETY: the conn is live for this callback.
                if let Some(c) = unsafe { lsquic::Conn::from_raw(session.conn.get()) } {
                    c.want_datagram_write(!session.datagram_queue.get().is_empty());
                }
            }
            return -1;
        }
        let Some((id, payload)) = session.datagram_queue.with_mut(VecDeque::pop_front) else {
            return -1;
        };
        // SAFETY: lsquic guarantees `buf[..sz]` is writable for this callback.
        unsafe {
            core::ptr::copy_nonoverlapping(payload.as_ptr(), buf.cast::<u8>(), payload.len())
        };
        session.push_event(SessionEvent::DatagramStatus { id, sent: true });
        if !session.datagram_queue.get().is_empty() {
            // Re-arm for the rest of the queue.
            // SAFETY: the conn is live for this callback.
            if let Some(c) = unsafe { lsquic::Conn::from_raw(session.conn.get()) } {
                c.want_datagram_write(true);
            }
        }
        payload.len() as isize
    }

    /// `on_datagram_status` — a packet carrying `count` DATAGRAM frames was
    /// acknowledged (`acked != 0`) or declared lost.
    pub(super) fn on_datagram_status(session: &QuicSession, count: c_uint, acked: c_int) {
        if count == 0 {
            return;
        }
        session.push_event(SessionEvent::DatagramAckStatus {
            count,
            acked: acked != 0,
        });
    }

    pub(super) fn on_early_data_failed(session: &QuicSession) {
        session.push_event(SessionEvent::EarlyDataFailed);
    }

    pub(super) fn on_origin(session: &QuicSession, chunk: *const u8, len: usize, fin: c_int) {
        if !chunk.is_null() && len > 0 {
            // SAFETY: `chunk[..len]` is live for the duration of this callback.
            let bytes = unsafe { core::slice::from_raw_parts(chunk, len) };
            session.origin_buf.with_mut(|b| b.extend_from_slice(bytes));
        }
        if fin != 0 {
            let payload = session.origin_buf.with_mut(core::mem::take);
            session.push_event(SessionEvent::Origin(payload));
        }
    }

    pub(super) fn on_path_switch(
        session: &QuicSession,
        validated: c_int,
        is_preferred: c_int,
        new_local: *const lsquic::sockaddr,
        new_peer: *const lsquic::sockaddr,
        old_local: *const lsquic::sockaddr,
        old_peer: *const lsquic::sockaddr,
    ) {
        // The sockaddrs point into lsquic's path storage, live for this call.
        session.push_event(SessionEvent::PathValidation {
            validated: validated != 0,
            preferred: is_preferred != 0,
            new_local: super::endpoint::stored_addr_from_sockaddr(new_local),
            new_remote: super::endpoint::stored_addr_from_sockaddr(new_peer),
            old_local: super::endpoint::stored_addr_from_sockaddr(old_local),
            old_remote: super::endpoint::stored_addr_from_sockaddr(old_peer),
        });
    }

    pub(super) fn on_datagram(session: &QuicSession, buf: *const c_void, sz: usize) {
        if buf.is_null() {
            return;
        }
        // SAFETY: `buf[..sz]` is valid for this callback (lsquic owns the
        // packet buffer).
        let payload = unsafe { core::slice::from_raw_parts(buf.cast::<u8>(), sz).to_vec() };
        // The early flag is only valid during this callback — read it now.
        // SAFETY: `session.conn` is the live conn while this callback runs.
        let early = unsafe { lsquic::Conn::from_raw(session.conn.get()) }
            .is_some_and(|c| c.datagram_early());
        session.push_event(SessionEvent::Datagram { payload, early });
    }
}
