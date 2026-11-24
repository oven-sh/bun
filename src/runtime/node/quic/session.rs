//! Node's `internalBinding('quic').Session` analog (node/src/quic/session.{h,cc}).

use core::cell::Cell;
use core::net::{IpAddr, SocketAddr};
use core::ptr::null_mut;
use std::collections::VecDeque;

use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    ArrayBuffer, JSGlobalObject, JSValue, JsCell, JsClass as _, JsRef, JsResult, StringJsc, Strong,
};
use bun_quic::http3::{Fields, Header, Section};
use bun_quic::{
    Addresses, CloseReason, Connection, ConnectionId, Direction, Duration, Event, Handle, Instant,
    Layer, StreamEvent, StreamId, TransportParameters, http3_code, transport_code,
};
use bun_uws::quic::io::now;

use super::callbacks;
use super::endpoint::{MS_PER_SEC, QuicEndpoint, alloc_exposed_array_buffer, socket_address};
use super::now_ns;
use super::stream::{
    QUIC_STREAM_HEADERS_KIND_HINTS, QUIC_STREAM_HEADERS_KIND_INITIAL,
    QUIC_STREAM_HEADERS_KIND_TRAILING, QuicStream,
};
use super::tls;

bun_core::declare_scope!(quic_session, hidden);

/// DATAGRAM frame overhead: type byte + 2-byte length varint (RFC 9221 §4).
const DATAGRAM_FRAME_OVERHEAD: u64 = 3;
const DATAGRAM_PAYLOAD_BUDGET: u64 = 1150;
/// RFC 8446 §6.2.
const CRYPTO_ERROR_CERTIFICATE_REQUIRED: u64 = transport_code::CRYPTO_ERROR + 116;
pub(super) const CRYPTO_ERROR_HANDSHAKE_FAILURE: u64 = transport_code::CRYPTO_ERROR + 40;
const CRYPTO_ERROR_BAD_CERTIFICATE: u64 = transport_code::CRYPTO_ERROR + 42;

/// The `type` of `onSessionClose`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum CloseType {
    Transport = 0,
    Application = 1,
    VersionNegotiation = 2,
    Idle = 3,
}

impl From<Layer> for CloseType {
    fn from(layer: Layer) -> Self {
        match layer {
            Layer::Transport => Self::Transport,
            Layer::Application => Self::Application,
        }
    }
}

/// With the code and the reason.
type Close<T> = (T, u64, Vec<u8>);

const LISTENER_FLAG_PATH_VALIDATION: u32 = 0x1;
const LISTENER_FLAG_DATAGRAM: u32 = 0x2;
const LISTENER_FLAG_DATAGRAM_STATUS: u32 = 0x4;
const LISTENER_FLAG_SESSION_TICKET: u32 = 0x8;
const LISTENER_FLAG_NEW_TOKEN: u32 = 0x10;
const LISTENER_FLAG_ORIGIN: u32 = 0x20;
const LISTENER_FLAG_STREAM: u32 = 0x40;
const MAX_EARLY_EVENTS: usize = 512;
const MAX_EARLY_LEN: u64 = 256 * 1024;

/// RFC 9412 sec 2: each Origin-Entry is a 16-bit length prefix followed by
/// the ASCII origin.
const ORIGIN_LEN_PREFIX: usize = 2;

