//! Node's `internalBinding('quic').Session` analog (node/src/quic/session.{h,cc}).

use core::cell::{Cell, OnceCell};
use core::ffi::{c_int, c_uint, c_void};
use core::mem::{MaybeUninit, offset_of};
use core::net::{IpAddr, SocketAddr};
use core::sync::atomic::Ordering::Relaxed;
use core::sync::atomic::{AtomicU8, AtomicU16, AtomicU32, AtomicU64};
use std::collections::VecDeque;

use bun_jsc::bindgen::{
    BorrowedWrapper, JsLocal, JsPayload as _, JsScope, JsWrapper, StrongWrapper,
};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    ArrayBuffer, JSGlobalObject, JSValue, JsClass as _, JsResult, StringJsc, Strong, StrongCell,
};

use bun_lsquic_sys as lsquic;
use bun_ptr::{CellExt as _, OptionCellExt as _};

use crate::socket::SocketAddress;
use crate::socket::socket_address::sockaddr;

use super::aliased_struct::{AliasedStruct, all_atomic_struct, put_state_and_stats};
use super::callbacks;
use super::endpoint::{Closes, MS_PER_SEC, QuicEndpoint};
use super::engine::{self, StrongCtx};
use super::now_ns;
use super::roots::{Key, StrongWrapperCell, StrongWrapperMap};
use super::stream::QuicStream;
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
pub(super) const H3_INTERNAL_ERROR: u64 = 0x102;

/// Mirrors node's `Session::Application::Type` (node/src/quic/application.h).
#[derive(Clone, Copy)]
#[repr(u8)]
pub(super) enum Application {
    /// Used by version-negotiation probes, which have no engine and never handshake.
    None = 0,
    /// Raw QUIC (node's `DefaultApplication`).
    Default = 1,
    Http3 = 2,
}

/// Mirrors node's `HeadersSupportState`. 0 means no application.
const HEADERS_SUPPORTED: u8 = 1;
const HEADERS_UNSUPPORTED: u8 = 2;

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

/// A `struct sockaddr*` for both lsquic and the uSockets UDP send.
#[repr(transparent)]
#[derive(Copy, Clone)]
pub(crate) struct StoredAddr(pub(super) sockaddr);

impl Default for StoredAddr {
    fn default() -> Self {
        Self(sockaddr::ZEROED)
    }
}

impl StoredAddr {
    pub(super) fn from_js(value: JSValue) -> Option<Self> {
        Some(Self(value.as_class_ref::<SocketAddress>()?._addr))
    }
    pub(super) fn as_ptr(&self) -> *const c_void {
        core::ptr::from_ref(self).cast()
    }
    pub(super) fn decode(&self) -> Option<SocketAddr> {
        let (ip, port) = match self.0.as_sin() {
            Some(sin) => (IpAddr::from(sin.addr.to_ne_bytes()), sin.port),
            None => {
                let sin6 = self.0.as_sin6()?;
                (IpAddr::from(sin6.addr), sin6.port)
            }
        };
        Some(SocketAddr::new(ip, u16::from_be(port)))
    }
    pub(super) fn to_js_socket_address(&self, global: &JSGlobalObject) -> JSValue {
        let socket_address = match self.decode() {
            Some(SocketAddr::V4(a)) => SocketAddress::init_ipv4(a.ip().octets(), a.port()),
            Some(SocketAddr::V6(a)) => SocketAddress::init_ipv6(a.ip().octets(), a.port(), 0, 0),
            None => return JSValue::UNDEFINED,
        };
        socket_address.to_js(global)
    }
}

