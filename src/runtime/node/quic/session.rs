//! Node's `internalBinding('quic').Session` analog (node/src/quic/session.{h,cc}).

use core::cell::Cell;
use core::ffi::{c_int, c_uint};
use std::collections::VecDeque;

use bun_jsc::bun_string_jsc;
use bun_jsc::{
    AliasedStruct, ArrayBuffer, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsRef,
    JsResult, StringJsc, Strong,
};
use bun_lsquic_sys as lsquic;
use bun_ptr::{BackRef, RefPtr, Root, ThisPtr};

use super::callbacks;
use super::endpoint::{MS_PER_SEC, QuicEndpoint, expose_state_buffers};
use super::now_ns;
use super::stream::{self, QuicStream};
use super::tls;

bun_core::declare_scope!(quic_session, hidden);

/// DATAGRAM frame overhead: type byte + 2-byte length varint (RFC 9221 §4).
const DATAGRAM_FRAME_OVERHEAD: u64 = 3;
const DATAGRAM_PAYLOAD_BUDGET: u64 = 1150;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS certificate_required(116).
const CRYPTO_ERROR_CERTIFICATE_REQUIRED: u64 = 0x0100 + 116;
/// QUIC CRYPTO_ERROR base (RFC 9001 §4.8) + TLS handshake_failure(40).
const CRYPTO_ERROR_HANDSHAKE_FAILURE: u64 = 0x0100 + 40;
const CRYPTO_ERROR_BAD_CERTIFICATE: u64 = 0x0100 + 42;

const LISTENER_FLAG_PATH_VALIDATION: u32 = 0x1;
const LISTENER_FLAG_DATAGRAM: u32 = 0x2;
const LISTENER_FLAG_DATAGRAM_STATUS: u32 = 0x4;
const LISTENER_FLAG_SESSION_TICKET: u32 = 0x8;
const LISTENER_FLAG_NEW_TOKEN: u32 = 0x10;
const LISTENER_FLAG_ORIGIN: u32 = 0x20;

/// RFC 9412 sec 2: each Origin-Entry is a 16-bit length prefix followed by
/// the ASCII origin.
const ORIGIN_LEN_PREFIX: usize = 2;
/// Ceiling on one ORIGIN frame's accumulated payload. The frame length is a
/// 62-bit varint, so without this a peer could grow the buffer unboundedly;
/// entries are `scheme://host:port`, so this holds far more than any real
/// server sends. A truncated trailing entry is dropped by the parser.
const MAX_ORIGIN_BYTES: usize = 64 * 1024;

/// Stream-id bit 1 selects the direction (RFC 9000 §2.1).
const STREAM_ID_UNI_BIT: u64 = 0x2;

/// HTTP/3 application error codes (RFC 9114 §8.1).
const H3_NO_ERROR: u64 = 0x100;
const H3_INTERNAL_ERROR: u64 = 0x102;

/// Node's DefaultApplication normalized option defaults
/// (node/src/quic/session.cc).
const DEFAULT_MAX_HEADER_PAIRS: u64 = 128;
const DEFAULT_MAX_HEADER_LENGTH: u64 = 16384;

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
const IDX_STATS_SESSION_PING_RECV: usize = 33;

pub(super) use lsquic::{SOCKADDR_IN_LEN, SOCKADDR_IN6_LEN};

/// Identifies a session in its endpoint's lists.
pub(super) type Id = u32;

fn next_id() -> Id {
    static NEXT: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(1);
    NEXT.fetch_add(1, core::sync::atomic::Ordering::Relaxed)
}

/// BSD-style sockaddrs keep `sa_len` in byte 0 and a one-byte family in
/// byte 1; Linux/Windows keep a two-byte family at byte 0.
const BSD_SOCKADDR: bool = cfg!(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "ios"
));

/// A copied sockaddr — the bytes are an in-place `sockaddr_in[6]` so the same
/// value works for both lsquic (`struct sockaddr*`) and the uSockets UDP
/// send. Both read `sockaddr_in6`'s 2- and 4-byte fields through that
/// pointer, so the buffer carries sockaddr alignment.
#[repr(C, align(8))]
#[derive(Copy, Clone, Default)]
pub struct StoredAddr {
    sa: lsquic::SockAddr,
    len: u8,
}

impl StoredAddr {
    fn family_of(sa: &lsquic::SockAddr) -> u16 {
        if BSD_SOCKADDR {
            sa.bytes[1] as u16
        } else {
            u16::from_ne_bytes([sa.bytes[0], sa.bytes[1]])
        }
    }

    /// Copy an address sized by its family (sockaddr_in = 16, sockaddr_in6
    /// = 28), zeroing the tail.
    pub(super) fn from_lsquic(sa: &lsquic::SockAddr) -> Self {
        use crate::socket::socket_address::inet;
        let len = if Self::family_of(sa) == inet::AF_INET6 as u16 {
            SOCKADDR_IN6_LEN
        } else {
            SOCKADDR_IN_LEN
        };
        let mut out = Self::default();
        out.sa.bytes[..len].copy_from_slice(&sa.bytes[..len]);
        out.len = len as u8;
        out
    }

    /// Copy all `sockaddr_in6`-sized bytes lsquic keeps for an address.
    pub(super) fn from_lsquic_full(sa: &lsquic::SockAddr) -> Self {
        StoredAddr {
            sa: *sa,
            len: SOCKADDR_IN6_LEN as u8,
        }
    }

    fn encode(family: u16, port: u16, ip: &[u8], flowinfo: u32, scope_id: u32) -> Self {
        let mut out = Self::default();
        let len = if ip.len() == 16 {
            SOCKADDR_IN6_LEN
        } else {
            SOCKADDR_IN_LEN
        };
        let b = &mut out.sa.bytes;
        if BSD_SOCKADDR {
            b[0] = len as u8;
            b[1] = family as u8;
        } else {
            b[0..2].copy_from_slice(&family.to_ne_bytes());
        }
        b[2..4].copy_from_slice(&port.to_be_bytes());
        if ip.len() == 16 {
            b[4..8].copy_from_slice(&flowinfo.to_ne_bytes());
            b[8..24].copy_from_slice(ip);
            b[24..28].copy_from_slice(&scope_id.to_ne_bytes());
        } else {
            b[4..8].copy_from_slice(ip);
        }
        out.len = len as u8;
        out
    }

    pub(super) fn from_socket_address(addr: &crate::socket::SocketAddress) -> Self {
        use crate::socket::socket_address::inet;
        if let Some(sin) = addr._addr.as_sin() {
            Self::encode(
                inet::AF_INET as u16,
                u16::from_be(sin.port),
                &sin.addr.to_ne_bytes(),
                0,
                0,
            )
        } else if let Some(sin6) = addr._addr.as_sin6() {
            Self::encode(
                inet::AF_INET6 as u16,
                u16::from_be(sin6.port),
                &sin6.addr,
                sin6.flowinfo,
                sin6.scope_id,
            )
        } else {
            Self::default()
        }
    }
    pub(super) fn as_sockaddr(&self) -> &lsquic::SockAddr {
        &self.sa
    }
    /// For `us_udp_socket_send`'s address array.
    pub(super) fn as_sockaddr_ptr(&self) -> *const core::ffi::c_void {
        core::ptr::from_ref(&self.sa).cast()
    }
    pub(super) fn is_set(&self) -> bool {
        self.len > 0
    }
    pub(super) fn decode(&self) -> Option<(u16, u16, &[u8])> {
        use crate::socket::socket_address::inet;
        if self.len == 0 {
            return None;
        }
        let family = Self::family_of(&self.sa);
        let bytes = &self.sa.bytes;
        let port = u16::from_be_bytes([bytes[2], bytes[3]]);
        if family == inet::AF_INET as u16 && self.len as usize >= SOCKADDR_IN_LEN {
            Some((family, port, &bytes[4..8]))
        } else if family == inet::AF_INET6 as u16 && self.len as usize >= SOCKADDR_IN6_LEN {
            Some((family, port, &bytes[8..24]))
        } else {
            None
        }
    }
    pub(super) fn to_socket_address(&self) -> Option<crate::socket::SocketAddress> {
        use crate::socket::SocketAddress;
        use crate::socket::socket_address::inet;
        let (family, port, addr) = self.decode()?;
        Some(if family == inet::AF_INET as u16 {
            SocketAddress::init_ipv4([addr[0], addr[1], addr[2], addr[3]], port)
        } else {
            let mut ip = [0u8; 16];
            ip.copy_from_slice(addr);
            SocketAddress::init_ipv6(ip, port, 0, 0)
        })
    }
    pub(super) fn to_js_socket_address(&self, global: &JSGlobalObject) -> JSValue {
        use bun_jsc::JsClass;
        match self.to_socket_address() {
            Some(socket_address) => socket_address.to_js(global),
            None => JSValue::UNDEFINED,
        }
    }
}