/// Mirrors node's `Session::Application::Type` (node/src/quic/application.h).
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(super) enum Application {
    /// Used by version-negotiation probes, which have no connection.
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

const TICKET_DELIVERY_DELAY: Duration = Duration::from_millis(500);
/// For how long a peer that cannot send more has to wait for a reader.
const READER_DELAY: Duration = Duration::from_secs(1);
const CLOSING_PROGRESS_TIMEOUT: Duration = Duration::from_secs(60);
/// Those that wait for more take up room.
const MIN_PENDING_DATAGRAMS_TO_GATHER: u16 = 64;

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

pub(super) fn address_to_js(global: &JSGlobalObject, address: Option<SocketAddr>) -> JSValue {
    address.map_or(JSValue::UNDEFINED, |it| socket_address(it).to_js(global))
}

/// Mirrors Node's `Session::State` (`SESSION_STATE` in session.cc). The
/// `IDX_STATE_SESSION_*` constants on the binding are `offset_of!` values
/// into this struct, so the layout must stay in sync with what the JS layer
/// reads (`src/js/internal/quic/state.ts`).
#[repr(C)]
pub(crate) struct SessionState {
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

/// Copied, because the connection can be gone by the time the handshake is reported.
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
    peer_transport_params: Option<TransportParameters>,
}

pub(super) enum SessionEvent {
    HandshakeDone,
    /// `None` if it is what this side asked for.
    Closed(Option<Close<CloseType>>),
    StreamReady {
        stream: super::stream::Key,
    },
    StreamWake {
        stream: super::stream::Key,
    },
    StreamDrain {
        stream: super::stream::Key,
    },
    /// Unlike data, the end of a stream takes no credit.
    StreamEnd {
        stream: super::stream::Key,
    },
    StreamBlocked {
        stream: super::stream::Key,
    },
    StreamReset {
        stream: super::stream::Key,
        code: u64,
    },
    StreamStopSending {
        stream: super::stream::Key,
        code: u64,
    },
    StreamWantsTrailers {
        stream: super::stream::Key,
    },
    StreamHeaders {
        stream: super::stream::Key,
        fields: Fields,
    },
    NewToken(Vec<u8>),
    Keylog(Vec<u8>),
    SessionResume(Vec<u8>),
    StreamClosed {
        stream: super::stream::Key,
    },
    HandshakeConfirmed,
    GoawayReceived {
        overtakes_data: bool,
    },
    Datagram {
        payload: Vec<u8>,
        early: bool,
    },
    DatagramAbandoned(u64),
    DatagramAckStatus {
        id: u64,
        acked: bool,
    },
    /// HTTP/3 ORIGIN frame payload (RFC 9412).
    Origin(Vec<u8>),
    /// Version Negotiation packet (RFC 8999 sec 6).
    VersionNegotiation {
        server_versions: Vec<u32>,
    },
    PathValidation {
        preferred: bool,
        paths: Box<(Addresses, Addresses)>,
    },
}

pub(crate) struct QuicSession {
    conn: Cell<Option<Handle>>,
    /// The owning endpoint (raw pointer; the JS-side Strong keeps it alive).
    endpoint: Cell<*mut QuicEndpoint>,
    endpoint_js: JsCell<Option<Strong>>,
    is_server: bool,
    application: Application,
    local_addr: Cell<Option<SocketAddr>>,
    pub(super) remote_addr: Cell<Option<SocketAddr>>,
    local_transport_params: JsCell<TransportParameters>,
    /// Borrowed views into JSC-owned ArrayBuffers (see endpoint.rs `state`).
    state: Cell<*mut SessionState>,
    stats: Cell<*mut u64>,
    events: JsCell<VecDeque<SessionEvent>>,
    /// For listeners that may be set after `opened`.
    early_events: JsCell<Vec<SessionEvent>>,
    holds_early_events: Cell<bool>,
    /// A graceful close requested while a dispatch was on the stack: applied
    /// on the next depth-0 pass so its GOAWAY/CONNECTION_CLOSE does not share
    /// a flight with data written by the same dispatch (node's close lands an
    /// RTT after the data because its stream close is ack-gated).
    pending_graceful: JsCell<Option<Close<Layer>>>,
    pub(super) verneg: Cell<Option<(u32, u32)>>,
    self_close: JsCell<Option<Close<Layer>>>,
    datagram_drop_newest: Cell<bool>,
    qlog_enabled: Cell<bool>,
    qlog_fin_sent: Cell<bool>,
    /// Monotonic id assigned by `sendDatagram` (Node returns it as a BigInt).
    next_datagram_id: Cell<u64>,
    ticket_delivered: Cell<bool>,
    pending_tickets: JsCell<VecDeque<(Instant, Vec<u8>)>>,
    unclaimed_streams: JsCell<VecDeque<(Instant, super::stream::Key)>>,
    held_stream_closes: JsCell<Vec<super::stream::Key>>,
    /// See [`QuicEndpoint::mark`].
    pub(super) is_marked: Cell<bool>,
    /// What it counts for in `maxConnectionsPerHost`.
    pub(super) host: Cell<Option<IpAddr>>,
    close_after_streams: Cell<bool>,
    pending_local_bidi: JsCell<VecDeque<super::stream::Key>>,
    pending_local_uni: JsCell<VecDeque<super::stream::Key>>,
    /// In the order of their keys.
    streams: JsCell<Vec<(super::stream::Key, *mut QuicStream)>>,
    next_stream_key: Cell<u64>,
    handshake_reported: Cell<bool>,
    new_token_reported: Cell<bool>,
    is_close_deferred: Cell<bool>,
    handshake_pending_ok: Cell<bool>,
    reject_unverified_peer: Cell<bool>,
    peer_cert_rejected: Cell<bool>,
    hsk_snapshot: JsCell<Option<HskSnapshot>>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
    application_options_js: JsCell<Option<Strong>>,
    pub(crate) this_value: JsCell<JsRef>,
    global: Cell<*const JSGlobalObject>,
}

impl QuicSession {
    fn new(global: &JSGlobalObject, is_server: bool, application: Application) -> Self {
        Self {
            conn: Cell::new(None),
            endpoint: Cell::new(null_mut()),
            endpoint_js: JsCell::new(None),
            is_server,
            application,
            local_addr: Cell::new(None),
            remote_addr: Cell::new(None),
            local_transport_params: JsCell::new(TransportParameters::default()),
            state: Cell::new(null_mut()),
            stats: Cell::new(null_mut()),
            events: JsCell::new(VecDeque::new()),
            early_events: JsCell::new(Vec::new()),
            holds_early_events: Cell::new(is_server),
            pending_graceful: JsCell::new(None),
            verneg: Cell::new(None),
            self_close: JsCell::new(None),
            datagram_drop_newest: Cell::new(false),
            qlog_enabled: Cell::new(false),
            qlog_fin_sent: Cell::new(false),
            next_datagram_id: Cell::new(1),
            ticket_delivered: Cell::new(false),
            pending_tickets: JsCell::new(VecDeque::new()),
            unclaimed_streams: JsCell::new(VecDeque::new()),
            held_stream_closes: JsCell::new(Vec::new()),
            is_marked: Cell::new(false),
            host: Cell::new(None),
            close_after_streams: Cell::new(false),
            pending_local_bidi: JsCell::new(VecDeque::new()),
            pending_local_uni: JsCell::new(VecDeque::new()),
            streams: JsCell::new(Vec::new()),
            next_stream_key: Cell::new(0),
            handshake_reported: Cell::new(false),
            new_token_reported: Cell::new(false),
            is_close_deferred: Cell::new(false),
            handshake_pending_ok: Cell::new(false),
            reject_unverified_peer: Cell::new(true),
            peer_cert_rejected: Cell::new(false),
            hsk_snapshot: JsCell::new(None),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
            application_options_js: JsCell::new(None),
            this_value: JsCell::new(JsRef::empty()),
            global: Cell::new(core::ptr::from_ref(global)),
        }
    }

    pub(super) fn create<'a>(
        global: &JSGlobalObject,
        endpoint: &'a QuicEndpoint,
        endpoint_handle: JSValue,
        is_server: bool,
        application: Application,
    ) -> JsResult<(&'a QuicSession, JSValue)> {
        let this_value = Self::new(global, is_server, application).into_js_wrapper(global);
        let handle = this_value.to_js();
        let raw = this_value.payload_ptr().as_ptr();

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

        // SAFETY: the payload of `handle`, which this frame holds. The strong ref set below roots
        // it until `teardown`; after that the frame that has the reference holds it. Only `&` is
        // formed to the payload before the sweeper drops it.
        let this = unsafe { &*raw };
        #[expect(
            clippy::cast_ptr_alignment,
            reason = "`state_ptr` is the base of a fresh JSC ArrayBuffer (byteOffset 0); JSC allocates its backing store through Gigacage/fastMalloc, which is at least 16-byte aligned"
        )]
        this.state.set(state_ptr.cast::<SessionState>());
        // This is the only write to the application fields, like node's `Session::SetApplication`.
        this.with_state(|s| {
            s.no_error_code = 0;
            s.internal_error_code = 1;
            s.stream_open_allowed = 1;
            s.application_type = application as u8;
            match application {
                Application::None => {}
                Application::Default => s.headers_supported = HEADERS_UNSUPPORTED,
                Application::Http3 => {
                    s.headers_supported = HEADERS_SUPPORTED;
                    s.priority_supported = 1;
                    s.no_error_code = http3_code::NO_ERROR;
                    s.internal_error_code = http3_code::INTERNAL_ERROR;
                }
            }
        });
        #[expect(
            clippy::cast_ptr_alignment,
            reason = "`stats_ptr` is the base of a fresh JSC ArrayBuffer (byteOffset 0), 16-byte aligned as above"
        )]
        this.stats.set(stats_ptr.cast::<u64>());
        this.endpoint.set(core::ptr::from_ref(endpoint).cast_mut());
        this.endpoint_js
            .set(Some(Strong::create(endpoint_handle, global)));
        this_value.set_js_ref_strong(global);
        this.write_stat(IDX_STATS_SESSION_CREATED_AT, now_ns());
        Ok((this, handle))
    }

    pub(super) fn bind(&self, conn: Handle) {
        self.conn.set(Some(conn));
        self.update(|conn| {
            conn.context = core::ptr::from_ref(self).cast_mut().cast();
            self.set_addresses(conn.addresses());
            (self.local_transport_params).set(conn.local_parameters().clone());
        });
    }

    fn set_addresses(&self, addresses: &Addresses) {
        self.local_addr.set(Some(addresses.local));
        self.remote_addr.set(Some(addresses.peer));
    }

    /// `f` must not call into JavaScript.
    pub(super) fn get<T>(&self, f: impl FnOnce(&Connection) -> T) -> Option<T> {
        let conn = self.conn.get()?;
        self.endpoint_ref()?.quic().get(conn).map(f)
    }

    /// `f` must not call into JavaScript.
    pub(super) fn update<T>(&self, f: impl FnOnce(&mut Connection) -> T) -> Option<T> {
        let conn = self.conn.get()?;
        self.endpoint_ref()?.quic().get_mut(conn).map(f)
    }

    pub(super) fn send_headers(&self, id: StreamId, headers: &[Header]) -> bool {
        (self.conn.get().zip(self.endpoint_ref()))
            .is_some_and(|(conn, ep)| ep.quic().send_headers(conn, id, headers.iter().copied()))
    }

    fn state_mut(&self) -> *mut SessionState {
        self.state.get()
    }
    /// Run `f` against the shared state buffer. The buffer is a JSC
    /// ArrayBuffer owned by the JS wrapper: it is allocated in `create()`
    /// before any other method can run, outlives `self` (the wrapper keeps
    /// both alive), and is only touched from the JS thread — so the single
    /// raw access below is in-bounds and unaliased.
    fn with_state<R>(&self, f: impl FnOnce(&mut SessionState) -> R) -> R {
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
    pub(super) fn push_event(&self, event: SessionEvent) {
        self.events.with_mut(|e| e.push_back(event));
        self.mark();
    }
    pub(super) fn has_events(&self) -> bool {
        !self.events.get().is_empty()
    }
    fn mark(&self) {
        if let Some(ep) = self.endpoint_ref() {
            ep.mark(self);
        }
    }
    pub(super) fn on_activity(&self, conn: &Connection) {
        self.refresh_conn_stats(conn);
        if self.is_close_deferred.get() {
            self.mark();
        }
    }
    /// The `endpoint_js` Strong keeps it alive while this session holds the
    /// back-pointer; teardown nulls the pointer before that Strong is
    /// dropped, so a non-null pointer is always dereferenceable on the JS
    /// thread.
    fn endpoint_ref(&self) -> Option<&QuicEndpoint> {
        let p = self.endpoint.get();
        // SAFETY: see doc comment.
        (!p.is_null()).then(|| unsafe { &*p })
    }
    pub(super) fn schedule_process(&self) {
        if let Some(ep) = self.endpoint_ref() {
            ep.schedule_process();
        }
    }
    pub(super) fn flushes_at_once(&self) -> bool {
        self.endpoint_ref().is_some_and(|ep| !ep.scope_held())
    }
    pub(super) fn mark_pending(&self) {
        if let Some(ep) = self.endpoint_ref() {
            ep.mark_driver_pending();
        }
    }
    fn pending_streams(&self, direction: Direction) -> &JsCell<VecDeque<super::stream::Key>> {
        match direction {
            Direction::Bidirectional => &self.pending_local_bidi,
            Direction::Unidirectional => &self.pending_local_uni,
        }
    }
    fn open_pending_streams(&self, direction: Direction) {
        let queue = self.pending_streams(direction);
        while let Some(&key) = queue.get().front() {
            if let Some(stream) = self.live_stream(key) {
                let id = self.update(|conn| conn.open(direction, null_mut()));
                let Some(id) = id.flatten() else {
                    return;
                };
                stream.bind(id, true);
            }
            queue.with_mut(VecDeque::pop_front);
        }
    }
    /// Creates a stream for this session and registers it.
    fn create_stream(
        &self,
        global: &JSGlobalObject,
        session_handle: JSValue,
    ) -> JsResult<(super::stream::Key, &QuicStream, JSValue)> {
        let key = super::stream::Key(self.next_stream_key.replace(self.next_stream_key.get() + 1));
        let (qs, handle) = QuicStream::create(global, self, key, session_handle)?;
        self.streams
            .with_mut(|v| v.push((key, core::ptr::from_ref(qs).cast_mut())));
        Ok((key, qs, handle))
    }
    pub(super) fn remove_stream(&self, key: super::stream::Key) {
        self.streams.with_mut(|v| {
            if let Ok(at) = v.binary_search_by_key(&key, |it| it.0) {
                v.remove(at);
            }
        });
    }
    fn bump_stream_stat(&self, direction: Direction, local: bool) {
        let idx = match (direction, local) {
            (Direction::Bidirectional, false) => IDX_STATS_SESSION_BIDI_IN_STREAM_COUNT,
            (Direction::Bidirectional, true) => IDX_STATS_SESSION_BIDI_OUT_STREAM_COUNT,
            (Direction::Unidirectional, false) => IDX_STATS_SESSION_UNI_IN_STREAM_COUNT,
            (Direction::Unidirectional, true) => IDX_STATS_SESSION_UNI_OUT_STREAM_COUNT,
        };
        self.add_stat(idx, 1);
    }

    fn on_remote_stream(&self, id: StreamId) {
        // SAFETY: sessions only exist on the JS thread of this realm.
        let global = unsafe { &*self.global.get() };
        match self.create_stream(global, self.handle()) {
            Ok((stream, qs, _handle)) => {
                qs.bind(id, false);
                self.push_event(SessionEvent::StreamReady { stream });
            }
            Err(e) => {
                let code = self.with_state(|s| s.internal_error_code);
                self.update(|conn| {
                    conn.reset(id, code);
                    conn.stop(id, code);
                });
                crate::dispatch::fold(Err(e));
            }
        }
    }

    /// test-quic-callback-error-stream-onerror.mjs destroys a stream, writes to the next one and expects one `onstream`.
    fn is_replaced(&self, stream: &QuicStream) -> bool {
        if !self.is_server || self.is_http3() || !stream.arrived_spent() {
            return false;
        }
        let next = self.events.get().iter().find_map(|it| match *it {
            SessionEvent::StreamReady { stream } => Some(stream),
            _ => None,
        });
        (next.and_then(|it| self.live_stream(it)))
            .is_some_and(|it| it.stream_id() == stream.stream_id() + 4 && it.has_received())
    }

    fn refresh_conn_stats(&self, conn: &Connection) {
        let stats = conn.stats();
        let nanos = |it: bun_quic::Duration| it.as_micros().saturating_mul(1000);
        for (idx, value) in [
            (IDX_STATS_SESSION_BYTES_RECEIVED, stats.bytes_received),
            (IDX_STATS_SESSION_BYTES_SENT, stats.bytes_sent),
            (
                IDX_STATS_SESSION_LOSS_RETRANSMIT_COUNT,
                stats.packets_retransmitted,
            ),
            (IDX_STATS_SESSION_CWND, stats.congestion_window),
            (IDX_STATS_SESSION_LATEST_RTT, nanos(stats.smoothed_rtt)),
            (IDX_STATS_SESSION_MIN_RTT, nanos(stats.min_rtt)),
            (IDX_STATS_SESSION_RTTVAR, nanos(stats.rtt_variation)),
            (IDX_STATS_SESSION_SMOOTHED_RTT, nanos(stats.smoothed_rtt)),
            (IDX_STATS_SESSION_DATAGRAMS_SENT, stats.datagrams_sent),
            (IDX_STATS_SESSION_PKT_SENT, stats.packets_sent),
            (IDX_STATS_SESSION_PKT_RECV, stats.packets_received),
            (IDX_STATS_SESSION_PKT_LOST, stats.packets_lost),
            (IDX_STATS_SESSION_BYTES_RECV, stats.bytes_received),
            (IDX_STATS_SESSION_PING_RECV, stats.pings_received),
        ] {
            self.write_stat(idx, value);
        }
    }

    fn live_stream(&self, key: super::stream::Key) -> Option<&QuicStream> {
        let streams = self.streams.get();
        let at = streams.binary_search_by_key(&key, |it| it.0).ok()?;
        // SAFETY: teardown unregisters a stream before freeing it, so a
        // registered pointer is live on the JS thread.
        Some(unsafe { &*streams[at].1 })
    }

    pub(super) fn apply_peer_datagram_budget(&self) {
        if let Some(Some(budget)) = self.get(|c| c.peer_parameters().map(datagram_budget)) {
            self.with_state(|s| s.max_datagram_size = budget);
        }
    }

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
        let (now, has_streams) = (now(), !self.streams.get().is_empty());
        while let Some((_, blob)) =
            (self.pending_tickets).with_mut(|q| q.pop_front_if(|(at, _)| has_streams || *at <= now))
        {
            if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                continue;
            }
            let buf = ArrayBuffer::create_buffer(global, &blob).or_report();
            callbacks::run(global, "onSessionTicket", self.handle(), &[buf]);
            if self.destroyed.get() {
                return;
            }
        }
        self.plan_ticket_delivery();
    }

    fn plan_ticket_delivery(&self) {
        if let (Some(ep), Some(it)) = (self.endpoint_ref(), self.pending_tickets.get().front()) {
            ep.plan_pass(it.0);
        }
    }

    pub(super) fn await_readers(&self) {
        let deadline = now() + READER_DELAY;
        for &(key, _) in self.streams.get() {
            if self.live_stream(key).is_some_and(QuicStream::await_reader) {
                (self.unclaimed_streams).with_mut(|q| q.push_back((deadline, key)));
            }
        }
        self.mark();
        self.mark_pending();
    }

    fn drop_unclaimed_streams(&self) {
        while let Some(&(at, key)) = self.unclaimed_streams.get().front() {
            if at > now() {
                self.endpoint_ref().inspect(|ep| ep.plan_pass(at));
                return;
            }
            self.unclaimed_streams.with_mut(VecDeque::pop_front);
            if let Some(stream) = self.live_stream(key) {
                stream.drop_if_unclaimed();
                self.schedule_process();
            }
        }
    }

    pub(super) fn process_events(&self, global: &JSGlobalObject) {
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
            if dispatched_js && let Some(endpoint) = self.endpoint_ref() {
                endpoint.drive_if_overdue(self);
            }
            if self.holds_early_events.get() && !self.is_early() {
                self.holds_early_events.set(false);
                let early = self.early_events.with_mut(core::mem::take).into_iter();
                (self.events).with_mut(|e| early.rev().for_each(|it| e.push_front(it)));
            }
            let Some(event) = self.events.with_mut(VecDeque::pop_front) else {
                break;
            };
            if self.holds_early_events.get() && self.lacks_listener(&event) {
                self.early_events.with_mut(|e| e.push(event));
                continue;
            }
            if let SessionEvent::GoawayReceived {
                overtakes_data: true,
            } = event
            {
                self.events.with_mut(|e| {
                    let at = e.iter().position(|it| {
                        matches!(
                            it,
                            SessionEvent::Closed(_) | SessionEvent::StreamReset { .. }
                        )
                    });
                    let event = SessionEvent::GoawayReceived {
                        overtakes_data: false,
                    };
                    e.insert(at.unwrap_or(e.len()), event);
                });
                continue;
            }
            let endpoint = self.endpoint.get();
            // SAFETY: teardown clears `endpoint` before the endpoint can die.
            let defer_closes = !endpoint.is_null() && unsafe { (*endpoint).defer_closes.get() };
            let is_deferred = match event {
                SessionEvent::Closed(_) | SessionEvent::GoawayReceived { .. } => {
                    dispatched_js || defer_closes
                }
                // What waits for `opened` has to run ahead of them.
                SessionEvent::HandshakeDone => defer_closes && !self.early_events.get().is_empty(),
                _ => false,
            };
            if is_deferred {
                self.events.with_mut(|e| e.push_front(event));
                self.schedule_process();
                break;
            }
            dispatched_js = true;
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
        self.drop_unclaimed_streams();
        if self.finish_deferred_close() {
            self.schedule_process();
        }
        if self.has_events()
            || self.pending_graceful.get().is_some()
            || !self.pending_tickets.get().is_empty()
            || !self.unclaimed_streams.get().is_empty()
        {
            self.mark();
        }
    }

    fn is_early(&self) -> bool {
        !self.handshake_reported.get()
            && self.early_events.get().len() < MAX_EARLY_EVENTS
            && (self.get(|it| it.stats().bytes_received < MAX_EARLY_LEN)).unwrap_or_else(|| {
                (self.events.get().iter()).any(|it| matches!(it, SessionEvent::HandshakeDone))
            })
    }

    fn lacks_listener(&self, event: &SessionEvent) -> bool {
        let is_stream = |it: &SessionEvent| matches!(it, SessionEvent::StreamReady { .. });
        match event {
            SessionEvent::HandshakeDone => false,
            SessionEvent::Datagram { .. } => !self.has_listener(LISTENER_FLAG_DATAGRAM),
            _ => {
                is_stream(event) && !self.has_listener(LISTENER_FLAG_STREAM)
                    || self.early_events.get().iter().any(is_stream)
            }
        }
    }

    /// One queued event's delivery. A value that cannot be built for its
    /// callback (allocation failure, a terminating VM) is the `Err`, folded by
    /// the drain in [`Self::process_events`]; the callbacks themselves are
    /// top-level calls (`run_callback`).
    fn dispatch_event(&self, global: &JSGlobalObject, event: SessionEvent) -> JsResult<()> {
        match event {
            SessionEvent::HandshakeDone => {
                if self.is_server || self.peer_verification_refused() {
                    // Node's server reports at handshake COMPLETION
                    // (session.cc: server completion == confirmation
                    // per RFC 9001 §4.1.2).
                    self.maybe_report_handshake(global);
                } else {
                    // Node's client `opened` settles only for
                    // connections the server actually accepted.
                    self.handshake_pending_ok.set(true);
                }
            }
            SessionEvent::HandshakeConfirmed => {
                self.with_state(|s| s.handshake_confirmed = 1);
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
                                    SessionEvent::Closed(close) => {
                                        return close.as_ref().is_none_or(|(kind, code, _)| {
                                            *kind != CloseType::Application && *code != 0
                                        });
                                    }
                                    _ => {}
                                }
                            }
                            false
                        });
                    if !close_wins {
                        self.handshake_pending_ok.set(false);
                        self.maybe_report_handshake(global);
                    }
                }
            }
            SessionEvent::Closed(close) => self.report_close(global, close),
            SessionEvent::StreamReady { stream } => {
                let Some(stream) = self.live_stream(stream) else {
                    return Ok(());
                };
                if self.peer_cert_rejected.get()
                    || stream.is_reset() && self.conn.get().is_none()
                    || self.is_replaced(stream)
                {
                    stream.suppress_announce();
                    return Ok(());
                }
                // HTTP/3 has GOAWAY.
                if self.with_state(|st| st.graceful_close == 1) && !self.is_http3() {
                    stream.suppress_announce();
                    // It ends like those that come after `Connection::close`, unless that is put off.
                    match self.any_stream_undelivered() {
                        true => stream.abort(Some(http3_code::NO_ERROR), Some(0)),
                        false => stream.turn_away(),
                    }
                    self.schedule_process();
                    return Ok(());
                }
                let direction = StreamId(stream.stream_id() as u64).direction();
                let is_uni = direction == Direction::Unidirectional;
                self.bump_stream_stat(direction, false);
                callbacks::run(
                    global,
                    "onStreamCreated",
                    self.handle(),
                    &[stream.handle(), JSValue::js_number(is_uni.into())],
                );
            }
            SessionEvent::NewToken(token) => {
                // Node delivers one.
                if !self.has_listener(LISTENER_FLAG_NEW_TOKEN)
                    || self.new_token_reported.replace(true)
                {
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &token)?;
                callbacks::run(global, "onSessionNewToken", self.handle(), &[buf]);
            }
            SessionEvent::Keylog(line) => {
                let s = bun_string_jsc::create_utf8_for_js(global, &line)?;
                callbacks::run(global, "onSessionKeyLog", self.handle(), &[s]);
            }
            SessionEvent::SessionResume(blob) => {
                if !self.has_listener(LISTENER_FLAG_SESSION_TICKET) {
                    return Ok(());
                }
                if self.ticket_delivered.replace(true) {
                    self.pending_tickets
                        .with_mut(|q| q.push_back((now() + TICKET_DELIVERY_DELAY, blob)));
                    self.schedule_process();
                    return Ok(());
                }
                let buf = ArrayBuffer::create_buffer(global, &blob)?;
                callbacks::run(global, "onSessionTicket", self.handle(), &[buf]);
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
                callbacks::run(global, "onStreamReset", handle, &[err]);
            }
            SessionEvent::GoawayReceived { .. } => {
                // What Node reports for the notice of a graceful shutdown.
                let last_stream_id = JSValue::from_int64_no_truncate(global, -1)?;
                callbacks::run(global, "onSessionGoaway", self.handle(), &[last_stream_id]);
                // JavaScript takes the session for closing from now on.
                if !self.is_server && !self.is_close_deferred.replace(true) {
                    self.close_after_streams.set(true);
                }
            }
            SessionEvent::StreamWantsTrailers { stream } => {
                let Some(stream) = self.live_stream(stream) else {
                    return Ok(());
                };
                let handle = stream.handle();
                callbacks::run(global, "onStreamTrailers", handle, &[]);
            }
            SessionEvent::StreamHeaders { stream, fields } => {
                let Some(stream) = self.live_stream(stream).filter(|s| s.wants_headers()) else {
                    return Ok(());
                };
                let handle = stream.handle();
                // Latin-1, as node does for HTTP headers. Allocate inside
                // the closure: a collected `Vec<JSValue>` is not GC-scanned,
                // so early strings would be collectible.
                let pairs: Vec<_> = fields.iter().flat_map(<[&[u8]; 2]>::from).collect();
                let js_arr = JSValue::create_array_from_iter(global, pairs.iter(), |s| {
                    bun_core::String::clone_latin1(s).into_js(global)
                })?;
                let kind = match fields.section {
                    Section::Interim => QUIC_STREAM_HEADERS_KIND_HINTS,
                    Section::Head => QUIC_STREAM_HEADERS_KIND_INITIAL,
                    Section::Trailers => QUIC_STREAM_HEADERS_KIND_TRAILING,
                };
                callbacks::run(
                    global,
                    "onStreamHeaders",
                    handle,
                    &[js_arr, JSValue::js_number(kind as f64)],
                );
            }
            SessionEvent::StreamDrain { stream: key } => {
                let Some(stream) = self.live_stream(key) else {
                    return Ok(());
                };
                let handle = stream.handle();
                callbacks::run(global, "onStreamDrain", handle, &[]);
                if let Some(stream) = self.live_stream(key) {
                    stream.on_drain_delivered();
                    self.schedule_process();
                }
            }
            SessionEvent::StreamEnd { stream } => {
                if let Some(stream) = self.live_stream(stream) {
                    stream.drain_outbound();
                    self.schedule_process();
                }
            }
            SessionEvent::StreamBlocked { stream } => {
                let Some(stream) = self.live_stream(stream).filter(|s| s.wants_block()) else {
                    return Ok(());
                };
                let handle = stream.handle();
                callbacks::run(global, "onStreamBlocked", handle, &[]);
            }
            SessionEvent::StreamWake { stream } => {
                let Some(stream) = self
                    .live_stream(stream)
                    .filter(|s| !s.is_announce_suppressed())
                else {
                    return Ok(());
                };
                if let Some(wakeup) = stream.take_wakeup() {
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
                if self.endpoint_ref().is_some_and(|ep| ep.closing.get())
                    && !self.is_close_deferred.get()
                {
                    self.update(Connection::note_progress);
                }
                let buf = ArrayBuffer::create_buffer(global, &payload)?;
                callbacks::run(
                    global,
                    "onSessionDatagram",
                    self.handle(),
                    &[buf, JSValue::js_boolean(early)],
                );
            }
            SessionEvent::DatagramAbandoned(id) => self.report_datagram_abandoned(global, id)?,
            SessionEvent::DatagramAckStatus { id, acked } => {
                let status_js = if acked {
                    self.add_stat(IDX_STATS_SESSION_DATAGRAMS_ACKNOWLEDGED, 1);
                    global.common_strings().quic_datagram_acknowledged()
                } else {
                    self.add_stat(IDX_STATS_SESSION_DATAGRAMS_LOST, 1);
                    global.common_strings().quic_datagram_lost()
                };
                self.report_datagram_status(global, id, status_js)?;
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
                callbacks::run(
                    global,
                    "onSessionVersionNegotiation",
                    self.handle(),
                    &[
                        JSValue::js_number(requested as f64),
                        requested_arr,
                        supported_arr,
                    ],
                );
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
                callbacks::run(global, "onSessionOrigin", self.handle(), &[array]);
            }
            SessionEvent::PathValidation { preferred, paths } => {
                if !self.has_listener(LISTENER_FLAG_PATH_VALIDATION) {
                    return Ok(());
                }
                let (old, new) = *paths;
                let result_js = bun_core::String::static_("success").to_js(global)?;
                // Node passes each fact only from the side that owns it:
                // the server knows the previous path, the client knows it
                // migrated to the preferred address.
                let (old_local_js, old_remote_js, preferred_js) = if self.is_server {
                    (
                        address_to_js(global, Some(old.local)),
                        address_to_js(global, Some(old.peer)),
                        JSValue::UNDEFINED,
                    )
                } else {
                    (
                        JSValue::UNDEFINED,
                        JSValue::UNDEFINED,
                        JSValue::js_boolean(preferred),
                    )
                };
                callbacks::run(
                    global,
                    "onSessionPathValidation",
                    self.handle(),
                    &[
                        result_js,
                        address_to_js(global, Some(new.local)),
                        address_to_js(global, Some(new.peer)),
                        old_local_js,
                        old_remote_js,
                        preferred_js,
                    ],
                );
            }
            SessionEvent::StreamStopSending { stream, code } => {
                let Some(stream) = self.live_stream(stream) else {
                    return Ok(());
                };
                stream.apply_peer_stop_sending(code);
            }
            // `closed` of a stream can reject, and is commonly looked at after `opened`.
            SessionEvent::StreamClosed { stream }
                if !self.is_server
                    && !self.handshake_reported.get()
                    && self.conn.get().is_some() =>
            {
                self.held_stream_closes.with_mut(|v| v.push(stream));
            }
            SessionEvent::StreamClosed { stream: key } => {
                let Some(stream) = self.live_stream(key) else {
                    return Ok(());
                };
                if stream.mark_close_reported() {
                    return Ok(());
                }
                // A suppressed stream was never surfaced to JS, so it gets
                // no onStreamClose -- but it still has to leave `streams`
                // and drop its self-root, or it lives until teardown.
                if stream.is_announce_suppressed() {
                    self.remove_stream(key);
                    stream.release_close_root();
                    return Ok(());
                }
                // Runs the parked reader wakeup — user JS, which may destroy
                // this stream and let GC free it. Re-acquire before any
                // further use; `mark_close_reported` above already fired.
                stream.end_read_side(global);
                let Some(stream) = self.live_stream(key) else {
                    return Ok(());
                };
                let handle = stream.handle();
                callbacks::run(global, "onStreamClose", handle, &[JSValue::UNDEFINED]);
                // onStreamClose is user JS too: re-acquire before the
                // `release_close_root` below, as above.
                let Some(stream) = self.live_stream(key) else {
                    return Ok(());
                };
                self.remove_stream(key);
                // Nothing else reaches this stream now, so drop the
                // self-root; `stream` stays valid because the retain above
                // only dropped a pointer.
                stream.release_close_root();
            }
        }
        Ok(())
    }

    fn maybe_report_handshake(&self, global: &JSGlobalObject) {
        if self.handshake_reported.replace(true) || self.destroyed.get() {
            return;
        }
        self.release_stream_closes();
        let snapshot = self.hsk_snapshot.get().as_ref();
        let open_allowed = !self.peer_cert_rejected.get();
        let max_datagram_size = snapshot
            .and_then(|s| s.peer_transport_params.as_ref())
            .map_or(0, datagram_budget);
        self.with_state(|s| {
            s.handshake_completed = 1;
            s.handshake_confirmed = 1;
            s.stream_open_allowed = open_allowed as u8;
            s.max_datagram_size = max_datagram_size;
        });
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
        callbacks::run(
            global,
            "onSessionHandshake",
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

        if self.qlog_enabled.get() {
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"qlog_version\":\"0.3\",\"qlog_format\":\"JSON-SEQ\",\"title\":\"bun node:quic\"}}\n\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_started\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(global, &chunk, false);
        }

        // Node destroys the early streams and fires `onearlyrejected` — on
        // the CLIENT only.
        if early_data.0 && !early_data.1 && !self.is_server {
            callbacks::run(global, "onSessionEarlyDataRejected", self.handle(), &[]);
        }
    }

    fn release_stream_closes(&self) {
        for stream in self.held_stream_closes.with_mut(core::mem::take) {
            self.push_event(SessionEvent::StreamClosed { stream });
        }
    }

    fn reject_peer(&self, code: u64, reason: &[u8]) {
        (self.self_close).set(Some((Layer::Transport, code, reason.to_vec())));
        self.update(|conn| conn.abort(now(), Layer::Transport, code, reason));
    }

    fn peer_verification_refused(&self) -> bool {
        !self.is_server
            && self.reject_unverified_peer.get()
            && self
                .hsk_snapshot
                .get()
                .as_ref()
                .is_some_and(|s| s.validation.is_some())
    }

    fn lacks_client_certificate(&self) -> bool {
        self.is_server
            && (self.endpoint_ref()).is_some_and(|ep| ep.server_verify_client.get())
            && (self.hsk_snapshot.get().as_ref()).is_none_or(|s| s.peer_cert_der.is_none())
    }

    fn capture_hsk_snapshot(&self, conn: &Connection) {
        let snapshot = bun_quic_tls::Session::of(conn).map(|session| {
            let ssl = session.ssl();
            HskSnapshot {
                sni: ssl.servername().map(<[u8]>::to_vec),
                cipher: session.cipher_name().map(|it| it.to_bytes().to_vec()),
                alpn: tls::negotiated_alpn(ssl),
                validation: tls::validation_error(ssl),
                peer_cert_der: tls::peer_certificate_der(ssl),
                local_cert_der: tls::local_certificate_der(ssl),
                ephemeral: tls::ephemeral_key_info(ssl),
                early_data: tls::early_data_info(ssl),
                peer_transport_params: conn.peer_parameters().cloned(),
            }
        });
        self.hsk_snapshot.set(snapshot);
    }

    pub(super) fn accepts_early_data(&self) -> bool {
        self.is_server && (self.hsk_snapshot.get().as_ref()).is_some_and(|s| s.early_data.1)
    }

    pub(super) fn is_http3(&self) -> bool {
        self.application == Application::Http3
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
        callbacks::run(
            global,
            "onSessionQlog",
            self.handle(),
            &[data_js, JSValue::js_boolean(fin)],
        );
    }

    fn report_close(&self, global: &JSGlobalObject, close: Option<Close<CloseType>>) {
        if self.close_reported.replace(true) {
            return;
        }
        self.with_state(|s| s.closing = 1);
        self.write_stat(IDX_STATS_SESSION_DESTROYED_AT, now_ns());
        // Take the close reason before emit_qlog: that runs onSessionQlog,
        // which is user JS and drains microtasks, so a destroy() from inside
        // it would swap the reason this close reports.
        let (error_type, code, reason) = close.unwrap_or_else(|| {
            let (layer, code, reason) =
                (self.self_close.replace(None)).unwrap_or((Layer::Transport, 0, Vec::new()));
            (layer.into(), code, reason)
        });
        if self.qlog_enabled.get() {
            let t = now_ns() / 1_000_000;
            let chunk = format!(
                "\u{1e}{{\"time\":{t},\"name\":\"connectivity:connection_closed\",\"data\":{{}}}}\n"
            );
            self.emit_qlog(global, &chunk, true);
        }
        // `close_reported` is already latched above, so returning here would
        // mark the close delivered without ever delivering it and `closed`
        // would never settle. Report and carry on with undefined.
        let code_js = JSValue::from_uint64_no_truncate(global, code).or_report();
        let reason_js = opt_bytes_to_js(global, Some(&*reason).filter(|it| !it.is_empty()));
        let endpoint = self.endpoint.get();
        if !endpoint.is_null() {
            // SAFETY: endpoint is alive (endpoint_js Strong still held).
            unsafe { (*endpoint).unregister_session(self) };
        }
        callbacks::run(
            global,
            "onSessionClose",
            self.handle(),
            &[
                JSValue::js_number(f64::from(error_type as u8)),
                code_js,
                reason_js,
                JSValue::UNDEFINED,
            ],
        );
    }

    pub(super) fn teardown(&self, _global: &JSGlobalObject) {
        if self.destroyed.replace(true) {
            return;
        }
        let streams = self.streams.with_mut(core::mem::take);
        // Each `teardown` can run user JS that destroys a later entry and
        // lets GC free it mid-loop; the taken Vec is not a GC root, so
        // root every wrapper up front.
        let _roots: Vec<Strong> = streams
            .iter()
            .map(|&(_, qs)| {
                // SAFETY: entries are live here -- a stream is only downgraded
                // after `remove_stream` drops it from `self.streams`.
                Strong::create(unsafe { (*qs).handle() }, _global)
            })
            .collect();
        for (_, qs) in streams {
            // SAFETY: rooted by `_roots` above; teardown is idempotent.
            unsafe { (*qs).teardown(_global) };
        }
        self.pending_local_bidi.with_mut(VecDeque::clear);
        self.pending_local_uni.with_mut(VecDeque::clear);
        self.update(|conn| {
            conn.context = null_mut();
            if !conn.is_closing() {
                conn.abort_silently();
            }
        });
        self.conn.set(None);
        self.events.with_mut(VecDeque::clear);
        self.early_events.with_mut(Vec::clear);
        let ep = self.endpoint.replace(null_mut());
        if !ep.is_null() {
            // SAFETY: endpoint is alive (endpoint_js Strong held below). Its
            // `process()` re-validates against this set, so removing here is
            // what makes the pointer it snapshotted safe to skip.
            unsafe { (*ep).unregister_session(self) };
        }
        self.endpoint_js.set(None);
        self.application_options_js.set(None);
        self.this_value.with_mut(|r| r.downgrade());
    }

    pub(crate) fn get_remote_address(&self, cx: &mut JsScope<'_>) -> JSValue {
        address_to_js(cx.global(), self.remote_addr.get())
    }
    pub(crate) fn get_local_address(&self, cx: &mut JsScope<'_>) -> JSValue {
        address_to_js(cx.global(), self.local_addr.get())
    }
    fn parse_close_options(
        &self,
        global: &JSGlobalObject,
        options: JSValue,
    ) -> JsResult<Close<Layer>> {
        if !options.is_object() {
            return Ok((Layer::Transport, 0, Vec::new()));
        }
        let app = options
            .get(global, "type")?
            .map(|v| {
                bun_core::String::from_js(v, global).map(|s| s.to_owned_slice() == b"application")
            })
            .transpose()?
            .unwrap_or(false);
        let code = super::endpoint::read_u64_option(global, options, "code")?.unwrap_or(0);
        let reason = options
            .get(global, "reason")?
            .filter(|v| v.is_string())
            .map(|v| bun_core::String::from_js(v, global).map(|s| s.to_owned_slice()))
            .transpose()?
            .unwrap_or_default();
        let layer = if app {
            Layer::Application
        } else {
            Layer::Transport
        };
        self.self_close.set(Some((layer, code, reason.clone())));
        Ok((layer, code, reason))
    }

    pub(super) fn expect_end(&self) {
        if self.is_server {
            self.update(|conn| conn.set_progress_timeout(now(), CLOSING_PROGRESS_TIMEOUT));
        }
    }

    fn apply_graceful_close(&self, (layer, code, reason): Close<Layer>) {
        self.update(|conn| conn.set_close_error(layer, code, &reason));
        self.expect_end();
        self.update(Connection::note_progress);
        let is_responding = self.is_server && self.get(Connection::is_delivering) == Some(true);
        if self.is_http3() && (is_responding || self.has_opened_stream()) {
            // RFC 9114 §5.2.
            self.update(Connection::go_away);
            self.close_after_streams.set(true);
        }
        self.is_close_deferred.set(true);
        self.finish_deferred_close();
    }

    /// Applies a graceful close stashed while a dispatch was on the stack.
    /// Returns whether one was applied.
    pub(super) fn flush_pending_graceful(&self) -> bool {
        if self.pending_graceful.get().is_none()
            || self.is_server && self.get(Connection::is_ready) == Some(false)
        {
            return false;
        }
        let close = self.pending_graceful.replace(None);
        close.map(|it| self.apply_graceful_close(it)).is_some()
    }

    /// Like Node, pending streams don't delay a graceful close.
    fn has_opened_stream(&self) -> bool {
        self.streams.get().iter().any(|&(_, s)| {
            // SAFETY: pointers in `streams` are unregistered before their
            // owner is destroyed (registry invariant).
            unsafe { !(*s).is_pending() }
        })
    }

    fn any_stream_undelivered(&self) -> bool {
        self.streams.get().iter().any(|&(_, s)| {
            // SAFETY: as in `has_opened_stream`.
            unsafe { !(*s).is_pending() && (*s).has_undelivered_outbound() }
        })
    }

    /// Returns whether the time has come.
    fn finish_deferred_close(&self) -> bool {
        let is_due = self.is_close_deferred.get()
            && !self.any_stream_undelivered()
            && !(self.close_after_streams.get() && self.has_opened_stream());
        if is_due {
            self.is_close_deferred.set(false);
            let is_asked_for = self.with_state(|s| s.graceful_close != 0);
            self.update(|conn| match is_asked_for {
                true => conn.close(now()),
                false => conn.close_after_peer(now()),
            });
        }
        is_due
    }

    pub(crate) fn graceful_close(
        &self,
        cx: &mut JsScope<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        if !self.destroyed.get() {
            // Parse before the latch: a throw here must leave the session
            // untouched, not marked gracefully-closing with no close sent.
            let close = self.parse_close_options(global, options.to_js())?;
            // The peer is the first to close.
            if self.get(Connection::peer_go_away).flatten().is_some() {
                self.update(|conn| conn.set_close_error(close.0, close.1, &close.2));
                return Ok(());
            }
            self.with_state(|s| s.graceful_close = 1);
            if self.conn.get().is_some() {
                let was_gathering = self.get(Connection::is_gathering);
                self.update(Connection::stop_gathering);
                if was_gathering == Some(true) {
                    self.endpoint_ref().map(QuicEndpoint::drive_once);
                }
                self.pending_graceful.set(Some(close));
                self.mark();
                if !self.endpoint_ref().is_some_and(|ep| ep.scope_held()) {
                    self.flush_pending_graceful();
                }
                self.schedule_process();
            } else if !matches!(self.events.get().back(), Some(SessionEvent::Closed(_))) {
                self.report_close(global, None);
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
        if !self.close_reported.get() && self.conn.get().is_some() {
            let options = options.to_js();
            if options.is_object() {
                // Node's Destroy with close options. JS has already latched
                // `inner.destroying` and finished its half before reaching
                // here, so teardown() MUST run; a parse failure is taken off
                // the VM (teardown reaches JS) and re-thrown once it has. No
                // close was applied then.
                match self.parse_close_options(global, options) {
                    Ok((layer, code, reason)) => {
                        self.update(|conn| conn.abort(now(), layer, code, &reason));
                        self.endpoint_ref().map(QuicEndpoint::drive_once);
                    }
                    Err(err) => parse_error = Some(global.take_exception(err)),
                }
            } else if options.is_undefined() && self.is_server && !self.handshake_reported.get() {
                self.update(|conn| {
                    let code = match conn.is_ready() {
                        true => transport_code::INTERNAL_ERROR,
                        false => transport_code::CONNECTION_REFUSED,
                    };
                    conn.abort(now(), Layer::Transport, code, &[]);
                });
                self.endpoint_ref().map(QuicEndpoint::drive_once);
            } else {
                // Node's server acks the packet that triggered the destroying
                // callback.
                self.update(Connection::acknowledge);
                self.update(Connection::stop_gathering);
                self.endpoint_ref().map(QuicEndpoint::drive_once);
                // Node parity: Session::Destroy without close options.
                self.update(Connection::abort_silently);
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
        if self.destroyed.get() || self.get(Connection::peer_go_away) != Some(None) {
            return Ok(JSValue::UNDEFINED);
        }
        let direction = direction.to_js();
        let body = body.to_js();
        let direction = if direction.is_number() && direction.as_number() == 1.0 {
            Direction::Unidirectional
        } else {
            Direction::Bidirectional
        };
        let (key, qs, handle) = self.create_stream(global, this_value.to_js())?;
        (self.pending_streams(direction)).with_mut(|q| q.push_back(key));
        self.bump_stream_stat(direction, true);
        if let Some(buf) = body.as_array_buffer(global) {
            qs.outbound.with_mut(|o| {
                o.started = true;
                o.data.extend(buf.byte_slice());
                o.end = super::stream::PendingEnd::Fin;
            });
            // As in attach_source: a later setOutbound() throws instead of adding a second body.
            qs.with_state(|s| s.has_outbound = 1);
        }
        self.open_pending_streams(direction);
        self.schedule_process();
        Ok(handle)
    }
    pub(crate) fn send_datagram(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if self.destroyed.get() || self.conn.get().is_none() {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        let data = data.to_js();
        let Some(buf) = data.as_array_buffer(global) else {
            return JSValue::from_uint64_no_truncate(global, 0);
        };
        // HTTP/3: the peer must have advertised SETTINGS_H3_DATAGRAM
        // (RFC 9297 §2.1.1); otherwise not sent (0n).
        if self.get(Connection::peer_accepts_http3_datagrams) == Some(Some(false)) {
            return JSValue::from_uint64_no_truncate(global, 0);
        }
        // Oversized for the negotiated budget: not sent (Node returns 0n).
        // SAFETY: state buffer is live.
        let max_size = self.with_state(|s| s.max_datagram_size);
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
        // SAFETY: state buffer is live.
        let max_pending = self.with_state(|s| s.max_pending_datagrams);
        if (1..MIN_PENDING_DATAGRAMS_TO_GATHER).contains(&max_pending) {
            self.update(Connection::stop_gathering);
        }
        if max_pending > 0 && self.get(Connection::unsent_datagrams) >= Some(max_pending.into()) {
            // Node reports the abandonment synchronously from within
            // sendDatagram.
            if self.datagram_drop_newest.get() {
                self.report_datagram_abandoned(global, id)?;
                // SAFETY: as above.
                unsafe { (&raw mut (*self.state_mut()).last_datagram_id).write_unaligned(id) };
                return JSValue::from_uint64_no_truncate(global, id);
            }
            if let Some(Some(dropped_id)) = self.update(Connection::drop_oldest_datagram) {
                // Runs the user's `ondatagramstatus`, which can destroy this
                // session or close the conn before we get back here.
                self.report_datagram_abandoned(global, dropped_id)?;
                if self.destroyed.get() || self.conn.get().is_none() {
                    return JSValue::from_uint64_no_truncate(global, 0);
                }
            }
        }
        self.update(|conn| conn.send_datagram(id, payload));
        // SAFETY: state buffer is live; ArrayBuffer storage is byte-aligned.
        unsafe { (&raw mut (*self.state_mut()).last_datagram_id).write_unaligned(id) };
        self.schedule_process();
        JSValue::from_uint64_no_truncate(global, id)
    }
    fn report_datagram_abandoned(&self, global: &JSGlobalObject, id: u64) -> JsResult<()> {
        let status_js = global.common_strings().quic_datagram_abandoned();
        self.report_datagram_status(global, id, status_js)
    }
    fn report_datagram_status(
        &self,
        global: &JSGlobalObject,
        id: u64,
        status_js: JSValue,
    ) -> JsResult<()> {
        if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
            return Ok(());
        }
        let id_js = JSValue::from_uint64_no_truncate(global, id)?;
        callbacks::run(
            global,
            "onSessionDatagramStatus",
            self.handle(),
            &[id_js, status_js],
        );
        Ok(())
    }

    /// Node's JS layer discards this return value, matching upstream.
    pub(crate) fn update_key(&self) -> bool {
        false
    }
    pub(crate) fn get_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(der) = self.with_ssl(tls::local_certificate_der) {
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
    pub(crate) fn get_peer_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(der) = self.with_ssl(tls::peer_certificate_der) {
            return ArrayBuffer::create_buffer(global, &der);
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
    pub(crate) fn get_ephemeral_key(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let Some((kind, name, bits)) = self
            .with_ssl(tls::ephemeral_key_info)
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
    fn with_ssl<T>(&self, f: impl FnOnce(&bun_boringssl_sys::SSL) -> Option<T>) -> Option<T> {
        self.get(|conn| f(bun_quic_tls::Session::of(conn)?.ssl()))?
    }
    pub(crate) fn application_options(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
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
        tp: &TransportParameters,
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
        put(b"maxIdleTimeout", tp.max_idle_timeout_millis / MS_PER_SEC)?;
        put(b"maxUdpPayloadSize", tp.max_udp_payload_size)?;
        put(b"ackDelayExponent", tp.ack_delay_exponent)?;
        put(b"maxAckDelay", tp.max_ack_delay_millis)?;
        put(b"activeConnectionIDLimit", tp.active_connection_id_limit)?;
        put(b"maxDatagramFrameSize", tp.max_datagram_frame_size)?;
        obj.put(
            global,
            b"disableActiveMigration",
            JSValue::js_boolean(tp.disable_active_migration),
        );
        let put_cid = |name: &[u8], id: Option<ConnectionId>| -> JsResult<()> {
            let v = match id.filter(|it| !it.is_empty()) {
                Some(id) => {
                    let hex = bun_core::fmt::bytes_to_hex_lower_string(&id);
                    bun_string_jsc::create_utf8_for_js(global, hex.as_bytes())?
                }
                None => JSValue::UNDEFINED,
            };
            obj.put(global, name, v);
            Ok(())
        };
        put_cid(b"initialSCID", tp.initial_source_connection_id)?;
        put_cid(b"retrySCID", tp.retry_source_connection_id)?;
        put_cid(b"originalDCID", tp.original_destination_connection_id)?;
        Ok(obj)
    }
}

/// Returns the largest DATAGRAM payload the peer's transport parameters allow.
fn datagram_budget(tp: &TransportParameters) -> u16 {
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
        if self.destroyed.get() {
            return Ok(JSValue::UNDEFINED);
        }
        Self::transport_params_to_js(cx.global(), self.local_transport_params.get())
    }
    pub(crate) fn remote_transport_params(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        if let Some(Some(tp)) = self.get(|c| c.peer_parameters().cloned()) {
            return Self::transport_params_to_js(global, &tp);
        }
        match self
            .hsk_snapshot
            .get()
            .as_ref()
            .and_then(|s| s.peer_transport_params.as_ref())
        {
            Some(tp) => Self::transport_params_to_js(global, tp),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    /// Does not run JavaScript.
    pub(super) fn on_event(&self, event: Event) {
        let event = match event {
            Event::Stream(id, _, StreamEvent::Opened) => return self.on_remote_stream(id),
            Event::Stream(_, stream, event) => {
                // SAFETY: a stream takes itself out before it can be collected.
                if let Some(stream) = unsafe { stream.cast::<QuicStream>().as_ref() } {
                    stream.on_event(self, event);
                }
                return;
            }
            Event::Ready => return self.on_ready(),
            Event::StreamsAvailable(direction) => return self.open_pending_streams(direction),
            Event::HandshakeConfirmed => {
                if self.is_server
                    && let (Some(ep), Some(peer)) = (self.endpoint_ref(), self.remote_addr.get())
                    && !ep.count_session(self, peer)
                {
                    self.reject_peer(transport_code::CONNECTION_REFUSED, &[]);
                }
                if self.accepts_early_data() {
                    self.push_event(SessionEvent::HandshakeDone);
                }
                SessionEvent::HandshakeConfirmed
            }
            Event::EarlyDataRejected => return self.on_early_data_rejected(),
            Event::Ticket(ticket) => SessionEvent::SessionResume(ticket),
            Event::Token(token) => SessionEvent::NewToken(token),
            Event::KeyLog(line) => SessionEvent::Keylog(line),
            Event::Datagram { data, is_early } => SessionEvent::Datagram {
                payload: data,
                early: is_early,
            },
            Event::DatagramAcked(id) => SessionEvent::DatagramAckStatus { id, acked: true },
            Event::DatagramLost(id) => SessionEvent::DatagramAckStatus { id, acked: false },
            Event::DatagramAbandoned(id) => SessionEvent::DatagramAbandoned(id),
            Event::PathChanged {
                from,
                to,
                is_preferred,
            } => {
                self.set_addresses(&to);
                SessionEvent::PathValidation {
                    preferred: is_preferred,
                    paths: Box::new((from, to)),
                }
            }
            Event::GoAway { overtakes_data } => SessionEvent::GoawayReceived { overtakes_data },
            Event::Origin(payload) => SessionEvent::Origin(payload),
            Event::Closed(conn) => {
                self.conn.set(None);
                self.release_stream_closes();
                self.refresh_conn_stats(&conn);
                SessionEvent::Closed(self.describe_close(conn.close_reason()))
            }
        };
        self.push_event(event);
    }

    /// As `EarlyDataRejected` in node's application.cc, which leaves pending streams alone.
    fn on_early_data_rejected(&self) {
        let code = self.with_state(|s| s.internal_error_code);
        for &(key, _) in self.streams.get() {
            if let Some(stream) = self.live_stream(key).filter(|it| !it.is_pending()) {
                stream.cancel_early_rejected(code);
            }
        }
    }

    fn on_ready(&self) {
        self.get(|conn| self.capture_hsk_snapshot(conn));
        if !self.accepts_early_data() {
            self.push_event(SessionEvent::HandshakeDone);
        }
        if self.peer_verification_refused() {
            self.peer_cert_rejected.set(true);
            self.reject_peer(
                CRYPTO_ERROR_BAD_CERTIFICATE,
                b"peer certificate verification failed",
            );
        } else if self.lacks_client_certificate() {
            // Matching Node: the server session exists and then closes with a
            // certificate_required transport error.
            self.peer_cert_rejected.set(true);
            self.reject_peer(
                CRYPTO_ERROR_CERTIFICATE_REQUIRED,
                b"peer did not provide a certificate",
            );
        }
        if self.is_server {
            self.apply_peer_datagram_budget();
            self.flush_pending_graceful();
        }
        self.open_pending_streams(Direction::Bidirectional);
        self.open_pending_streams(Direction::Unidirectional);
    }

    fn describe_close(&self, close: &CloseReason) -> Option<Close<CloseType>> {
        Some(match close {
            CloseReason::Local => return None,
            CloseReason::Peer {
                layer: Layer::Application,
                code: http3_code::NO_ERROR,
                reason,
            } if self.is_http3() => (CloseType::Application, 0, reason.clone()),
            CloseReason::Peer {
                layer,
                code,
                reason,
            } => ((*layer).into(), *code, reason.clone()),
            _ if self.self_close.get().is_some() => return None,
            CloseReason::Error {
                layer,
                code,
                reason,
            } => ((*layer).into(), *code, reason.as_bytes().to_vec()),
            CloseReason::StatelessReset => (
                CloseType::Transport,
                transport_code::INTERNAL_ERROR,
                Vec::new(),
            ),
            // Node's server takes it as a clean close if a client goes away.
            CloseReason::HandshakeTimeout if self.is_server => return None,
            CloseReason::IdleTimeout if self.handshake_reported.get() => {
                (CloseType::Idle, 0, Vec::new())
            }
            // Node rejects `opened` with a transport error.
            CloseReason::HandshakeTimeout | CloseReason::IdleTimeout => (
                CloseType::Transport,
                CRYPTO_ERROR_HANDSHAKE_FAILURE,
                b"handshake timed out".to_vec(),
            ),
            CloseReason::NoCommonVersion => (CloseType::VersionNegotiation, 0, Vec::new()),
        })
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