all_atomic_struct! {
    /// Mirrors Node's `Session::State` (`SESSION_STATE` in session.cc). The
    /// `IDX_STATE_SESSION_*` constants on the binding are `offset_of!` values
    /// into this struct, so the layout must stay in sync with what the JS layer
    /// reads (`src/js/internal/quic/state.ts`).
    #[derive(Default)]
    pub(crate) struct SessionState {
        pub(crate) listener_flags: AtomicU32,
        pub(crate) closing: AtomicU8,
        pub(crate) graceful_close: AtomicU8,
        pub(crate) silent_close: AtomicU8,
        pub(crate) stateless_reset: AtomicU8,
        pub(crate) handshake_completed: AtomicU8,
        pub(crate) handshake_confirmed: AtomicU8,
        pub(crate) stream_open_allowed: AtomicU8,
        pub(crate) priority_supported: AtomicU8,
        pub(crate) headers_supported: AtomicU8,
        pub(crate) wrapped: AtomicU8,
        pub(crate) application_type: AtomicU8,
        _pad0: AtomicU8,
        pub(crate) no_error_code: AtomicU64,
        pub(crate) internal_error_code: AtomicU64,
        pub(crate) max_datagram_size: AtomicU16,
        _pad1: [AtomicU8; 6],
        pub(crate) last_datagram_id: AtomicU64,
        pub(crate) max_pending_datagrams: AtomicU16,
        _pad2: [AtomicU8; 6],
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

all_atomic_struct! {
    struct StateAndStats {
        state: SessionState,
        stats: [AtomicU64; SESSION_STATS_FIELDS.len()],
    }
}

/// Copied in the lsquic callback because the conn can be freed before the handshake event is dispatched.
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
    /// Backs `session.remoteTransportParams` and `state.max_datagram_size`.
    peer_transport_params: Option<lsquic::NqTransportParams>,
}

struct DeferredAbort {
    stream: Key,
    /// What `remove_stream` removed from `streams`. Still bound, so lsquic's `on_close` clears its `raw`.
    removed: Option<StrongCtx<QuicStream>>,
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
        stream: Key,
        remote: bool,
    },
    StreamWake {
        stream: Key,
    },
    StreamDrain {
        stream: Key,
    },
    StreamBlocked {
        stream: Key,
    },
    StreamReset {
        stream: Key,
        code: u64,
    },
    StreamStopSending {
        stream: Key,
        code: u64,
    },
    StreamWantsTrailers {
        stream: Key,
    },
    StreamHeaders {
        stream: Key,
        pairs: Vec<Vec<u8>>,
        kind: u32,
    },
    NewToken(Vec<u8>),
    Keylog(Vec<u8>),
    SessionResume(Vec<u8>),
    StreamClosed {
        stream: Key,
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

#[derive(Default)]
pub(super) struct SessionOptions {
    datagram_drop_newest: bool,
    qlog: bool,
    verify_peer_manually: bool,
    application_options: Option<Strong>,
}

impl SessionOptions {
    pub(super) fn from_js(global: &JSGlobalObject, options: JSValue) -> JsResult<Self> {
        let mut this = Self::default();
        if !options.is_object() {
            return Ok(this);
        }
        if let Some(v) = options
            .get(global, "datagramDropPolicy")?
            .filter(|v| v.is_string())
        {
            this.datagram_drop_newest =
                bun_core::String::from_js(v, global)?.to_owned_slice() == b"drop-newest";
        }
        if let Some(v) = options.get(global, "qlog")? {
            this.qlog = v.to_boolean();
        }
        if let Some(v) = options.get(global, "verifyPeer")?.filter(|v| v.is_string()) {
            this.verify_peer_manually =
                bun_core::String::from_js(v, global)?.to_owned_slice() == b"manual";
        }
        this.application_options = options
            .get(global, "application")?
            .filter(|v| v.is_object())
            .map(|app| Strong::create(app, global));
        Ok(this)
    }

    pub(super) fn clone_with_global(&self, global: &JSGlobalObject) -> Self {
        let application_options = self.application_options.as_ref();
        Self {
            application_options: application_options.map(|app| Strong::create(app.get(), global)),
            ..*self
        }
    }
}

pub(crate) struct QuicSession {
    pub(super) conn: lsquic::BoundConn,
    /// Empty after `teardown`.
    endpoint: StrongWrapperCell<QuicEndpoint>,
    /// Key in the endpoint's `sessions`.
    key: Key,
    is_server: bool,
    local_addr: Cell<StoredAddr>,
    pub(super) remote_addr: Cell<StoredAddr>,
    state_and_stats: AliasedStruct<StateAndStats>,
    events: Cell<Vec<SessionEvent>>,
    origin_buf: Cell<Vec<u8>>,
    deferred_aborts: Cell<Vec<DeferredAbort>>,
    write_marker: Cell<u64>,
    /// A graceful close requested while a dispatch was on the stack: applied
    /// on the next depth-0 pass so its GOAWAY/CONNECTION_CLOSE does not share
    /// a flight with data written by the same dispatch (node's close lands an
    /// RTT after the data because its stream close is ack-gated).
    pending_graceful: Cell<Option<(bool, u64, Vec<u8>)>>,
    pub(super) verneg: Cell<Option<(u32, u32)>>,
    peer_close: Cell<Option<(bool, u64, Vec<u8>)>>,
    self_close: Cell<Option<(bool, u64, Vec<u8>)>>,
    datagram_drop_newest: bool,
    qlog_enabled: bool,
    qlog_fin_sent: Cell<bool>,
    datagram_queue: Cell<VecDeque<(u64, Vec<u8>)>>,
    /// Monotonic id assigned by `sendDatagram` (Node returns it as a BigInt).
    next_datagram_id: Cell<u64>,
    inflight_datagrams: Cell<VecDeque<u64>>,
    ticket_delivered: Cell<bool>,
    pending_tickets: Cell<VecDeque<(u64, Vec<u8>)>>,
    close_after_streams: Cell<bool>,
    final_conn_status: Cell<Option<(c_int, Vec<u8>)>>,
    pending_local_bidi: Cell<VecDeque<Key>>,
    pending_local_uni: Cell<VecDeque<Key>>,
    streams: StrongWrapperMap<QuicStream, StrongCtx<QuicStream>>,
    handshake_reported: Cell<bool>,
    new_token_reported: Cell<bool>,
    close_when_bound: Cell<bool>,
    deferred_close: Cell<Option<(bool, u64, Vec<u8>)>>,
    handshake_pending_ok: Cell<bool>,
    reject_unverified_peer: bool,
    peer_cert_rejected: Cell<bool>,
    hsk_snapshot: OnceCell<HskSnapshot>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
    application_options_js: StrongCell,
}

impl QuicSession {
    pub(super) fn create(
        global: &JSGlobalObject,
        endpoint: StrongWrapper<QuicEndpoint>,
        key: Key,
        is_server: bool,
        application: Application,
        options: SessionOptions,
    ) -> JsResult<StrongCtx<QuicSession>> {
        let session = Self {
            conn: lsquic::BoundConn::default(),
            endpoint: StrongWrapperCell::new(Some(endpoint)),
            key,
            is_server,
            local_addr: Cell::new(StoredAddr::default()),
            remote_addr: Cell::new(StoredAddr::default()),
            state_and_stats: AliasedStruct::new(StateAndStats {
                state: SessionState::default(),
                stats: [const { AtomicU64::new(0) }; _],
            }),
            events: Cell::new(Vec::new()),
            origin_buf: Cell::new(Vec::new()),
            deferred_aborts: Cell::new(Vec::new()),
            write_marker: Cell::new(0),
            pending_graceful: Cell::new(None),
            verneg: Cell::new(None),
            peer_close: Cell::new(None),
            self_close: Cell::new(None),
            datagram_drop_newest: options.datagram_drop_newest,
            qlog_enabled: options.qlog,
            qlog_fin_sent: Cell::new(false),
            datagram_queue: Cell::new(VecDeque::new()),
            next_datagram_id: Cell::new(1),
            inflight_datagrams: Cell::new(VecDeque::new()),
            ticket_delivered: Cell::new(false),
            pending_tickets: Cell::new(VecDeque::new()),
            close_after_streams: Cell::new(false),
            final_conn_status: Cell::new(None),
            pending_local_bidi: Cell::new(VecDeque::new()),
            pending_local_uni: Cell::new(VecDeque::new()),
            streams: StrongWrapperMap::default(),
            handshake_reported: Cell::new(false),
            new_token_reported: Cell::new(false),
            close_when_bound: Cell::new(false),
            deferred_close: Cell::new(None),
            handshake_pending_ok: Cell::new(false),
            reject_unverified_peer: !options.verify_peer_manually,
            peer_cert_rejected: Cell::new(false),
            hsk_snapshot: OnceCell::new(),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
            application_options_js: StrongCell::from(options.application_options),
        };
        // This is the only write to the application fields, like node's `Session::SetApplication`.
        let s = session.state();
        s.internal_error_code.store(1, Relaxed);
        s.stream_open_allowed.store(1, Relaxed);
        s.application_type.store(application as u8, Relaxed);
        match application {
            Application::None => {}
            Application::Default => s.headers_supported.store(HEADERS_UNSUPPORTED, Relaxed),
            Application::Http3 => {
                s.headers_supported.store(HEADERS_SUPPORTED, Relaxed);
                s.priority_supported.store(1, Relaxed);
                s.no_error_code.store(H3_NO_ERROR, Relaxed);
                s.internal_error_code.store(H3_INTERNAL_ERROR, Relaxed);
            }
        }
        session.write_stat(IDX_STATS_SESSION_CREATED_AT, now_ns());
        let buffer = session.state_and_stats.to_array_buffer(global)?;
        let this_value = session.into_js_wrapper(global);
        let handle = this_value.to_js();
        let stats_byte_offset = offset_of!(StateAndStats, stats);
        put_state_and_stats(global, handle, buffer, buffer, stats_byte_offset);
        Ok(StrongCtx::new(StrongWrapper::new(this_value, global)))
    }

    /// Call after `conn` is bound to a provisional session.
    pub(super) fn on_promoted(&self, early_keylog: Vec<Vec<u8>>) {
        for line in early_keylog {
            self.push_event(SessionEvent::Keylog(line));
        }
        self.cache_sockaddrs();
        if self.close_when_bound.get() {
            // Carry the user's {type, code, reason} through rather than
            // sending a bare close.
            self.flush_pending_graceful();
        }
    }

    pub(super) fn cache_sockaddrs(&self) {
        if let Some((local, peer)) = engine::conn_sockaddrs(&self.conn) {
            self.local_addr.set(local);
            self.remote_addr.set(peer);
        }
    }

    fn has_listener(&self, flag: u32) -> bool {
        self.state().listener_flags.load(Relaxed) & flag != 0
    }
    fn add_stat(&self, idx: usize, delta: u64) {
        self.write_stat(
            idx,
            self.state_and_stats.stats[idx]
                .load(Relaxed)
                .wrapping_add(delta),
        );
    }
    fn state(&self) -> &SessionState {
        &self.state_and_stats.state
    }
    fn write_stat(&self, idx: usize, value: u64) {
        self.state_and_stats.stats[idx].store(value, Relaxed);
    }
    pub(super) fn is_server(&self) -> bool {
        self.is_server
    }
    fn is_http(&self) -> bool {
        self.endpoint.with(|ep| ep.is_http(self.is_server)) == Some(true)
    }
    pub(super) fn push_event(&self, event: SessionEvent) {
        self.events.with_taken(|e| e.push(event));
    }
    /// Called from the lsquic callback that completes the handshake, while `conn` is still alive.
    pub(super) fn note_handshake_ok(&self) {
        self.capture_hsk_snapshot();
        self.push_event(SessionEvent::HandshakeDone { ok: true });
    }
    pub(super) fn schedule_process(&self) {
        self.endpoint.with(|ep| ep.schedule_process());
    }
    pub(super) fn note_stream_write(&self) {
        self.write_marker
            .set(self.write_marker.get().wrapping_add(1));
    }
    pub(super) fn defer_stream_abort(&self, stream: Key, reset: Option<u64>, stop: Option<u64>) {
        let marker = self.write_marker.get();
        self.deferred_aborts.with_taken(|v| {
            if let Some(e) = v.iter_mut().find(|e| e.stream == stream) {
                e.reset = e.reset.or(reset);
                e.stop = e.stop.or(stop);
            } else {
                v.push(DeferredAbort {
                    stream,
                    removed: None,
                    reset,
                    stop,
                    marker,
                });
            }
        });
    }
    pub(super) fn has_deferred_abort(&self, stream: Key) -> bool {
        self.deferred_aborts
            .with_taken(|v| v.iter().any(|e| e.stream == stream))
    }
    pub(super) fn flush_deferred_aborts(&self) {
        let marker = self.write_marker.get();
        for e in self.deferred_aborts.take() {
            let abort = |stream: BorrowedWrapper<'_, QuicStream>| {
                let s = &stream.raw;
                if e.marker != marker {
                    // Node parity — the queued frames are dropped.
                    s.shutdown_internal();
                    return;
                }
                if let Some(code) = e.stop {
                    s.stop_sending(code);
                }
                if let Some(code) = e.reset {
                    s.reset(code);
                } else {
                    s.close();
                }
            };
            match &e.removed {
                Some(removed) => removed.try_with(abort),
                None => self.streams.with(e.stream, abort),
            };
        }
    }
    fn pending_local_streams(&self, uni: bool) -> &Cell<VecDeque<Key>> {
        if uni {
            &self.pending_local_uni
        } else {
            &self.pending_local_bidi
        }
    }
    pub(super) fn remove_stream(&self, key: Key) {
        let Some(removed) = self.streams.remove(key) else {
            return;
        };
        self.deferred_aborts.with_taken(|v| {
            if let Some(e) = v.iter_mut().find(|e| e.stream == key) {
                e.removed = Some(removed);
            }
        });
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

    fn on_remote_stream(this: BorrowedWrapper<'_, Self>, raw: &lsquic::Stream, id: u64) {
        let key = this.streams.next_key();
        let stream = match QuicStream::create(this.global(), this.to_strong(), key) {
            Ok(stream) => stream,
            Err(e) => return crate::dispatch::fold(Err(e)),
        };
        stream.bind(raw);
        let qs = stream.payload();
        qs.on_opened(this.is_server);
        qs.mark_wrote_to_lsquic();
        this.bump_stream_stat(id, false);
        this.push_event(SessionEvent::StreamReady {
            stream: key,
            remote: true,
        });
        if let Some(code) = qs.pre_reset_code() {
            this.push_event(SessionEvent::StreamReset { stream: key, code });
        }
        this.streams.insert(key, stream);
    }

    fn refresh_conn_stats(&self) {
        let Some(info) = self.conn.info() else {
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
        if let Some(pings) = self.conn.pings_received() {
            self.write_stat(IDX_STATS_SESSION_PING_RECV, pings);
        }
    }

    pub(super) fn apply_peer_datagram_budget(&self) {
        let Some(tp) = self.conn.peer_transport_params() else {
            return;
        };
        self.state()
            .max_datagram_size
            .store(datagram_budget(&tp), Relaxed);
    }

    fn deliver_pending_tickets(&self, this_value: JSValue, global: &JSGlobalObject) {
        if self.pending_tickets.with_taken(|q| q.is_empty()) {
            return;
        }
        if self.destroyed.get()
            || self.close_reported.get()
            || self.state().graceful_close.load(Relaxed) != 0
        {
            self.pending_tickets.with_taken(VecDeque::clear);
            return;
        }
        let now = if self.streams.is_empty() {
            now_ns()
        } else {
            u64::MAX
        };
        loop {
            let blob = self
                .pending_tickets
                .with_taken(|q| q.pop_front_if(|(at, _)| *at <= now).map(|(_, b)| b));
            let Some(blob) = blob else { break };
            if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                continue;
            }
            let buf = ArrayBuffer::create_buffer(global, &blob).or_report();
            if let Some(cb) = callbacks::get(global, "onSessionTicket") {
                let vm = global.bun_vm();
                vm.event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
                    cb,
                    global,
                    this_value,
                    &[buf],
                );
            }
        }
        if !self.pending_tickets.with_taken(|q| q.is_empty()) {
            self.schedule_process();
        }
    }

    pub(super) fn process_events(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        closes: Closes,
    ) {
        self.refresh_conn_stats();
        self.deliver_pending_tickets(this_value, global);
        // node leaves a microtask window between a session's lifecycle events
        // and its close; the loop driver can batch a whole exchange into one
        // pass, so a Closed behind other dispatch is deferred one turn.
        let mut dispatched_js = false;
        loop {
            let Some(event) = self.events.with_taken(|e| {
                if e.is_empty() {
                    None
                } else {
                    Some(e.remove(0))
                }
            }) else {
                break;
            };
            if (dispatched_js || closes == Closes::Defer)
                && matches!(event, SessionEvent::Closed | SessionEvent::GoawayReceived)
            {
                self.events.with_taken(|e| e.insert(0, event));
                self.schedule_process();
                break;
            }
            if !matches!(event, SessionEvent::PeerClose { .. } | SessionEvent::Closed) {
                dispatched_js = true;
            }
            if self.destroyed.get() {
                break;
            }
            if let Err(err) = self.dispatch_event(this_value, global, event) {
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
    fn dispatch_event(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        event: SessionEvent,
    ) -> JsResult<()> {
        match event {
            SessionEvent::HandshakeDone { ok } => {
                if ok {
                    if self.is_server || self.peer_verification_refused() {
                        // Node's server reports at handshake COMPLETION
                        // (session.cc: server completion == confirmation
                        // per RFC 9001 §4.1.2).
                        self.maybe_report_handshake(this_value, global, true);
                    } else {
                        // Node's client `opened` settles only for
                        // connections the server actually accepted.
                        self.handshake_pending_ok.set(true);
                    }
                } else {
                    self.maybe_report_handshake(this_value, global, false);
                }
            }
            SessionEvent::HandshakeConfirmed => {
                self.state().handshake_confirmed.store(1, Relaxed);
                if self.handshake_pending_ok.get() {
                    let close_wins = self.streams.is_empty()
                        && self.events.with_taken(|e| {
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
                        self.maybe_report_handshake(this_value, global, true);
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
                self.report_close(this_value, global);
            }
            SessionEvent::StreamReady { stream, remote } => {
                if remote {
                    self.streams.with(stream, |stream| {
                        self.announce_stream(this_value, global, stream)
                    });
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
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[buf],
                    );
                }
            }
            SessionEvent::Keylog(line) => {
                let s = bun_string_jsc::create_utf8_for_js(global, &line)?;
                if let Some(cb) = callbacks::get(global, "onSessionKeyLog") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[s],
                    );
                }
            }
            SessionEvent::SessionResume(blob) => {
                if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                    return Ok(());
                }
                if self.ticket_delivered.replace(true) {
                    self.pending_tickets
                        .with_taken(|q| q.push_back((now_ns() + TICKET_DELIVERY_DELAY_NS, blob)));
                    self.schedule_process();
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &blob)?;
                if let Some(cb) = callbacks::get(global, "onSessionTicket") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[buf],
                    );
                }
            }
            SessionEvent::StreamReset { stream, code } => {
                let Some(handle) =
                    self.stream_handle(stream, |s| s.wants_reset() && !s.is_announce_suppressed())
                else {
                    return Ok(());
                };
                let err = make_application_error(global, code)?;
                {
                    if let Some(cb) = callbacks::get(global, "onStreamReset") {
                        let vm = global.bun_vm();
                        vm.event_loop().run_callback(
                            bun_event_loop::ContextId::NONE,
                            cb,
                            global,
                            handle,
                            &[err],
                        );
                    }
                }
            }
            SessionEvent::GoawayReceived => {
                // lsquic doesn't surface the GOAWAY stream-id; Node
                // reports -1n when the id is unavailable.
                let last_stream_id = JSValue::from_int64_no_truncate(global, -1)?;
                if let Some(cb) = callbacks::get(global, "onSessionGoaway") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[last_stream_id],
                    );
                }
            }
            SessionEvent::StreamWantsTrailers { stream } => {
                let Some(handle) = self.stream_handle(stream, |_| true) else {
                    return Ok(());
                };
                if let Some(cb) = callbacks::get(global, "onStreamTrailers") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        handle,
                        &[],
                    );
                }
            }
            SessionEvent::StreamHeaders {
                stream,
                pairs,
                kind,
            } => {
                let Some(handle) = self.stream_handle(stream, QuicStream::wants_headers) else {
                    return Ok(());
                };
                // Latin-1, as node does for HTTP headers. Allocate inside
                // the closure: a collected `Vec<JSValue>` is not GC-scanned,
                // so early strings would be collectible.
                let js_arr = JSValue::create_array_from_iter(global, pairs.iter(), |s| {
                    bun_core::String::clone_latin1(s).into_js(global)
                });
                let js_arr = js_arr?;
                {
                    if let Some(cb) = callbacks::get(global, "onStreamHeaders") {
                        let vm = global.bun_vm();
                        vm.event_loop().run_callback(
                            bun_event_loop::ContextId::NONE,
                            cb,
                            global,
                            handle,
                            &[js_arr, JSValue::js_number(kind as f64)],
                        );
                    }
                }
            }
            SessionEvent::StreamDrain { stream } => {
                let Some(handle) = self.stream_handle(stream, |_| true) else {
                    return Ok(());
                };
                if let Some(cb) = callbacks::get(global, "onStreamDrain") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        handle,
                        &[],
                    );
                }
            }
            SessionEvent::StreamBlocked { stream } => {
                let Some(handle) = self.stream_handle(stream, QuicStream::wants_block) else {
                    return Ok(());
                };
                if let Some(cb) = callbacks::get(global, "onStreamBlocked") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        handle,
                        &[],
                    );
                }
            }
            SessionEvent::StreamWake { stream } => {
                let wakeup = self.streams.with(stream, |s| {
                    if s.is_announce_suppressed() {
                        return None;
                    }
                    s.take_wakeup()
                });
                if let Some(wakeup) = wakeup.flatten() {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        wakeup.get(),
                        global,
                        JSValue::UNDEFINED,
                        &[],
                    );
                }
            }
            SessionEvent::Datagram { payload, early } => {
                self.add_stat(IDX_STATS_SESSION_DATAGRAMS_RECEIVED, 1);
                if !self.has_listener(LISTENER_FLAG_DATAGRAM) || self.peer_cert_rejected.get() {
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &payload)?;
                if let Some(cb) = callbacks::get(global, "onSessionDatagram") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[buf, JSValue::js_boolean(early)],
                    );
                }
            }
            SessionEvent::DatagramStatus { id, sent } => {
                if sent {
                    self.add_stat(IDX_STATS_SESSION_DATAGRAMS_SENT, 1);
                    self.inflight_datagrams.with_taken(|q| q.push_back(id));
                    return Ok(());
                }
                if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
                    return Ok(());
                }
                let id_js = JSValue::from_uint64_no_truncate(global, id)?;
                let status_js = global.common_strings().quic_datagram_abandoned();
                if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[id_js, status_js],
                    );
                }
            }
            SessionEvent::EarlyDataFailed => {
                // Node parity: their `closed` promises reject with an
                // application error.
                let code = self.state().internal_error_code.load(Relaxed).max(1);
                self.streams
                    .for_each(|stream| stream.cancel_early_rejected(code));
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
                    let Some(id) = self.inflight_datagrams.with_taken(VecDeque::pop_front) else {
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
                        let vm = global.bun_vm();
                        vm.event_loop().run_callback(
                            bun_event_loop::ContextId::NONE,
                            cb,
                            global,
                            this_value,
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
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
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
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
                        &[array],
                    );
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
                let (old_local_js, old_remote_js, preferred_js) = if self.is_server {
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
                    let vm = global.bun_vm();
                    vm.event_loop().run_callback(
                        bun_event_loop::ContextId::NONE,
                        cb,
                        global,
                        this_value,
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
                self.streams
                    .with(stream, |stream| stream.apply_peer_stop_sending(code));
            }
            SessionEvent::StreamClosed { stream: key } => {
                self.streams
                    .with(key, |stream| self.report_stream_close(global, key, stream));
            }
        }
        Ok(())
    }

    fn stream_handle(&self, key: Key, filter: impl FnOnce(&QuicStream) -> bool) -> Option<JSValue> {
        self.streams
            .with(key, |stream| filter(&stream).then(|| stream.to_js()))?
    }

    fn announce_stream(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        stream: BorrowedWrapper<'_, QuicStream>,
    ) {
        // A remote stream that arrives already-reset while this
        // session's close is in the same batch must never be
        // surfaced (Node's onstream count excludes it).
        if self.conn.is_null() && stream.pre_reset_code().is_some() {
            stream.suppress_announce();
            return;
        }
        if self.peer_cert_rejected.get() {
            stream.suppress_announce();
            return;
        }
        // Already closing: the CONNECTION_CLOSE precedes this
        // stream's packet and a closing endpoint discards new
        // streams (RFC 9000 s10.2.1). Raw QUIC only.
        if self.state().graceful_close.load(Relaxed) == 1 && !self.is_http() {
            stream.suppress_announce();
            stream.raw.close();
            return;
        }
        if stream.is_announce_suppressed() {
            return;
        }
        // Direction (0=bidi, 1=uni) is bit 1 of the stream id
        // (RFC 9000 §2.1).
        let id = stream.stream_id();
        let direction = JSValue::js_number(if id as u64 & STREAM_ID_UNI_BIT != 0 {
            1.0
        } else {
            0.0
        });
        if let Some(cb) = callbacks::get(global, "onStreamCreated") {
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                cb,
                global,
                this_value,
                &[stream.to_js(), direction],
            );
        }
    }

    fn report_stream_close(
        &self,
        global: &JSGlobalObject,
        key: Key,
        stream: BorrowedWrapper<'_, QuicStream>,
    ) {
        if stream.mark_close_reported() {
            return;
        }
        // JS never saw a suppressed stream, so it gets no onStreamClose. It still has to leave `streams`.
        if !stream.is_announce_suppressed() {
            // Runs the parked reader wakeup — user JS, which may destroy this stream.
            stream.end_read_side(global);
            if stream.is_destroyed() {
                return;
            }
            if let Some(cb) = callbacks::get(global, "onStreamClose") {
                let vm = global.bun_vm();
                vm.event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
                    cb,
                    global,
                    stream.to_js(),
                    &[JSValue::UNDEFINED],
                );
            }
        }
        self.remove_stream(key);
    }

    fn maybe_report_handshake(&self, this_value: JSValue, global: &JSGlobalObject, ok: bool) {
        if self.handshake_reported.replace(true) || self.destroyed.get() {
            return;
        }
        let snapshot = self.hsk_snapshot.get();
        let have_peer_cert = snapshot.is_some_and(|s| s.peer_cert_der.is_some());
        let verify_client = ok
            && self.is_server
            && self.endpoint.with(|ep| ep.server_verify_client.get()) == Some(true);
        let cert_ok = !verify_client || have_peer_cert;
        if !cert_ok {
            self.peer_cert_rejected.set(true);
        }
        let open_allowed = ok && !self.peer_cert_rejected.get();
        let max_datagram_size = snapshot
            .filter(|_| ok)
            .and_then(|s| s.peer_transport_params.as_ref())
            .map_or(0, datagram_budget);
        self.state().handshake_completed.store(ok as u8, Relaxed);
        self.state().handshake_confirmed.store(ok as u8, Relaxed);
        self.state()
            .stream_open_allowed
            .store(open_allowed as u8, Relaxed);
        self.state()
            .max_datagram_size
            .store(max_datagram_size, Relaxed);
        if !ok {
            return;
        }
        // Below the bail: a failed handshake sets handshake_completed = 0, so
        // stamping these would show `handshakeCompleted === false` next to a
        // non-zero `handshakeCompletedAt`. Node stamps them only on success.
        self.write_stat(IDX_STATS_SESSION_HANDSHAKE_COMPLETED_AT, now_ns());
        self.write_stat(IDX_STATS_SESSION_HANDSHAKE_CONFIRMED_AT, now_ns());
        let early_data = snapshot.map_or((false, false), |s| s.early_data);
        let sni = opt_bytes_to_js(global, snapshot.and_then(|s| s.sni.as_deref()));
        let cipher = opt_bytes_to_js(global, snapshot.and_then(|s| s.cipher.as_deref()));
        let alpn = opt_bytes_to_js(global, snapshot.and_then(|s| s.alpn.as_deref()));
        let cipher_version = bun_core::String::static_("TLSv1.3")
            .to_js(global)
            .or_report();
        // Node reports both fields only on failure -- the JS 'auto' rejection
        // gates on `validationErrorReason !== undefined` -- and a server with
        // no client certificate reports X509_V_ERR_UNSPECIFIED.
        let pair = match snapshot.and_then(|s| s.validation) {
            Some(pair) => Some(pair),
            None if self.is_server && !have_peer_cert => {
                Some(tls::validation_error_strings(tls::X509_V_ERR_UNSPECIFIED))
            }
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
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                this_value,
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

        if self.qlog_enabled {
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"qlog_version\":\"0.3\",\"qlog_format\":\"JSON-SEQ\",\"title\":\"bun node:quic\"}}\n\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_started\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(this_value, global, &chunk, false);
        }

        // Node destroys the early streams and fires `onearlyrejected` — on
        // the CLIENT only.
        if early_data.0 && !early_data.1 && !self.is_server {
            if let Some(callback) = callbacks::get(global, "onSessionEarlyDataRejected") {
                let vm = global.bun_vm();
                vm.event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
                    callback,
                    global,
                    this_value,
                    &[],
                );
            }
        }

        // Matching Node: the server session exists and then closes with a
        // certificate_required transport error.
        if !cert_ok && !self.destroyed.get() && !self.conn.is_null() {
            self.self_close.set(Some((
                false,
                CRYPTO_ERROR_CERTIFICATE_REQUIRED,
                b"peer did not provide a certificate".to_vec(),
            )));
            self.conn.abort_error(
                false,
                CRYPTO_ERROR_CERTIFICATE_REQUIRED as c_uint,
                c"peer did not provide a certificate",
            );
            self.schedule_process();
        }
    }

    fn peer_verification_refused(&self) -> bool {
        !self.is_server
            && self.reject_unverified_peer
            && self
                .hsk_snapshot
                .get()
                .is_some_and(|s| s.validation.is_some())
    }

    fn capture_hsk_snapshot(&self) {
        let conn = &self.conn;
        self.hsk_snapshot.get_or_init(|| HskSnapshot {
            sni: conn.sni(),
            cipher: conn.cipher(),
            alpn: tls::negotiated_alpn(conn).or_else(|| {
                self.endpoint
                    .with(|ep| ep.configured_alpn(self.is_server))?
            }),
            validation: tls::validation_error(conn),
            peer_cert_der: tls::peer_certificate_der(conn),
            local_cert_der: tls::local_certificate_der(conn),
            ephemeral: tls::ephemeral_key_info(conn),
            early_data: tls::early_data_info(conn),
            peer_transport_params: conn.peer_transport_params(),
        });
    }

    /// Deliver one qlog chunk (RFC 7464 JSON-SEQ records) via
    /// `onSessionQlog(data, fin)`.
    fn emit_qlog(&self, this_value: JSValue, global: &JSGlobalObject, data: &str, fin: bool) {
        if !self.qlog_enabled || self.qlog_fin_sent.get() {
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
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                cb,
                global,
                this_value,
                &[data_js, JSValue::js_boolean(fin)],
            );
        }
    }

    fn report_close(&self, this_value: JSValue, global: &JSGlobalObject) {
        if self.close_reported.replace(true) {
            return;
        }
        self.state().closing.store(1, Relaxed);
        self.write_stat(IDX_STATS_SESSION_DESTROYED_AT, now_ns());
        // Take the close reason before emit_qlog: that runs onSessionQlog,
        // which is user JS and drains microtasks, so a destroy() from inside
        // it would swap the reason this close reports.
        let taken = self.peer_close.take().or_else(|| self.self_close.take());
        if self.qlog_enabled {
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_closed\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(this_value, global, &chunk, true);
        }
        let (error_type, code, reason): (i32, u64, Option<Vec<u8>>) = match taken {
            Some((app, code, reason)) => (if app { 1 } else { 0 }, code, Some(reason)),
            None => match self.conn.status().or_else(|| self.final_conn_status.take()) {
                Some((status, msg)) => map_conn_status(status, msg, self.handshake_reported.get()),
                None => (0, 0, None),
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
        self.endpoint.with(|ep| ep.unregister_session(self.key));
        if let Some(callback) = callbacks::get(global, "onSessionClose") {
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global,
                this_value,
                &[
                    JSValue::js_number(error_type as f64),
                    code_js,
                    reason_js,
                    JSValue::UNDEFINED,
                ],
            );
        }
    }

    pub(super) fn teardown(&self, global: &JSGlobalObject) {
        if self.destroyed.replace(true) {
            return;
        }
        for stream in self.streams.drain() {
            stream.try_with(|stream| {
                stream.raw.unbind();
                stream.teardown(global);
            });
        }
        self.deferred_aborts.take();
        self.pending_local_bidi.with_taken(VecDeque::clear);
        self.pending_local_uni.with_taken(VecDeque::clear);
        self.conn.unbind();
        self.events.with_taken(Vec::clear);
        if let Some(endpoint) = self.endpoint.take() {
            endpoint.try_with(|ep| ep.unregister_session(self.key));
        }
        self.application_options_js.clear();
    }

    pub(crate) fn get_remote_address(&self, cx: &mut JsScope<'_>) -> JSValue {
        self.remote_addr.get().to_js_socket_address(cx.global())
    }
    pub(crate) fn get_local_address(&self, cx: &mut JsScope<'_>) -> JSValue {
        self.local_addr.get().to_js_socket_address(cx.global())
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
            self.self_close.set(Some((app, code, reason.clone())));
        }
        reason.push(0);
        Ok((app, code, reason))
    }

    fn apply_graceful_close(&self, app: bool, code: u64, reason: Vec<u8>) {
        if self.is_http() && !app && code == 0 && self.has_opened_stream() {
            // RFC 9114 §5.2. lsquic can't send a GOAWAY until the handshake creates the
            // control stream. An opened stream proves the handshake finished.
            self.conn.going_away();
            self.close_after_streams.set(true);
            self.deferred_close.set(Some((app, code, reason)));
        } else if self.any_stream_undelivered() {
            self.deferred_close.set(Some((app, code, reason)));
        } else {
            self.apply_close(app, code, &reason);
        }
    }

    /// Applies a graceful close stashed while a dispatch was on the stack.
    /// Returns whether one was applied.
    pub(super) fn flush_pending_graceful(&self) -> bool {
        // A provisional session stashes its close here too, and `apply_close`
        // silently no-ops without a conn — draining it here would consume the
        // close that `on_promoted` is waiting to apply.
        if self.conn.is_null() {
            return false;
        }
        if let Some((app, code, reason)) = self.pending_graceful.take() {
            self.apply_graceful_close(app, code, reason);
            return true;
        }
        false
    }

    fn apply_close(&self, app: bool, code: u64, reason: &[u8]) {
        let c = &self.conn;
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

    /// True if lsquic has opened a stream. Like Node, pending streams don't delay a graceful close.
    fn has_opened_stream(&self) -> bool {
        self.streams.any(|s| !s.is_pending())
    }

    fn any_stream_undelivered(&self) -> bool {
        self.streams
            .any(|s| !s.is_pending() && s.has_undelivered_outbound())
    }

    pub(super) fn maybe_finish_deferred_close(&self) {
        if self.deferred_close.is_none() || self.destroyed.get() {
            return;
        }
        if self.any_stream_undelivered() {
            return;
        }
        if self.close_after_streams.get() && self.has_opened_stream() {
            return;
        }
        if let Some((app, code, reason)) = self.deferred_close.take() {
            self.apply_close(app, code, &reason);
            self.schedule_process();
        }
    }

    pub(crate) fn graceful_close(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        if !self.destroyed.get() {
            // Parse before the latch: a throw here must leave the session
            // untouched, not marked gracefully-closing with no close sent.
            // All three branches below want the same values.
            let (app, code, reason) = self.parse_close_options(global, options.to_js())?;
            self.state().graceful_close.store(1, Relaxed);
            if self.conn.is_null() {
                if self.is_server && !self.close_reported.get() {
                    self.pending_graceful.set(Some((app, code, reason)));
                    self.close_when_bound.set(true);
                } else {
                    self.report_close(this_value.to_js(), global);
                }
            } else {
                if self.endpoint.with(|ep| ep.scope_held()) == Some(true) {
                    self.pending_graceful.set(Some((app, code, reason)));
                } else {
                    self.apply_graceful_close(app, code, reason);
                }
                self.schedule_process();
            }
        }
        Ok(())
    }
    pub(crate) fn destroy(&self, cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if self.destroyed.get() {
            return Ok(());
        }
        let mut parse_error = None;
        if !self.close_reported.get() && !self.conn.is_null() {
            let options = options.to_js();
            if options.is_object() {
                // Node's Destroy with close options. JS has already latched
                // `inner.destroying` and finished its half before reaching
                // here, so teardown() MUST run; a parse failure is taken off
                // the VM (teardown reaches JS) and re-thrown once it has. No
                // close was applied then, so the engines are not driven.
                match self.close_with_options(global, options) {
                    Ok(()) => {
                        self.endpoint.with(|ep| ep.drive_engines_once());
                    }
                    Err(err) => parse_error = Some(global.take_exception(err)),
                }
            } else {
                // Node's server acks the packet that triggered the destroying
                // callback.
                self.conn.ack_now();
                self.endpoint.with(|ep| ep.drive_engines_once());
                // Node parity: Session::Destroy without close options.
                self.conn.abort_silent();
            }
            self.schedule_process();
        }
        self.teardown(global);
        if let Some(err) = parse_error {
            return Err(global.throw_value(err));
        }
        Ok(())
    }
    pub(crate) fn open_stream(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        direction: JsLocal<'_>,
        body: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.destroyed.get() || self.conn.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        let direction = direction.to_js();
        let body = body.to_js();
        let unidirectional = direction.is_number() && direction.as_number() == 1.0;
        let key = self.streams.next_key();
        let stream = QuicStream::create(global, StrongWrapper::new(this_value, global), key)?;
        if let Some(buf) = body.as_array_buffer(global) {
            // As in attach_source: a later setOutbound() throws instead of adding a second body.
            stream.payload().set_body(buf.byte_slice());
        }
        let handle = stream.to_js();
        self.streams.insert(key, stream);
        self.pending_local_streams(unidirectional)
            .with_taken(|q| q.push_back(key));
        self.bump_stream_stat(if unidirectional { STREAM_ID_UNI_BIT } else { 0 }, true);
        self.endpoint
            .with(|ep| ep.make_stream(self.is_server, &self.conn, unidirectional));
        self.schedule_process();
        Ok(handle)
    }
    pub(crate) fn send_datagram(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.destroyed.get() || self.conn.is_null() {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        let data = data.to_js();
        let Some(buf) = data.as_array_buffer(global) else {
            return JSValue::from_uint64_no_truncate(global, 0);
        };
        // HTTP/3: the peer must have advertised SETTINGS_H3_DATAGRAM
        // (RFC 9297 §2.1.1); otherwise not sent (0n).
        if self.is_http() && self.conn.peer_h3_datagram() == Some(false) {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        // Oversized for the negotiated budget: not sent (Node returns 0n).
        let max_size = self.state().max_datagram_size.load(Relaxed);
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
        let max_pending = self.state().max_pending_datagrams.load(Relaxed);
        if max_pending > 0 && self.datagram_queue.with_taken(|q| q.len()) >= max_pending as usize {
            // Node reports the abandonment synchronously from within
            // sendDatagram.
            if self.datagram_drop_newest {
                self.report_datagram_abandoned(this_value.to_js(), global, id)?;
                self.state().last_datagram_id.store(id, Relaxed);
                return JSValue::from_uint64_no_truncate(global, id);
            }
            if let Some((dropped_id, _)) = self.datagram_queue.with_taken(VecDeque::pop_front) {
                // Runs the user's `ondatagramstatus`, which can destroy this
                // session or close the conn before we get back here.
                self.report_datagram_abandoned(this_value.to_js(), global, dropped_id)?;
                if self.destroyed.get() || self.conn.is_null() {
                    return JSValue::from_uint64_no_truncate(global, 0);
                }
            }
        }
        self.datagram_queue
            .with_taken(|q| q.push_back((id, payload)));
        self.state().last_datagram_id.store(id, Relaxed);
        self.conn.want_datagram_write(true);
        self.schedule_process();
        JSValue::from_uint64_no_truncate(global, id)
    }
    /// Runs inside `sendDatagram`: what building the status left pending is
    /// thrown from there.
    fn report_datagram_abandoned(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        id: u64,
    ) -> JsResult<()> {
        if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
            return Ok(());
        }
        let id_js = JSValue::from_uint64_no_truncate(global, id)?;
        let status_js = global.common_strings().quic_datagram_abandoned();
        if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
            let vm = global.bun_vm();
            vm.event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                cb,
                global,
                this_value,
                &[id_js, status_js],
            );
        }
        Ok(())
    }

    /// Node's JS layer discards this return value, matching upstream.
    pub(crate) fn update_key(&self) -> bool {
        false
    }
    pub(crate) fn get_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(der) = tls::local_certificate_der(&self.conn) {
            return ArrayBuffer::create_buffer(global, der.as_slice());
        }
        if let Some(der) = self
            .hsk_snapshot
            .get()
            .and_then(|s| s.local_cert_der.as_deref())
        {
            return ArrayBuffer::create_buffer(global, der);
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn get_peer_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(der) = tls::peer_certificate_der(&self.conn) {
            return ArrayBuffer::create_buffer(global, &der);
        }
        if let Some(der) = self
            .hsk_snapshot
            .get()
            .and_then(|s| s.peer_cert_der.as_deref())
        {
            return ArrayBuffer::create_buffer(global, der);
        }
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn get_ephemeral_key(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let Some((kind, name, bits)) = tls::ephemeral_key_info(&self.conn)
            .or_else(|| self.hsk_snapshot.get().and_then(|s| s.ephemeral))
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
    pub(crate) fn application_options(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(stored) = self.application_options_js.get() {
            return Ok(stored);
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
        self.application_options_js.set(Strong::create(obj, global));
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

/// Returns the largest DATAGRAM payload the peer's transport parameters allow.
fn datagram_budget(tp: &lsquic::NqTransportParams) -> u16 {
    tp.max_datagram_frame_size
        .saturating_sub(DATAGRAM_FRAME_OVERHEAD)
        .min(DATAGRAM_PAYLOAD_BUDGET) as u16
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
    pub(crate) fn local_transport_params(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        match self.endpoint.with(|ep| ep.local_tp(self.is_server)) {
            Some(tp) => Self::transport_params_to_js(global, &tp),
            None => Ok(JSValue::UNDEFINED),
        }
    }
    pub(crate) fn remote_transport_params(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(tp) = self.conn.peer_transport_params() {
            return Self::transport_params_to_js(global, &tp);
        }
        match self
            .hsk_snapshot
            .get()
            .and_then(|s| s.peer_transport_params.as_ref())
        {
            Some(tp) => Self::transport_params_to_js(global, tp),
            None => Ok(JSValue::UNDEFINED),
        }
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

impl QuicSession {
    pub(super) fn on_goaway_received(&self) {
        self.push_event(SessionEvent::GoawayReceived);
    }

    pub(super) fn on_hsk_confirmed(&self) {
        self.push_event(SessionEvent::HandshakeConfirmed);
    }

    pub(super) fn on_hsk_done(&self, status: c_int) {
        if status != lsquic::LSQ_HSK_OK && status != lsquic::LSQ_HSK_RESUMED_OK {
            self.push_event(SessionEvent::HandshakeDone { ok: false });
            return;
        }
        self.note_handshake_ok();
        if self.peer_verification_refused() {
            self.peer_cert_rejected.set(true);
            self.self_close.set(Some((
                false,
                CRYPTO_ERROR_BAD_CERTIFICATE,
                b"peer certificate verification failed".to_vec(),
            )));
            self.conn.abort_error(
                false,
                CRYPTO_ERROR_BAD_CERTIFICATE as c_uint,
                c"peer certificate verification failed",
            );
        }
    }

    pub(super) fn on_new_stream(this: BorrowedWrapper<'_, Self>, raw: &lsquic::Stream) {
        let Some(id) = raw.id() else { return };
        let is_local = (id & 1 == 0) != this.is_server;
        if is_local {
            this.on_local_stream(raw, id & STREAM_ID_UNI_BIT != 0);
        } else {
            Self::on_remote_stream(this, raw, id);
        }
    }

    fn on_local_stream(&self, raw: &lsquic::Stream, uni: bool) {
        // Skip streams that `remove_stream` removed. Stopping at the first
        // one would strand the live request behind it until the next
        // MAX_STREAMS grant.
        let queue = self.pending_local_streams(uni);
        while let Some(key) = queue.with_taken(VecDeque::pop_front) {
            let opened = self.streams.with_taken(key, |pending| {
                pending.bind(raw);
                pending.payload().on_opened(self.is_server);
            });
            if opened.is_some() {
                self.push_event(SessionEvent::StreamReady {
                    stream: key,
                    remote: false,
                });
                return;
            }
        }
        raw.shutdown_internal();
    }

    pub(super) fn on_conn_closed(&self, status: Option<(c_int, Vec<u8>)>) {
        self.deferred_aborts.take();
        self.final_conn_status.set(status);
        self.push_event(SessionEvent::Closed);
    }

    pub(super) fn on_conncloseframe(&self, app_error: bool, code: u64, reason: &[u8]) {
        self.push_event(SessionEvent::PeerClose {
            app_error,
            code,
            reason: reason.to_vec(),
        });
    }

    pub(super) fn on_new_token(&self, token: &[u8]) {
        if !token.is_empty() {
            self.push_event(SessionEvent::NewToken(token.to_vec()));
        }
    }

    pub(super) fn on_sess_resume(&self, blob: &[u8]) {
        if !blob.is_empty() {
            self.push_event(SessionEvent::SessionResume(blob.to_vec()));
        }
    }

    pub(super) fn on_keylog(&self, line: &[u8]) {
        self.push_event(SessionEvent::Keylog(line.to_vec()));
    }

    /// Returns how many bytes were written to `buf`.
    pub(super) fn on_dg_write(&self, buf: &mut [MaybeUninit<u8>]) -> Option<usize> {
        self.datagram_queue.with_taken(|queue| {
            let Some(&(id, ref payload)) = queue.front() else {
                self.conn.want_datagram_write(false);
                return None;
            };
            let len = payload.len();
            if len > buf.len() {
                let max = self.state().max_datagram_size.load(Relaxed) as usize;
                if max == 0 || len > max {
                    queue.pop_front();
                    self.push_event(SessionEvent::DatagramStatus { id, sent: false });
                    self.conn.want_datagram_write(!queue.is_empty());
                }
                return None;
            }
            buf[..len].write_copy_of_slice(payload);
            queue.pop_front();
            self.push_event(SessionEvent::DatagramStatus { id, sent: true });
            if !queue.is_empty() {
                self.conn.want_datagram_write(true);
            }
            Some(len)
        })
    }

    pub(super) fn on_datagram_status(&self, count: c_uint, acked: bool) {
        if count != 0 {
            self.push_event(SessionEvent::DatagramAckStatus { count, acked });
        }
    }

    pub(super) fn on_early_data_failed(&self) {
        // Front of the queue: lsquic resets the early streams before this
        // callback, so their clean closes are already queued and would settle
        // `closed` before the rejection node delivers could land.
        self.events
            .with_taken(|e| e.insert(0, SessionEvent::EarlyDataFailed));
        self.schedule_process();
    }

    pub(super) fn on_origin(&self, chunk: &[u8], fin: bool) {
        self.origin_buf.with_taken(|b| {
            let room = MAX_ORIGIN_BYTES.saturating_sub(b.len());
            b.extend_from_slice(&chunk[..chunk.len().min(room)]);
        });
        if fin {
            self.push_event(SessionEvent::Origin(self.origin_buf.take()));
        }
    }

    pub(super) fn on_path_switch(
        &self,
        validated: bool,
        preferred: bool,
        new_local: &StoredAddr,
        new_peer: &StoredAddr,
        old_local: &StoredAddr,
        old_peer: &StoredAddr,
    ) {
        self.push_event(SessionEvent::PathValidation {
            validated,
            preferred,
            new_local: *new_local,
            new_remote: *new_peer,
            old_local: *old_local,
            old_remote: *old_peer,
        });
    }

    pub(super) fn on_datagram(&self, payload: &[u8]) {
        self.push_event(SessionEvent::Datagram {
            payload: payload.to_vec(),
            early: self.conn.datagram_early(),
        });
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