bun_jsc::aliased_struct! {
    /// Mirrors Node's `Session::State` (`SESSION_STATE` in session.cc). The
    /// `IDX_STATE_SESSION_*` constants on the binding are `offset_of!` values
    /// into this struct, so the layout must stay in sync with what the JS
    /// layer reads (`src/js/internal/quic/state.ts`).
    pub struct SessionState {
        pub(crate) listener_flags: u32,
        pub(crate) closing: u8,
        pub(crate) graceful_close: u8,
        pub(crate) silent_close: u8,
        pub(crate) stateless_reset: u8,
        pub(crate) handshake_completed: u8,
        pub(crate) handshake_confirmed: u8,
        pub(crate) stream_open_allowed: u8,
        pub(crate) priority_supported: u8,
        pub(crate) headers_supported: u8,
        pub(crate) wrapped: u8,
        pub(crate) application_type: u8,
        pub(crate) no_error_code: u64,
        pub(crate) internal_error_code: u64,
        pub(crate) max_datagram_size: u16,
        pub(crate) last_datagram_id: u64,
        pub(crate) max_pending_datagrams: u16,
    }
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
type SessionStats = [Cell<u64>; SESSION_STATS_FIELDS.len()];

pub(super) struct HskSnapshot {
    sni: Option<Vec<u8>>,
    cipher: Option<Vec<u8>>,
    alpn: Option<Vec<u8>>,
    /// `(code name, reason)`, as node reports them.
    validation: Option<(&'static str, &'static str)>,
    peer_cert_der: Option<Vec<u8>>,
    local_cert_der: Option<Vec<u8>>,
    ephemeral: Option<(&'static str, Option<&'static str>, u32)>,
    /// `(early_data_attempted, early_data_accepted)` (RFC 8446 §2.3).
    early_data: (bool, bool),
}

pub(super) struct DeferredAbort {
    /// Alive until the conn dies (entries are cleared first) and only ever
    /// passed back to lsquic.
    ls: lsquic::Stream,
    reset: Option<u64>,
    stop: Option<u64>,
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
    StreamReady {
        stream: stream::Key,
        remote: bool,
    },
    StreamWake {
        stream: stream::Key,
    },
    StreamDrain {
        stream: stream::Key,
    },
    StreamBlocked {
        stream: stream::Key,
    },
    StreamReset {
        stream: stream::Key,
        code: u64,
    },
    StreamStopSending {
        stream: stream::Key,
        code: u64,
    },
    StreamWantsTrailers {
        stream: stream::Key,
    },
    StreamHeaders {
        stream: stream::Key,
        pairs: Vec<Vec<u8>>,
        kind: u32,
    },
    NewToken(Vec<u8>),
    Keylog(Vec<u8>),
    SessionResume(Vec<u8>),
    StreamClosed {
        stream: stream::Key,
    },
    HandshakeConfirmed,
    GoawayReceived,
    Datagram {
        payload: Vec<u8>,
        early: bool,
    },
    DatagramStatus {
        id: u64,
        sent: bool,
    },
    DatagramAckStatus {
        count: u32,
        acked: bool,
    },
    EarlyDataFailed,
    /// HTTP/3 ORIGIN frame payload (RFC 9412).
    Origin(Vec<u8>),
    /// Version Negotiation packet (RFC 8999 sec 6).
    VersionNegotiation {
        server_versions: Vec<u32>,
    },
    PathValidation {
        validated: bool,
        preferred: bool,
        new_local: StoredAddr,
        new_remote: StoredAddr,
        old_local: StoredAddr,
        old_remote: StoredAddr,
    },
}

#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct QuicSession {
    ref_count: Cell<u32>,
    self_ref: Cell<BackRef<QuicSession, Root>>,
    id: Id,
    /// The attached lsquic conn; its context holds a ref on this session
    /// until `on_conn_closed` or `teardown` releases it.
    pub(super) conn: Cell<Option<lsquic::Conn>>,
    /// The owning endpoint; released in `teardown`.
    endpoint: JsCell<Option<RefPtr<QuicEndpoint>>>,
    endpoint_js: JsCell<Option<Strong>>,
    is_server: Cell<bool>,
    local_addr: Cell<StoredAddr>,
    pub(super) remote_addr: Cell<StoredAddr>,
    state: AliasedStruct<SessionState>,
    stats: AliasedStruct<SessionStats>,
    events: JsCell<Vec<SessionEvent>>,
    origin_buf: JsCell<Vec<u8>>,
    deferred_aborts: JsCell<Vec<DeferredAbort>>,
    write_marker: Cell<u64>,
    /// A graceful close requested while a dispatch was on the stack: applied
    /// on the next depth-0 pass so its GOAWAY/CONNECTION_CLOSE does not share
    /// a flight with data written by the same dispatch (node's close lands an
    /// RTT after the data because its stream close is ack-gated).
    pending_graceful: JsCell<Option<(bool, u64, Vec<u8>)>>,
    pub(super) verneg: Cell<Option<(u32, u32)>>,
    peer_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    self_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    datagram_drop_newest: Cell<bool>,
    qlog_enabled: Cell<bool>,
    qlog_fin_sent: Cell<bool>,
    datagram_queue: JsCell<VecDeque<(u64, Vec<u8>)>>,
    /// Monotonic id assigned by `sendDatagram` (Node returns it as a BigInt).
    next_datagram_id: Cell<u64>,
    inflight_datagrams: JsCell<VecDeque<u64>>,
    ticket_delivered: Cell<bool>,
    pending_tickets: JsCell<VecDeque<(u64, Vec<u8>)>>,
    close_after_streams: Cell<bool>,
    final_conn_status: JsCell<Option<(c_int, Vec<u8>)>>,
    /// Positional FIFOs lsquic fulfils in order; `None` is the tombstone
    /// `remove_stream` leaves for a request that went away.
    pending_local_bidi: JsCell<VecDeque<Option<stream::Key>>>,
    pending_local_uni: JsCell<VecDeque<Option<stream::Key>>>,
    /// Every stream this session owns; each entry holds a ref.
    streams: JsCell<Vec<RefPtr<QuicStream>>>,
    handshake_reported: Cell<bool>,
    new_token_reported: Cell<bool>,
    close_when_bound: Cell<bool>,
    deferred_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    handshake_pending_ok: Cell<bool>,
    reject_unverified_peer: Cell<bool>,
    peer_cert_rejected: Cell<bool>,
    hsk_snapshot: JsCell<Option<HskSnapshot>>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
    application_options_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    global: GlobalRef,
}

impl QuicSession {
    fn new(global: &JSGlobalObject, endpoint: ThisPtr<QuicEndpoint>, is_server: bool) -> Self {
        Self {
            ref_count: Cell::new(1),
            self_ref: Cell::new(BackRef::dangling()),
            id: next_id(),
            conn: Cell::new(None),
            endpoint: JsCell::new(Some(RefPtr::from_this(endpoint))),
            endpoint_js: JsCell::new(None),
            is_server: Cell::new(is_server),
            local_addr: Cell::new(StoredAddr::default()),
            remote_addr: Cell::new(StoredAddr::default()),
            state: AliasedStruct::zeroed(),
            stats: AliasedStruct::zeroed(),
            events: JsCell::new(Vec::new()),
            origin_buf: JsCell::new(Vec::new()),
            deferred_aborts: JsCell::new(Vec::new()),
            write_marker: Cell::new(0),
            pending_graceful: JsCell::new(None),
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
            pending_local_bidi: JsCell::new(VecDeque::new()),
            pending_local_uni: JsCell::new(VecDeque::new()),
            streams: JsCell::new(Vec::new()),
            handshake_reported: Cell::new(false),
            new_token_reported: Cell::new(false),
            close_when_bound: Cell::new(false),
            deferred_close: JsCell::new(None),
            handshake_pending_ok: Cell::new(false),
            reject_unverified_peer: Cell::new(true),
            peer_cert_rejected: Cell::new(false),
            hsk_snapshot: JsCell::new(None),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
            application_options_js: JsCell::new(None),
            this_value: JsCell::new(JsRef::empty()),
            global: GlobalRef::new(global),
        }
    }

    /// Returns one ref for the caller alongside the JS handle (which owns
    /// another, released by finalize).
    pub(super) fn create(
        global: &JSGlobalObject,
        endpoint: ThisPtr<QuicEndpoint>,
        endpoint_handle: JSValue,
        conn: Option<lsquic::Conn>,
        is_server: bool,
    ) -> JsResult<(RefPtr<QuicSession>, JSValue)> {
        let created = RefPtr::new(Self::new(global, endpoint, is_server));
        created.self_ref.set(BackRef::from(created.this_ptr()));
        let session = created.clone();
        let handle = Self::to_js_nonnull(created.as_non_null(), global);
        let _ = RefPtr::into_raw(created);

        expose_state_buffers(global, handle, &session.state, &session.stats)?;
        session.state.no_error_code.set(0);
        session.state.internal_error_code.set(1);
        session.state.stream_open_allowed.set(1);
        session.state.headers_supported.set(0);
        session.conn.set(conn);
        session
            .endpoint_js
            .set(Some(Strong::create(endpoint_handle, global)));
        session
            .this_value
            .with_mut(|r| r.set_strong(handle, global));
        session.write_stat(IDX_STATS_SESSION_CREATED_AT, now_ns());
        if let Some(conn) = conn {
            session.cache_sockaddrs(conn);
        }
        Ok((session, handle))
    }

    pub(super) fn id(&self) -> Id {
        self.id
    }
    fn this_ptr(&self) -> ThisPtr<QuicSession> {
        self.self_ref.get().this_ptr()
    }

    pub(super) fn bind_conn(&self, conn: lsquic::Conn) {
        self.conn.set(Some(conn));
        if let Some(ep) = self.endpoint_ref() {
            let lines = conn
                .with_ssl(|ssl| ep.take_early_keylog(ssl))
                .unwrap_or_default();
            for line in lines {
                self.push_event(SessionEvent::Keylog(line));
            }
        }
        self.cache_sockaddrs(conn);
        if self.close_when_bound.get() {
            // Carry the user's {type, code, reason} through rather than
            // sending a bare close.
            if let Some((app, code, reason)) = self.pending_graceful.with_mut(Option::take) {
                self.apply_graceful_close(app, code, reason);
            }
        }
    }

    pub(super) fn cache_sockaddrs(&self, conn: lsquic::Conn) {
        if let Some((local, peer)) = conn.sockaddrs() {
            self.local_addr.set(StoredAddr::from_lsquic_full(&local));
            self.remote_addr.set(StoredAddr::from_lsquic_full(&peer));
        }
    }

    fn has_listener(&self, flag: u32) -> bool {
        self.state.listener_flags.get() & flag != 0
    }
    fn add_stat(&self, idx: usize, delta: u64) {
        if let Some(slot) = self.stats.get(idx) {
            slot.set(slot.get().wrapping_add(delta));
        }
    }
    fn write_stat(&self, idx: usize, value: u64) {
        if let Some(slot) = self.stats.get(idx) {
            slot.set(value);
        }
    }
    pub(super) fn handle(&self) -> JSValue {
        self.this_value.get().get()
    }
    pub(super) fn apply_options(&self, global: &JSGlobalObject, options: JSValue) -> JsResult<()> {
        if !options.is_object() {
            return Ok(());
        }
        if let Some(v) = options
            .get(global, "datagramDropPolicy")?
            .filter(|v| v.is_string())
        {
            self.datagram_drop_newest
                .set(bun_core::String::from_js(v, global)?.to_owned_slice() == b"drop-newest");
        }
        if let Some(v) = options.get(global, "qlog")? {
            self.qlog_enabled.set(v.to_boolean());
        }
        if let Some(v) = options.get(global, "verifyPeer")?.filter(|v| v.is_string()) {
            self.reject_unverified_peer
                .set(bun_core::String::from_js(v, global)?.to_owned_slice() != b"manual");
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
    /// The owning endpoint while attached (until `teardown`); the ref this
    /// session holds keeps it live.
    fn endpoint_ref(&self) -> Option<ThisPtr<QuicEndpoint>> {
        self.endpoint.get().as_ref().map(RefPtr::this_ptr)
    }
    pub(super) fn schedule_process(&self) {
        if let Some(ep) = self.endpoint_ref() {
            ep.schedule_process();
        }
    }
    pub(super) fn note_stream_write(&self) {
        self.write_marker
            .set(self.write_marker.get().wrapping_add(1));
    }
    pub(super) fn defer_stream_abort(
        &self,
        ls: lsquic::Stream,
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
    /// The lsquic stream is about to be freed; its queued abort can no longer
    /// be applied.
    pub(super) fn forget_deferred_abort(&self, ls: lsquic::Stream) {
        self.deferred_aborts.with_mut(|v| v.retain(|e| e.ls != ls));
    }
    pub(super) fn has_deferred_abort(&self, ls: lsquic::Stream) -> bool {
        self.deferred_aborts.get().iter().any(|e| e.ls == ls)
    }
    pub(super) fn flush_deferred_aborts(&self) {
        if self.deferred_aborts.get().is_empty() {
            return;
        }
        let entries = self.deferred_aborts.with_mut(core::mem::take);
        if self.conn.get().is_none() {
            return;
        }
        let marker = self.write_marker.get();
        for e in entries {
            let s = e.ls;
            if e.marker != marker {
                // Node parity — the queued frames are dropped.
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
    pub(super) fn take_pending_local_stream(&self, uni: bool) -> Option<ThisPtr<QuicStream>> {
        let queue = if uni {
            &self.pending_local_uni
        } else {
            &self.pending_local_bidi
        };
        // Skip the tombstones `remove_stream` leaves: stopping at the first
        // one would strand the live request behind it until the next
        // MAX_STREAMS grant.
        while let Some(slot) = queue.with_mut(VecDeque::pop_front) {
            if let Some(stream) = slot.and_then(|key| self.live_stream(key)) {
                return Some(stream);
            }
        }
        None
    }
    /// Drops `stream` from the registry (releasing its ref) and tombstones
    /// its pending-open slot.
    pub(super) fn remove_stream(&self, stream: stream::Key) {
        self.release_stream(stream);
        for queue in [&self.pending_local_bidi, &self.pending_local_uni] {
            queue.with_mut(|v| {
                for slot in v.iter_mut() {
                    if *slot == Some(stream) {
                        *slot = None;
                    }
                }
            });
        }
    }
    fn release_stream(&self, stream: stream::Key) {
        let removed = self.streams.with_mut(|v| {
            v.iter()
                .position(|s| s.key() == stream)
                .map(|i| v.remove(i))
        });
        drop(removed);
    }
    fn bump_stream_stat(&self, id: u64, local: bool) {
        let idx = match (id & STREAM_ID_UNI_BIT != 0, local) {
            (false, false) => IDX_STATS_SESSION_BIDI_IN_STREAM_COUNT,
            (false, true) => IDX_STATS_SESSION_BIDI_OUT_STREAM_COUNT,
            (true, false) => IDX_STATS_SESSION_UNI_IN_STREAM_COUNT,
            (true, true) => IDX_STATS_SESSION_UNI_OUT_STREAM_COUNT,
        };
        self.add_stat(idx, 1);
    }

    /// Returns the ref lsquic's stream context will hold.
    fn on_remote_stream(&self, raw: lsquic::Stream) -> Option<RefPtr<QuicStream>> {
        let global: &JSGlobalObject = &self.global;
        match QuicStream::create(global, self.this_ptr(), self.handle(), Some(raw)) {
            Ok((qs, _handle)) => {
                self.streams.with_mut(|v| v.push(qs.clone()));
                qs.mark_wrote_to_lsquic();
                self.bump_stream_stat(raw.id(), false);
                self.push_event(SessionEvent::StreamReady {
                    stream: qs.key(),
                    remote: true,
                });
                if let Some(code) = qs.pre_reset_code() {
                    self.push_event(SessionEvent::StreamReset {
                        stream: qs.key(),
                        code,
                    });
                }
                Some(qs)
            }
            Err(e) => {
                crate::dispatch::fold(Err(e));
                None
            }
        }
    }

    fn refresh_conn_stats(&self) {
        let Some(conn) = self.conn.get() else {
            return;
        };
        let Some(info) = conn.info() else {
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
        self.write_stat(IDX_STATS_SESSION_SMOOTHED_RTT, us_to_ns(info.rtt));
        self.write_stat(IDX_STATS_SESSION_PKT_SENT, info.pkts_sent);
        self.write_stat(IDX_STATS_SESSION_PKT_RECV, info.pkts_rcvd);
        self.write_stat(IDX_STATS_SESSION_PKT_LOST, info.pkts_lost);
        self.write_stat(IDX_STATS_SESSION_BYTES_RECV, info.bytes_rcvd);
        self.write_stat(IDX_STATS_SESSION_PING_RECV, conn.pings_received());
    }

    /// A stream still in the `streams` registry, whose entry holds a ref.
    fn live_stream(&self, key: stream::Key) -> Option<ThisPtr<QuicStream>> {
        self.streams
            .get()
            .iter()
            .find(|s| s.key() == key)
            .map(RefPtr::this_ptr)
    }
    fn stream_keys(&self) -> Vec<stream::Key> {
        self.streams.get().iter().map(|s| s.key()).collect()
    }

    pub(super) fn apply_peer_datagram_budget(&self) {
        let Some(tp) = self.conn.get().and_then(|c| c.peer_transport_params()) else {
            return;
        };
        let sz = tp
            .max_datagram_frame_size
            .saturating_sub(DATAGRAM_FRAME_OVERHEAD)
            .min(DATAGRAM_PAYLOAD_BUDGET) as u16;
        self.state.max_datagram_size.set(sz);
    }

    fn deliver_pending_tickets(&self, global: &JSGlobalObject) {
        if self.pending_tickets.get().is_empty() {
            return;
        }
        if self.destroyed.get() || self.close_reported.get() || self.state.graceful_close.get() != 0
        {
            self.pending_tickets.with_mut(VecDeque::clear);
            return;
        }
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
            let buf = ArrayBuffer::create_buffer(global, &blob).or_report();
            if let Some(cb) = callbacks::get(global, "onSessionTicket") {
                let vm = global.bun_vm().as_mut();
                vm.event_loop_ref()
                    .run_callback(cb, global, self.handle(), &[buf]);
            }
        }
        if !self.pending_tickets.get().is_empty() {
            self.schedule_process();
        }
    }

    pub(super) fn process_events(&self, global: &JSGlobalObject) {
        self.refresh_conn_stats();
        // Every callback below can run user JS that destroys this session
        // (dropping the wrapper Strong) and can trigger GC, so hold a Strong
        // for the duration -- `deliver_pending_tickets` touches `self` after.
        let _keep_alive = Strong::create(self.handle(), global);
        self.deliver_pending_tickets(global);
        // node leaves a microtask window between a session's lifecycle events
        // and its close; the loop driver can batch a whole exchange into one
        // pass, so a Closed behind other dispatch is deferred one turn.
        let mut dispatched_js = false;
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
            let defer_closes = self.endpoint_ref().is_some_and(|ep| ep.defer_closes.get());
            if (dispatched_js || defer_closes)
                && matches!(event, SessionEvent::Closed | SessionEvent::GoawayReceived)
            {
                self.events.with_mut(|e| e.insert(0, event));
                self.schedule_process();
                break;
            }
            if !matches!(event, SessionEvent::PeerClose { .. } | SessionEvent::Closed) {
                dispatched_js = true;
            }
            if self.destroyed.get() {
                break;
            }
            if let Err(err) = self.dispatch_event(global, event) {
                // This drain is the events' dispatcher: reported, and the drain
                // goes on (that event is lost); the VM's stop ends it.
                if bun_jsc::task::report_error_or_terminate(global, err).is_err() {
                    break;
                }
            }
        }
    }

    /// One queued event's delivery. A value that cannot be built for its
    /// callback (allocation failure, a terminating VM) is the `Err`, folded by
    /// the drain in [`Self::process_events`]; the callbacks themselves are
    /// top-level calls (`run_callback`).
    fn dispatch_event(&self, global: &JSGlobalObject, event: SessionEvent) -> JsResult<()> {
        match event {
            SessionEvent::HandshakeDone { ok } => {
                if ok {
                    self.capture_hsk_snapshot();
                    if self.is_server.get() || self.peer_verification_refused() {
                        // Node's server reports at handshake COMPLETION
                        // (session.cc: server completion == confirmation
                        // per RFC 9001 §4.1.2).
                        self.maybe_report_handshake(global, true);
                    } else {
                        // Node's client `opened` settles only for
                        // connections the server actually accepted.
                        self.handshake_pending_ok.set(true);
                    }
                } else {
                    self.maybe_report_handshake(global, false);
                }
            }
            SessionEvent::HandshakeConfirmed => {
                self.state.handshake_confirmed.set(1);
                if self.handshake_pending_ok.get() {
                    let close_wins = self.streams.get().is_empty()
                        && self.events.with_mut(|e| {
                            for ev in e.iter() {
                                match ev {
                                    SessionEvent::StreamReady { .. }
                                    | SessionEvent::Datagram { .. } => return false,
                                    // A refusal means never accepted, so
                                    // `opened` must not settle; a clean
                                    // close reports the handshake first.
                                    SessionEvent::PeerClose {
                                        app_error, code, ..
                                    } => {
                                        return !*app_error && *code != 0;
                                    }
                                    SessionEvent::Closed => return true,
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
                    return Ok(());
                };
                // A remote stream that arrives already-reset while this
                // session's close is in the same batch must never be
                // surfaced (Node's onstream count excludes it).
                if remote && self.conn.get().is_none() && stream.pre_reset_code().is_some() {
                    stream.suppress_announce();
                    return Ok(());
                }
                if remote && self.peer_cert_rejected.get() {
                    stream.suppress_announce();
                    return Ok(());
                }
                // Already closing: the CONNECTION_CLOSE precedes this
                // stream's packet and a closing endpoint discards new
                // streams (RFC 9000 s10.2.1). Raw QUIC only.
                if remote
                    && self.state.graceful_close.get() == 1
                    && !self
                        .endpoint_ref()
                        .map(|ep| ep.is_http(self.is_server.get()))
                        .unwrap_or(false)
                {
                    stream.suppress_announce();
                    stream.close_raw_silently();
                    return Ok(());
                }
                if remote && stream.is_announce_suppressed() {
                    return Ok(());
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
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &token)?;
                if let Some(cb) = callbacks::get(global, "onSessionNewToken") {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref()
                        .run_callback(cb, global, self.handle(), &[buf]);
                }
            }
            SessionEvent::Keylog(line) => {
                let s = bun_string_jsc::create_utf8_for_js(global, &line)?;
                if let Some(cb) = callbacks::get(global, "onSessionKeyLog") {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref()
                        .run_callback(cb, global, self.handle(), &[s]);
                }
            }
            SessionEvent::SessionResume(blob) => {
                if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                    return Ok(());
                }
                if self.ticket_delivered.replace(true) {
                    self.pending_tickets
                        .with_mut(|q| q.push_back((now_ns() + TICKET_DELIVERY_DELAY_NS, blob)));
                    self.schedule_process();
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &blob)?;
                if let Some(cb) = callbacks::get(global, "onSessionTicket") {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref()
                        .run_callback(cb, global, self.handle(), &[buf]);
                }
            }
            SessionEvent::StreamReset { stream, code } => {
                let Some(stream) = self
                    .live_stream(stream)
                    .filter(|s| s.wants_reset() && !s.is_announce_suppressed())
                else {
                    return Ok(());
                };
                let handle = stream.handle();
                let err = make_application_error(global, code)?;
                {
                    if let Some(cb) = callbacks::get(global, "onStreamReset") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(cb, global, handle, &[err]);
                    }
                }
            }
            SessionEvent::GoawayReceived => {
                // lsquic doesn't surface the GOAWAY stream-id; Node
                // reports -1n when the id is unavailable.
                let last_stream_id = JSValue::from_int64_no_truncate(global, -1)?;
                if let Some(cb) = callbacks::get(global, "onSessionGoaway") {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref()
                        .run_callback(cb, global, self.handle(), &[last_stream_id]);
                }
            }
            SessionEvent::StreamWantsTrailers { stream } => {
                let Some(stream) = self.live_stream(stream) else {
                    return Ok(());
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
                let Some(stream) = self.live_stream(stream).filter(|s| s.wants_headers()) else {
                    return Ok(());
                };
                let handle = stream.handle();
                // Latin-1, as node does for HTTP headers. Allocate inside
                // the closure: a collected `Vec<JSValue>` is not GC-scanned,
                // so early strings would be collectible.
                let js_arr = JSValue::create_array_from_iter(global, pairs.iter(), |s| {
                    bun_core::String::clone_latin1(s).into_js(global)
                });
                let js_arr = js_arr?;
                {
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
                    return Ok(());
                };
                let handle = stream.handle();
                if let Some(cb) = callbacks::get(global, "onStreamDrain") {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref().run_callback(cb, global, handle, &[]);
                }
            }
            SessionEvent::StreamBlocked { stream } => {
                let Some(stream) = self.live_stream(stream).filter(|s| s.wants_block()) else {
                    return Ok(());
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
                    return Ok(());
                };
                if let Some(wakeup) = stream.take_wakeup() {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref()
                        .run_callback(wakeup.get(), global, JSValue::UNDEFINED, &[]);
                }
            }
            SessionEvent::Datagram { payload, early } => {
                self.add_stat(IDX_STATS_SESSION_DATAGRAMS_RECEIVED, 1);
                if !self.has_listener(LISTENER_FLAG_DATAGRAM) || self.peer_cert_rejected.get() {
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &payload)?;
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
                    self.inflight_datagrams.with_mut(|q| q.push_back(id));
                    return Ok(());
                }
                if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
                    return Ok(());
                }
                let id_js = JSValue::from_uint64_no_truncate(global, id)?;
                let status_js = global.common_strings().quic_datagram_abandoned();
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
                // Node parity: their `closed` promises reject with an
                // application error.
                let code = match self.state.internal_error_code.get() {
                    0 => 1,
                    c => c,
                };
                for key in self.stream_keys() {
                    if let Some(stream) = self.live_stream(key) {
                        stream.cancel_early_rejected(code);
                    }
                }
            }
            SessionEvent::DatagramAckStatus { count, acked } => {
                let status_js = if acked {
                    global.common_strings().quic_datagram_acknowledged()
                } else {
                    global.common_strings().quic_datagram_lost()
                };
                // Every acknowledged/lost datagram is popped and counted even
                // when its status cannot be delivered.
                let mut undelivered = Ok(());
                for _ in 0..count {
                    let Some(id) = self.inflight_datagrams.with_mut(VecDeque::pop_front) else {
                        break;
                    };
                    if acked {
                        self.add_stat(IDX_STATS_SESSION_DATAGRAMS_ACKNOWLEDGED, 1);
                    } else {
                        self.add_stat(IDX_STATS_SESSION_DATAGRAMS_LOST, 1);
                    }
                    if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) || undelivered.is_err() {
                        continue;
                    }
                    let id_js = match JSValue::from_uint64_no_truncate(global, id) {
                        Ok(id_js) => id_js,
                        Err(err) => {
                            undelivered = Err(err);
                            continue;
                        }
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
                undelivered?;
            }
            SessionEvent::VersionNegotiation { server_versions } => {
                let Some((requested, min)) = self.verneg.get() else {
                    return Ok(());
                };
                let requested_arr =
                    JSValue::create_array_from_iter(global, server_versions.into_iter(), |v| {
                        Ok(JSValue::js_number(v as f64))
                    })?;
                // Node passes the locally-configured range as
                // `[min_version, version]` (session.cc
                // EmitVersionNegotiation).
                let supported_arr =
                    JSValue::create_array_from_iter(global, [min, requested].into_iter(), |v| {
                        Ok(JSValue::js_number(v as f64))
                    })?;
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
                    return Ok(());
                }
                // Collect ranges, not JSValues: a `Vec<JSValue>` lives on the
                // Rust heap, which the GC does not scan, so strings created
                // early would be collectible while later ones allocate.
                let mut ranges: Vec<(usize, usize)> = Vec::new();
                let mut off = 0usize;
                while off + ORIGIN_LEN_PREFIX <= payload.len() {
                    let n = u16::from_be_bytes([payload[off], payload[off + 1]]) as usize;
                    off += ORIGIN_LEN_PREFIX;
                    if off + n > payload.len() {
                        break;
                    }
                    ranges.push((off, n));
                    off += n;
                }
                let array =
                    JSValue::create_array_from_iter(global, ranges.into_iter(), |(o, n)| {
                        bun_string_jsc::create_utf8_for_js(global, &payload[o..o + n])
                    })?;
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
                    return Ok(());
                }
                // Node reports 'aborted' when the path switched without
                // completing validation (a non-probing packet arrived on
                // the new path first); 'failure' is never produced here.
                let result = if validated {
                    b"success".as_slice()
                } else {
                    b"aborted".as_slice()
                };
                let result_js = bun_core::String::static_(result).to_js(global)?;
                // Node passes each fact only from the side that owns it:
                // the server knows the previous path, the client knows it
                // migrated to the preferred address.
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
                    return Ok(());
                };
                stream.apply_peer_stop_sending(code);
            }
            SessionEvent::StreamClosed { stream: key } => {
                let Some(stream) = self.live_stream(key) else {
                    return Ok(());
                };
                let _keep = RefPtr::from_this(stream);
                if stream.mark_close_reported() {
                    return Ok(());
                }
                // A suppressed stream was never surfaced to JS, so it gets
                // no onStreamClose -- but it still has to leave `streams`
                // and drop its self-root, or it lives until teardown.
                if stream.is_announce_suppressed() {
                    self.release_stream(key);
                    stream.release_close_root();
                    return Ok(());
                }
                // Runs the parked reader wakeup — user JS, which may destroy
                // this stream. Re-check before any further use;
                // `mark_close_reported` above already fired.
                stream.end_read_side(global);
                if self.live_stream(key).is_none() {
                    return Ok(());
                }
                let handle = stream.handle();
                if let Some(cb) = callbacks::get(global, "onStreamClose") {
                    let vm = global.bun_vm().as_mut();
                    vm.event_loop_ref()
                        .run_callback(cb, global, handle, &[JSValue::UNDEFINED]);
                }
                // onStreamClose is user JS too: re-check before the
                // `release_close_root` below, as above.
                if self.live_stream(key).is_none() {
                    return Ok(());
                }
                self.release_stream(key);
                // Nothing else reaches this stream now, so drop the self-root.
                stream.release_close_root();
            }
        }
        Ok(())
    }

    fn maybe_report_handshake(&self, global: &JSGlobalObject, ok: bool) {
        if self.handshake_reported.replace(true) || self.destroyed.get() {
            return;
        }
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
        if !cert_ok {
            self.peer_cert_rejected.set(true);
        }
        let open_allowed = ok && !self.peer_cert_rejected.get();
        let peer_frame_size = match self.conn.get() {
            Some(conn) if ok => conn
                .peer_transport_params()
                .map(|tp| tp.max_datagram_frame_size)
                .unwrap_or(0),
            _ => 0,
        };
        self.state.handshake_completed.set(ok as u8);
        self.state.handshake_confirmed.set(ok as u8);
        self.state.stream_open_allowed.set(open_allowed as u8);
        self.state.max_datagram_size.set(
            peer_frame_size
                .saturating_sub(DATAGRAM_FRAME_OVERHEAD)
                .min(DATAGRAM_PAYLOAD_BUDGET) as u16,
        );
        if !ok {
            return;
        }
        // Below the bail: a failed handshake sets handshake_completed = 0, so
        // stamping these would show `handshakeCompleted === false` next to a
        // non-zero `handshakeCompletedAt`. Node stamps them only on success.
        self.write_stat(IDX_STATS_SESSION_HANDSHAKE_COMPLETED_AT, now_ns());
        self.write_stat(IDX_STATS_SESSION_HANDSHAKE_CONFIRMED_AT, now_ns());
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
            self.state.headers_supported.set(1);
            self.state.application_type.set(1);
            self.state.priority_supported.set(1);
            self.state.no_error_code.set(H3_NO_ERROR);
            self.state.internal_error_code.set(H3_INTERNAL_ERROR);
        } else {
            self.state.headers_supported.set(2);
        }
        let alpn = alpn_bytes
            .map(|b| bun_string_jsc::create_utf8_for_js(global, &b).or_report())
            .unwrap_or(JSValue::UNDEFINED);
        let cipher_version = bun_core::String::static_("TLSv1.3")
            .to_js(global)
            .or_report();
        // Node reports both fields only on failure -- the JS 'auto' rejection
        // gates on `validationErrorReason !== undefined` -- and a server with
        // no client certificate reports X509_V_ERR_UNSPECIFIED.
        let pair = match snap_validation {
            Some(pair) => Some(pair),
            None if self.is_server.get() && !have_peer_cert => Some(tls::validation_error_strings(
                bun_boringssl_sys::X509_V_ERR_UNSPECIFIED,
            )),
            None => None,
        };
        let (verify_reason, verify_code) = match pair {
            Some((code, reason)) => (
                bun_core::String::static_(reason.as_bytes())
                    .to_js(global)
                    .or_report(),
                bun_core::String::static_(code.as_bytes())
                    .to_js(global)
                    .or_report(),
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
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"qlog_version\":\"0.3\",\"qlog_format\":\"JSON-SEQ\",\"title\":\"bun node:quic\"}}\n\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_started\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(global, &chunk, false);
        }

        // Node destroys the early streams and fires `onearlyrejected` — on
        // the CLIENT only.
        if early_data.0 && !early_data.1 && !self.is_server.get() {
            if let Some(callback) = callbacks::get(global, "onSessionEarlyDataRejected") {
                let vm = global.bun_vm().as_mut();
                vm.event_loop_ref()
                    .run_callback(callback, global, self.handle(), &[]);
            }
        }

        // Matching Node: the server session exists and then closes with a
        // certificate_required transport error.
        if !cert_ok && !self.destroyed.get() && self.conn.get().is_some() {
            self.self_close.with_mut(|s| {
                *s = Some((
                    false,
                    CRYPTO_ERROR_CERTIFICATE_REQUIRED,
                    b"peer did not provide a certificate".to_vec(),
                ));
            });
            if let Some(c) = self.conn.get() {
                c.abort_error(
                    false,
                    CRYPTO_ERROR_CERTIFICATE_REQUIRED as c_uint,
                    c"peer did not provide a certificate",
                );
            }
            self.schedule_process();
        }
    }

    fn peer_verification_refused(&self) -> bool {
        !self.is_server.get()
            && self.reject_unverified_peer.get()
            && self
                .hsk_snapshot
                .get()
                .as_ref()
                .is_some_and(|s| s.validation.is_some())
    }

    fn capture_hsk_snapshot(&self) {
        if self.hsk_snapshot.get().is_some() {
            return;
        }
        let Some(conn) = self.conn.get() else {
            return;
        };
        let sni = conn.sni();
        let cipher = conn.cipher();
        struct TlsFacts {
            alpn: Option<Vec<u8>>,
            validation: Option<(&'static str, &'static str)>,
            peer_cert_der: Option<Vec<u8>>,
            local_cert_der: Option<Vec<u8>>,
            ephemeral: Option<(&'static str, Option<&'static str>, u32)>,
            early_data: (bool, bool),
        }
        let facts = conn
            .with_ssl(|ssl| TlsFacts {
                alpn: tls::negotiated_alpn(ssl),
                validation: tls::validation_error(ssl),
                peer_cert_der: tls::peer_certificate_der(ssl),
                local_cert_der: tls::local_certificate_der(ssl),
                ephemeral: tls::ephemeral_key_info(ssl),
                early_data: tls::early_data_info(ssl),
            })
            .unwrap_or(TlsFacts {
                alpn: None,
                validation: None,
                peer_cert_der: None,
                local_cert_der: None,
                ephemeral: None,
                early_data: (false, false),
            });
        let TlsFacts {
            alpn,
            validation,
            peer_cert_der,
            local_cert_der,
            ephemeral,
            early_data,
        } = facts;
        let alpn = alpn.or_else(|| {
            self.endpoint_ref()
                .and_then(|ep| ep.configured_alpn(self.is_server.get()))
        });
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
        // `qlog_fin_sent` is latched above and also gates the guard at the top,
        // so bailing here would silently end the whole qlog stream, not just
        // drop this record.
        let data_js = bun_string_jsc::create_utf8_for_js(global, data.as_bytes()).or_report();
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
        let _keep = RefPtr::from_this(self.this_ptr());
        self.state.closing.set(1);
        self.write_stat(IDX_STATS_SESSION_DESTROYED_AT, now_ns());
        // Take the close reason before emit_qlog: that runs onSessionQlog,
        // which is user JS and drains microtasks, so a destroy() from inside
        // it would swap the reason this close reports.
        let taken = self
            .peer_close
            .with_mut(Option::take)
            .or_else(|| self.self_close.with_mut(Option::take));
        if self.qlog_enabled.get() {
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_closed\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(global, &chunk, true);
        }
        let (error_type, code, reason): (i32, u64, Option<Vec<u8>>) = match taken {
            Some((app, code, reason)) => (if app { 1 } else { 0 }, code, Some(reason)),
            None => match self.conn.get() {
                None => match self.final_conn_status.with_mut(Option::take) {
                    Some((status, msg)) => {
                        map_conn_status(status, msg, self.handshake_reported.get())
                    }
                    None => (0, 0, None),
                },
                Some(conn) => {
                    // Map the lsquic conn status to Node's QuicError shape.
                    let (status, msg) = conn.status();
                    map_conn_status(status, msg, self.handshake_reported.get())
                }
            },
        };
        // `close_reported` is already latched above, so returning here would
        // mark the close delivered without ever delivering it and `closed`
        // would never settle. Report and carry on with undefined.
        let code_js = JSValue::from_uint64_no_truncate(global, code).or_report();
        let reason_js = reason
            .filter(|r| !r.is_empty())
            .map(|r| bun_string_jsc::create_utf8_for_js(global, &r).or_report())
            .unwrap_or(JSValue::UNDEFINED);
        if let Some(endpoint) = self.endpoint_ref() {
            endpoint.unregister_session(self.id);
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

    pub(super) fn teardown(&self, _global: &JSGlobalObject) {
        if self.destroyed.replace(true) {
            return;
        }
        let _keep = RefPtr::from_this(self.this_ptr());
        let streams = self.streams.replace(Vec::new());
        // Each `teardown` can run user JS that destroys a later entry; the
        // refs taken out of `streams` keep every native object live through
        // the loop, and rooting every wrapper up front keeps them live too.
        let _roots: Vec<Strong> = streams
            .iter()
            .map(|qs| Strong::create(qs.handle(), _global))
            .collect();
        for qs in &streams {
            qs.teardown(_global);
        }
        drop(streams);
        self.pending_local_bidi.with_mut(VecDeque::clear);
        self.pending_local_uni.with_mut(VecDeque::clear);
        if let Some(conn) = self.conn.take() {
            // Detaching the context breaks the back-pointer so late callbacks
            // no-op; the conn itself lives until lsquic closes it.
            drop(conn.take_ctx::<QuicSession>());
        }
        self.events.with_mut(Vec::clear);
        if let Some(ep) = self.endpoint.replace(None) {
            // The endpoint's `process()` re-validates against its registry, so
            // removing here is what makes the entry it snapshotted safe to skip.
            ep.unregister_session(self.id);
        }
        self.endpoint_js.set(None);
        self.application_options_js.set(None);
        self.this_value.with_mut(|r| r.downgrade());
    }

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
                        .map(|s| s.to_owned_slice() == b"application")
                })
                .transpose()?
                .unwrap_or(false);
            code = super::endpoint::read_u64_option(global, options, "code")?.unwrap_or(0);
            reason = options
                .get(global, "reason")?
                .filter(|v| v.is_string())
                .map(|v| bun_core::String::from_js(v, global).map(|s| s.to_owned_slice()))
                .transpose()?
                .unwrap_or_default();
            self.self_close.with_mut(|s| {
                *s = Some((app, code, reason.clone()));
            });
        }
        reason.push(0);
        Ok((app, code, reason))
    }

    fn apply_graceful_close(&self, app: bool, code: u64, reason: Vec<u8>) {
        let is_http = self
            .endpoint_ref()
            .map(|ep| ep.is_http(self.is_server.get()))
            .unwrap_or(false);
        if is_http && !app && code == 0 && !self.streams.get().is_empty() {
            // RFC 9114 §5.2.
            if let Some(c) = self.conn.get() {
                c.going_away();
            }
            self.close_after_streams.set(true);
            self.deferred_close
                .with_mut(|d| *d = Some((app, code, reason)));
        } else if self.any_stream_undelivered() {
            self.deferred_close
                .with_mut(|d| *d = Some((app, code, reason)));
        } else {
            self.apply_close(app, code, &reason);
        }
    }

    /// Applies a graceful close stashed while a dispatch was on the stack.
    /// Returns whether one was applied.
    pub(super) fn flush_pending_graceful(&self) -> bool {
        // A provisional session stashes its close here too, and `apply_close`
        // silently no-ops without a conn — draining it here would consume the
        // close that `bind_conn` is waiting to apply.
        if self.conn.get().is_none() {
            return false;
        }
        if let Some((app, code, reason)) = self.pending_graceful.with_mut(Option::take) {
            self.apply_graceful_close(app, code, reason);
            return true;
        }
        false
    }

    fn apply_close(&self, app: bool, code: u64, reason: &[u8]) {
        let Some(c) = self.conn.get() else { return };
        if app || code != 0 || reason.len() > 1 {
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

    fn any_stream_undelivered(&self) -> bool {
        self.streams
            .get()
            .iter()
            .any(|s| s.has_undelivered_outbound())
    }

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
            // Parse before the latch: a throw here must leave the session
            // untouched, not marked gracefully-closing with no close sent.
            // All three branches below want the same values.
            let (app, code, reason) =
                self.parse_close_options(global, frame.arguments_as_array::<1>()[0])?;
            self.state.graceful_close.set(1);
            if self.conn.get().is_none() {
                if self.is_server.get() && !self.close_reported.get() {
                    self.pending_graceful
                        .with_mut(|p| *p = Some((app, code, reason)));
                    self.close_when_bound.set(true);
                } else {
                    self.report_close(global);
                }
            } else {
                let scope_held = self.endpoint_ref().is_some_and(|ep| ep.scope_held());
                if scope_held {
                    self.pending_graceful
                        .with_mut(|p| *p = Some((app, code, reason)));
                } else {
                    self.apply_graceful_close(app, code, reason);
                }
                self.schedule_process();
            }
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn destroy(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        let mut parse_error = None;
        if !self.close_reported.get() && self.conn.get().is_some() {
            let options = frame.arguments_as_array::<1>()[0];
            if options.is_object() {
                // Node's Destroy with close options. JS has already latched
                // `inner.destroying` and finished its half before reaching
                // here, so teardown() MUST run; a parse failure is taken off
                // the VM (teardown reaches JS) and re-thrown once it has. No
                // close was applied then, so the engines are not driven.
                match self.close_with_options(global, options) {
                    Ok(()) => {
                        if let Some(endpoint) = self.endpoint_ref() {
                            endpoint.drive_engines_once();
                        }
                    }
                    Err(err) => parse_error = Some(global.take_exception(err)),
                }
            } else if let Some(c) = self.conn.get() {
                // Node's server acks the packet that triggered the destroying
                // callback.
                c.ack_now();
                if let Some(endpoint) = self.endpoint_ref() {
                    endpoint.drive_engines_once();
                }
                if let Some(c) = self.conn.get() {
                    // Node parity: Session::Destroy without close options.
                    c.abort_silent();
                }
            }
            self.schedule_process();
        }
        self.teardown(global);
        if let Some(err) = parse_error {
            return Err(global.throw_value(err));
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn open_stream(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() || self.conn.get().is_none() {
            return Ok(JSValue::UNDEFINED);
        }
        let [direction, body] = frame.arguments_as_array::<2>();
        let unidirectional = direction.is_number() && direction.as_number() == 1.0;
        let (qs, handle) = QuicStream::create(global, self.this_ptr(), frame.this(), None)?;
        let key = qs.key();
        if unidirectional {
            self.pending_local_uni.with_mut(|q| q.push_back(Some(key)));
        } else {
            self.pending_local_bidi.with_mut(|q| q.push_back(Some(key)));
        }
        self.bump_stream_stat(if unidirectional { STREAM_ID_UNI_BIT } else { 0 }, true);
        if let Some(buf) = body.as_array_buffer(global) {
            qs.outbound.with_mut(|o| {
                o.started = true;
                o.data.extend(buf.byte_slice().iter().copied());
                o.end = super::stream::PendingEnd::Fin;
            });
            // As attach_source/init_streaming_source/send_headers do: this
            // is what makes a later setOutbound() throw instead of
            // appending a second body.
            qs.set_has_outbound();
        }
        self.streams.with_mut(|v| v.push(qs));
        if let Some(conn) = self.conn.get() {
            if unidirectional {
                conn.make_uni_stream();
            } else {
                conn.make_stream();
            }
        }
        self.schedule_process();
        Ok(handle)
    }
    pub(crate) fn send_datagram(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() || self.conn.get().is_none() {
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
        if is_http && self.conn.get().and_then(|c| c.peer_h3_datagram()) == Some(false) {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        // Oversized for the negotiated budget: not sent (Node returns 0n).
        let max_size = self.state.max_datagram_size.get();
        if max_size == 0 || buf.byte_slice().len() > max_size as usize {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        // Copy before anything below can run user JS: the drop-oldest branch
        // invokes `ondatagramstatus`, which may detach or transfer
        // `data.buffer` and free the store `buf` points into.
        let payload = buf.byte_slice().to_vec();
        let id = self
            .next_datagram_id
            .replace(self.next_datagram_id.get() + 1);
        let max_pending = self.state.max_pending_datagrams.get();
        if max_pending > 0 && self.datagram_queue.get().len() >= max_pending as usize {
            // Node reports the abandonment synchronously from within
            // sendDatagram.
            if self.datagram_drop_newest.get() {
                self.report_datagram_abandoned(global, id)?;
                self.state.last_datagram_id.set(id);
                return JSValue::from_uint64_no_truncate(global, id);
            }
            if let Some((dropped_id, _)) = self.datagram_queue.with_mut(VecDeque::pop_front) {
                // Runs the user's `ondatagramstatus`, which can destroy this
                // session or close the conn before we get back here.
                self.report_datagram_abandoned(global, dropped_id)?;
                if self.destroyed.get() || self.conn.get().is_none() {
                    return JSValue::from_uint64_no_truncate(global, 0);
                }
            }
        }
        self.datagram_queue.with_mut(|q| q.push_back((id, payload)));
        self.state.last_datagram_id.set(id);
        if let Some(c) = self.conn.get() {
            c.want_datagram_write(true);
        }
        self.schedule_process();
        JSValue::from_uint64_no_truncate(global, id)
    }
    /// Runs inside `sendDatagram`: what building the status left pending is
    /// thrown from there.
    fn report_datagram_abandoned(&self, global: &JSGlobalObject, id: u64) -> JsResult<()> {
        if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
            return Ok(());
        }
        let id_js = JSValue::from_uint64_no_truncate(global, id)?;
        let status_js = global.common_strings().quic_datagram_abandoned();
        if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref()
                .run_callback(cb, global, self.handle(), &[id_js, status_js]);
        }
        Ok(())
    }

    /// Node's JS layer discards this return value, matching upstream.
    pub(crate) fn update_key(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(false))
    }
    pub(crate) fn get_certificate(
        &self,
        global: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        if let Some(der) = self.with_conn_ssl(tls::local_certificate_der).flatten() {
            return ArrayBuffer::create_buffer(global, der.as_slice());
        }
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
        if let Some(conn) = self.conn.get() {
            if let Some(der) = conn
                .server_cert_chain()
                .and_then(|chain| chain.leaf().and_then(bun_boringssl_sys::X509::to_der))
            {
                return ArrayBuffer::create_buffer(global, &der);
            }
            if let Some(der) = self.with_conn_ssl(tls::peer_certificate_der).flatten() {
                return ArrayBuffer::create_buffer(global, &der);
            }
        }
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
        let Some((kind, name, bits)) = self
            .with_conn_ssl(tls::ephemeral_key_info)
            .flatten()
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
    /// `f` on the attached conn's TLS handle.
    fn with_conn_ssl<R>(&self, f: impl FnOnce(&bun_boringssl_sys::SSL) -> R) -> Option<R> {
        self.conn.get()?.with_ssl(f)
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
        let put_cid = |name: &[u8], s: &str| -> JsResult<()> {
            let v = if s.is_empty() {
                JSValue::UNDEFINED
            } else {
                bun_string_jsc::create_utf8_for_js(global, s.as_bytes())?
            };
            obj.put(global, name, v);
            Ok(())
        };
        put_cid(b"initialSCID", tp.initial_scid_str())?;
        put_cid(b"retrySCID", tp.retry_scid_str())?;
        put_cid(b"originalDCID", tp.original_dcid_str())?;
        Ok(obj)
    }
}

fn opt_bytes_to_js(global: &JSGlobalObject, bytes: Option<&[u8]>) -> JSValue {
    match bytes {
        Some(b) => bun_string_jsc::create_utf8_for_js(global, b).or_report(),
        None => JSValue::UNDEFINED,
    }
}

fn make_application_error(global: &JSGlobalObject, code: u64) -> JsResult<JSValue> {
    let kind = bun_core::String::static_("application").to_js(global)?;
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
        let Some(tp) = self.conn.get().and_then(|c| c.peer_transport_params()) else {
            return Ok(JSValue::UNDEFINED);
        };
        Self::transport_params_to_js(global, &tp)
    }

    pub(crate) fn finalize(&self) {
        self.this_value.with_mut(JsRef::finalize);
    }
}

impl lsquic::NqSession for QuicSession {
    type Stream = QuicStream;

    fn on_goaway_received(&self) {
        self.push_event(SessionEvent::GoawayReceived);
    }

    fn on_hsk_confirmed(&self) {
        self.push_event(SessionEvent::HandshakeConfirmed);
    }

    fn on_hsk_done(&self, status: c_int) {
        let ok = status == lsquic::LSQ_HSK_OK || status == lsquic::LSQ_HSK_RESUMED_OK;
        if ok && !self.is_server.get() && self.reject_unverified_peer.get() {
            self.capture_hsk_snapshot();
            if self.peer_verification_refused() {
                self.peer_cert_rejected.set(true);
                self.self_close.with_mut(|s| {
                    *s = Some((
                        false,
                        CRYPTO_ERROR_BAD_CERTIFICATE,
                        b"peer certificate verification failed".to_vec(),
                    ));
                });
                if let Some(c) = self.conn.get() {
                    c.abort_error(
                        false,
                        CRYPTO_ERROR_BAD_CERTIFICATE as c_uint,
                        c"peer certificate verification failed",
                    );
                }
            }
        }
        self.push_event(SessionEvent::HandshakeDone { ok });
    }

    fn on_conn_closed(&self) {
        // The conn's streams die with it — pending deferred aborts hold lsquic
        // stream handles that are about to be freed.
        self.deferred_aborts.with_mut(Vec::clear);
        if let Some(conn) = self.conn.get() {
            self.final_conn_status
                .with_mut(|f| *f = Some(conn.status()));
        }
        self.push_event(SessionEvent::Closed);
        // The lsquic_conn is freed immediately after this callback returns.
        self.conn.set(None);
    }

    fn on_conncloseframe(&self, app_error: bool, code: u64, reason: &[u8]) {
        self.push_event(SessionEvent::PeerClose {
            app_error,
            code,
            reason: reason.to_vec(),
        });
    }

    fn on_new_token(&self, token: &[u8]) {
        if token.is_empty() {
            return;
        }
        self.push_event(SessionEvent::NewToken(token.to_vec()));
    }

    fn on_sess_resume(&self, blob: &[u8]) {
        if blob.is_empty() {
            return;
        }
        self.push_event(SessionEvent::SessionResume(blob.to_vec()));
    }

    fn on_new_stream(this: ThisPtr<Self>, stream: lsquic::Stream) -> Option<RefPtr<QuicStream>> {
        let id = stream.id();
        let is_local = (id & 1 == 0) != this.is_server();
        if is_local {
            if let Some(qs) = this.take_pending_local_stream(id & STREAM_ID_UNI_BIT != 0) {
                qs.bind_raw(stream);
                this.push_event(SessionEvent::StreamReady {
                    stream: qs.key(),
                    remote: false,
                });
                return Some(RefPtr::from_this(qs));
            }
            stream.shutdown_internal();
            return None;
        }
        this.on_remote_stream(stream)
    }

    fn on_dg_write(&self, capacity: usize) -> Option<Vec<u8>> {
        let Some((id, len)) = self
            .datagram_queue
            .get()
            .front()
            .map(|(id, p)| (*id, p.len()))
        else {
            if let Some(c) = self.conn.get() {
                c.want_datagram_write(false);
            }
            return None;
        };
        if len > capacity {
            let max = self.state.max_datagram_size.get() as usize;
            if max == 0 || len > max {
                self.datagram_queue.with_mut(VecDeque::pop_front);
                self.push_event(SessionEvent::DatagramStatus { id, sent: false });
                if let Some(c) = self.conn.get() {
                    c.want_datagram_write(!self.datagram_queue.get().is_empty());
                }
            }
            return None;
        }
        let (id, payload) = self.datagram_queue.with_mut(VecDeque::pop_front)?;
        self.push_event(SessionEvent::DatagramStatus { id, sent: true });
        if !self.datagram_queue.get().is_empty() {
            if let Some(c) = self.conn.get() {
                c.want_datagram_write(true);
            }
        }
        Some(payload)
    }

    fn on_datagram_status(&self, count: c_uint, acked: bool) {
        if count == 0 {
            return;
        }
        self.push_event(SessionEvent::DatagramAckStatus { count, acked });
    }

    fn on_early_data_failed(&self) {
        // Front of the queue: lsquic resets the early streams before this
        // callback, so their clean closes are already queued and would settle
        // `closed` before the rejection node delivers could land.
        self.events
            .with_mut(|e| e.insert(0, SessionEvent::EarlyDataFailed));
        self.schedule_process();
    }

    fn on_origin(&self, chunk: &[u8], fin: bool) {
        if !chunk.is_empty() {
            self.origin_buf.with_mut(|b| {
                let room = MAX_ORIGIN_BYTES.saturating_sub(b.len());
                b.extend_from_slice(&chunk[..chunk.len().min(room)]);
            });
        }
        if fin {
            let payload = self.origin_buf.with_mut(core::mem::take);
            self.push_event(SessionEvent::Origin(payload));
        }
    }

    fn on_path_switch(
        &self,
        validated: bool,
        preferred: bool,
        new_local: Option<&lsquic::SockAddr>,
        new_peer: Option<&lsquic::SockAddr>,
        old_local: Option<&lsquic::SockAddr>,
        old_peer: Option<&lsquic::SockAddr>,
    ) {
        let stored =
            |sa: Option<&lsquic::SockAddr>| sa.map(StoredAddr::from_lsquic).unwrap_or_default();
        self.push_event(SessionEvent::PathValidation {
            validated,
            preferred,
            new_local: stored(new_local),
            new_remote: stored(new_peer),
            old_local: stored(old_local),
            old_remote: stored(old_peer),
        });
    }

    fn on_datagram(&self, payload: &[u8]) {
        let early = self.conn.get().is_some_and(|c| c.datagram_early());
        self.push_event(SessionEvent::Datagram {
            payload: payload.to_vec(),
            early,
        });
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

/// node's lifecycle callbacks (`onSessionClose`, `onSessionHandshake`, …) run
/// behind state that is latched *before* their arguments are built — bailing
/// would leave `closed`/`opened` never settling — so an argument that cannot be
/// built (allocation failure, a terminating VM) is folded and replaced with
/// `undefined`, and the callback still runs (or is skipped by `run_callback`'s
/// gate when it is the termination).
trait OrReport {
    fn or_report(self) -> JSValue;
}

impl OrReport for JsResult<JSValue> {
    #[inline]
    fn or_report(self) -> JSValue {
        match self {
            Ok(v) => v,
            Err(e) => {
                crate::dispatch::fold(Err(e));
                JSValue::UNDEFINED
            }
        }
    }
}
