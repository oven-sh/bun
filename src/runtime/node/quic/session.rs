//! Node's `internalBinding('quic').Session` analog (node/src/quic/session.{h,cc}).

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{null, null_mut};
use std::collections::VecDeque;

use bun_jsc::{
    ArrayBuffer, CallFrame, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, StringJsc, Strong,
};

use bun_lsquic_sys as lsquic;

use super::OrReport;

use super::callbacks;
use super::endpoint::{MS_PER_SEC, QuicEndpoint, alloc_exposed_array_buffer};
use super::ffi::lsquic_callback;
use super::now_ns;
use super::tls;

bun_core::declare_scope!(quic_session, hidden);

/// DATAGRAM frame overhead: type byte + 2-byte length varint (RFC 9221 §4).
const DATAGRAM_FRAME_OVERHEAD: u64 = 3;
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

const CONN_STATUS_ERRBUF_LEN: usize = 256;

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
    /// The raw lsquic stream — alive until the conn dies (entries are
    /// cleared first) and only ever passed back to lsquic, never
    /// dereferenced here.
    ls: *mut lsquic::lsquic_stream,
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
        stream: *mut super::stream::QuicStream,
        remote: bool,
    },
    StreamWake {
        stream: *mut super::stream::QuicStream,
    },
    StreamDrain {
        stream: *mut super::stream::QuicStream,
    },
    StreamBlocked {
        stream: *mut super::stream::QuicStream,
    },
    StreamReset {
        stream: *mut super::stream::QuicStream,
        code: u64,
    },
    StreamStopSending {
        stream: *mut super::stream::QuicStream,
        code: u64,
    },
    StreamWantsTrailers {
        stream: *mut super::stream::QuicStream,
    },
    StreamHeaders {
        stream: *mut super::stream::QuicStream,
        pairs: Vec<Vec<u8>>,
        kind: u32,
    },
    NewToken(Vec<u8>),
    Keylog(Vec<u8>),
    SessionResume(Vec<u8>),
    StreamClosed {
        stream: *mut super::stream::QuicStream,
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

/// `#[repr(C)]` so `vtable` is at offset 0 — the C shim reads it via
/// `*(us_nq_vtable**)conn_ctx`. Without it Rust may reorder fields.
#[repr(C)]
pub struct QuicSession {
    /// MUST stay the first field — the C shim's thunks recover the vtable via
    /// `*(us_nq_vtable**)conn_ctx`.
    vtable: *const lsquic::NqVtable,
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
    pending_local_bidi: JsCell<VecDeque<*mut super::stream::QuicStream>>,
    pending_local_uni: JsCell<VecDeque<*mut super::stream::QuicStream>>,
    streams: JsCell<Vec<*mut super::stream::QuicStream>>,
    handshake_reported: Cell<bool>,
    new_token_reported: Cell<bool>,
    close_when_bound: Cell<bool>,
    deferred_close: JsCell<Option<(bool, u64, Vec<u8>)>>,
    handshake_pending_ok: Cell<bool>,
    hsk_snapshot: JsCell<Option<HskSnapshot>>,
    close_reported: Cell<bool>,
    destroyed: Cell<bool>,
    application_options_js: JsCell<Option<Strong>>,
    this_value: JsCell<JsRef>,
    global: Cell<*const JSGlobalObject>,
}

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
            hsk_snapshot: JsCell::new(None),
            close_reported: Cell::new(false),
            destroyed: Cell::new(false),
            application_options_js: JsCell::new(None),
            this_value: JsCell::new(JsRef::empty()),
            global: Cell::new(core::ptr::from_ref(global)),
        }
    }

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
            s.no_error_code = 0;
            s.internal_error_code = 1;
            s.stream_open_allowed = 1;
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
        if !conn.is_null() {
            this.cache_sockaddrs(conn);
        }
        Ok((raw, handle))
    }

    pub(super) fn bind_conn(&self, conn: *mut lsquic::lsquic_conn) {
        self.conn.set(conn);
        // SAFETY: `conn` is the live conn lsquic just promoted; `self` is
        // the heap-allocated session (conn-ctx contract).
        unsafe { lsquic::lsquic_conn_set_ctx(conn, core::ptr::from_ref(self).cast_mut().cast()) };
        // SAFETY: `conn` is the live conn lsquic just promoted.
        let promoted = unsafe { lsquic::Conn::from_raw(conn) };
        if let (Some(ep), Some(c)) = (self.endpoint_ref(), promoted) {
            for line in ep.take_early_keylog(c.ssl()) {
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
    /// The `endpoint_js` Strong keeps it alive while this session holds the
    /// back-pointer; teardown nulls the pointer before that Strong is
    /// dropped, so a non-null pointer is always dereferenceable on the JS
    /// thread.
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
    pub(super) fn note_stream_write(&self) {
        self.write_marker
            .set(self.write_marker.get().wrapping_add(1));
    }
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
    pub(super) fn take_pending_local_stream(
        &self,
        uni: bool,
    ) -> Option<*mut super::stream::QuicStream> {
        let queue = if uni {
            &self.pending_local_uni
        } else {
            &self.pending_local_bidi
        };
        // Skip the tombstones `remove_stream` leaves: stopping at the first
        // one would strand the live request behind it until the next
        // MAX_STREAMS grant.
        while let Some(p) = queue.with_mut(VecDeque::pop_front) {
            if !p.is_null() && self.streams.get().contains(&p) {
                return Some(p);
            }
        }
        None
    }
    pub(super) fn remove_stream(&self, stream: *mut super::stream::QuicStream) {
        self.streams.with_mut(|v| v.retain(|&s| s != stream));
        // Null the slot rather than drop it: these are positional FIFOs
        // lsquic fulfils in order, and a recycled allocation at the same
        // address would otherwise bind to the wrong wrapper.
        for queue in [&self.pending_local_bidi, &self.pending_local_uni] {
            queue.with_mut(|v| {
                for slot in v.iter_mut() {
                    if *slot == stream {
                        *slot = null_mut();
                    }
                }
            });
        }
    }
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
                // SAFETY: `qs` was just created.
                if let Some(code) = unsafe { (*qs).pre_reset_code() } {
                    self.push_event(SessionEvent::StreamReset { stream: qs, code });
                }
                qs
            }
            Err(e) => {
                // Returning into lsquic with the exception still pending would
                // poison the next `callbacks::get()` and silently drop events.
                global.report_uncaught_exception_from_error(e);
                null_mut()
            }
        }
    }

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
        self.write_stat(IDX_STATS_SESSION_SMOOTHED_RTT, us_to_ns(info.rtt));
        self.write_stat(IDX_STATS_SESSION_PKT_SENT, info.pkts_sent);
        self.write_stat(IDX_STATS_SESSION_PKT_RECV, info.pkts_rcvd);
        self.write_stat(IDX_STATS_SESSION_PKT_LOST, info.pkts_lost);
        self.write_stat(IDX_STATS_SESSION_BYTES_RECV, info.bytes_rcvd);
        if let Some(conn) = self.conn() {
            self.write_stat(IDX_STATS_SESSION_PING_RECV, conn.pings_received());
        }
    }

    fn stream_is_live(&self, stream: *mut super::stream::QuicStream) -> bool {
        self.streams.get().contains(&stream)
    }
    /// Teardown removes a stream from the registry before its allocation is
    /// freed, so a registered pointer is live on the JS thread.
    fn live_stream(&self, p: *mut super::stream::QuicStream) -> Option<&super::stream::QuicStream> {
        // SAFETY: see doc comment.
        self.stream_is_live(p).then(|| unsafe { &*p })
    }

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
            let buf = ArrayBuffer::create_buffer(global, &blob).or_report(global);
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
            let endpoint = self.endpoint.get();
            // SAFETY: teardown clears `endpoint` before the endpoint can die.
            let defer_closes = !endpoint.is_null() && unsafe { (*endpoint).defer_closes.get() };
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
            match event {
                SessionEvent::HandshakeDone { ok } => {
                    if ok {
                        self.capture_hsk_snapshot();
                        if self.is_server.get() {
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
                        continue;
                    };
                    // A remote stream that arrives already-reset while this
                    // session's close is in the same batch must never be
                    // surfaced (Node's onstream count excludes it).
                    if remote && self.conn.get().is_null() && stream.pre_reset_code().is_some() {
                        stream.suppress_announce();
                        continue;
                    }
                    // Already closing: the CONNECTION_CLOSE precedes this
                    // stream's packet and a closing endpoint discards new
                    // streams (RFC 9000 s10.2.1). Raw QUIC only.
                    if remote
                        && self.with_state(|st| st.graceful_close == 1)
                        && !self
                            .endpoint_ref()
                            .map(|ep| ep.is_http(self.is_server.get()))
                            .unwrap_or(false)
                    {
                        stream.suppress_announce();
                        stream.close_raw_silently();
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
                    let buf = ArrayBuffer::create_buffer(global, &token).or_report(global);
                    if let Some(cb) = callbacks::get(global, "onSessionNewToken") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref()
                            .run_callback(cb, global, self.handle(), &[buf]);
                    }
                }
                SessionEvent::Keylog(line) => {
                    let s = match bun_core::String::clone_utf8(&line).to_js(global) {
                        Ok(v) => v,
                        Err(err) => {
                            global.report_uncaught_exception_from_error(err);
                            continue;
                        }
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
                        self.pending_tickets
                            .with_mut(|q| q.push_back((now_ns() + TICKET_DELIVERY_DELAY_NS, blob)));
                        self.schedule_process();
                        continue;
                    }
                    let buf = ArrayBuffer::create_buffer(global, &blob).or_report(global);
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
                        continue;
                    };
                    let handle = stream.handle();
                    let err = make_application_error(global, code).or_report(global);
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
                    let last_stream_id = match JSValue::from_int64_no_truncate(global, -1) {
                        Ok(v) => v,
                        Err(e) => {
                            global.report_uncaught_exception_from_error(e);
                            continue;
                        }
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
                    // Latin-1, as node does for HTTP headers. Allocate inside
                    // the closure: a collected `Vec<JSValue>` is not GC-scanned,
                    // so early strings would be collectible.
                    let js_arr = JSValue::create_array_from_iter(global, pairs.iter(), |s| {
                        Ok(bun_core::String::clone_latin1(s)
                            .to_js(global)
                            .or_report(global))
                    });
                    let js_arr = js_arr.or_report(global);
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
                        continue;
                    };
                    let handle = stream.handle();
                    if let Some(cb) = callbacks::get(global, "onStreamDrain") {
                        let vm = global.bun_vm().as_mut();
                        vm.event_loop_ref().run_callback(cb, global, handle, &[]);
                    }
                }
                SessionEvent::StreamBlocked { stream } => {
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
                    let buf = ArrayBuffer::create_buffer(global, &payload).or_report(global);
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
                        continue;
                    }
                    if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
                        continue;
                    }
                    let id_js = match JSValue::from_uint64_no_truncate(global, id) {
                        Ok(v) => v,
                        Err(e) => {
                            global.report_uncaught_exception_from_error(e);
                            continue;
                        }
                    };
                    let status_js = match bun_core::String::static_(b"abandoned").to_js(global) {
                        Ok(v) => v,
                        Err(err) => {
                            global.report_uncaught_exception_from_error(err);
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
                SessionEvent::EarlyDataFailed => {
                    // Node parity: their `closed` promises reject with an
                    // application error.
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
                        let id_js = match JSValue::from_uint64_no_truncate(global, id) {
                            Ok(v) => v,
                            Err(e) => {
                                global.report_uncaught_exception_from_error(e);
                                continue;
                            }
                        };
                        let status_js = match bun_core::String::static_(status).to_js(global) {
                            Ok(v) => v,
                            Err(err) => {
                                global.report_uncaught_exception_from_error(err);
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
                }
                SessionEvent::VersionNegotiation { server_versions } => {
                    let Some((requested, min)) = self.verneg.get() else {
                        continue;
                    };
                    let requested_arr =
                        JSValue::create_array_from_iter(global, server_versions.into_iter(), |v| {
                            Ok(JSValue::js_number(v as f64))
                        })
                        .or_report(global);
                    // Node passes the locally-configured range as
                    // `[min_version, version]` (session.cc
                    // EmitVersionNegotiation).
                    let supported_arr = JSValue::create_array_from_iter(
                        global,
                        [min, requested].into_iter(),
                        |v| Ok(JSValue::js_number(v as f64)),
                    )
                    .or_report(global);
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
                            bun_core::String::clone_utf8(&payload[o..o + n]).to_js(global)
                        })
                        .or_report(global);
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
                    let result_js = match bun_core::String::static_(result).to_js(global) {
                        Ok(v) => v,
                        Err(err) => {
                            global.report_uncaught_exception_from_error(err);
                            continue;
                        }
                    };
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
                        continue;
                    };
                    stream.apply_peer_stop_sending(code);
                }
                SessionEvent::StreamClosed { stream: stream_ptr } => {
                    let Some(stream) = self.live_stream(stream_ptr) else {
                        continue;
                    };
                    if stream.mark_close_reported() {
                        continue;
                    }
                    // A suppressed stream was never surfaced to JS, so it gets
                    // no onStreamClose -- but it still has to leave `streams`
                    // and drop its self-root, or it lives until teardown.
                    if stream.is_announce_suppressed() {
                        self.streams.with_mut(|v| v.retain(|&s| s != stream_ptr));
                        stream.release_close_root();
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
                    // onStreamClose is user JS too: re-acquire before the
                    // `release_close_root` below, as above.
                    let Some(stream) = self.live_stream(stream_ptr) else {
                        continue;
                    };
                    self.streams.with_mut(|v| v.retain(|&s| s != stream_ptr));
                    // Nothing else reaches this stream now, so drop the
                    // self-root; `stream` stays valid because the retain above
                    // only dropped a pointer.
                    stream.release_close_root();
                }
            }
        }
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
            self.with_state(|s| {
                s.headers_supported = 1;
                s.application_type = 1;
                s.priority_supported = 1;
                s.no_error_code = H3_NO_ERROR;
                s.internal_error_code = H3_INTERNAL_ERROR;
            });
        } else {
            self.with_state(|s| s.headers_supported = 2);
        }
        let alpn = alpn_bytes
            .and_then(|b| match bun_core::String::clone_utf8(&b).to_js(global) {
                Ok(v) => Some(v),
                Err(e) => {
                    global.report_uncaught_exception_from_error(e);
                    None
                }
            })
            .unwrap_or(JSValue::UNDEFINED);
        let cipher_version = bun_core::String::static_(b"TLSv1.3")
            .to_js(global)
            .or_report(global);
        // Node reports both fields only on failure -- the JS 'auto' rejection
        // gates on `validationErrorReason !== undefined` -- and a server with
        // no client certificate reports X509_V_ERR_UNSPECIFIED.
        let pair = match snap_validation {
            Some(pair) => Some(pair),
            None if self.is_server.get() && !have_peer_cert => {
                Some(tls::validation_error_strings(tls::X509_V_ERR_UNSPECIFIED))
            }
            None => None,
        };
        let (verify_reason, verify_code) = match pair {
            Some((code, reason)) => (
                bun_core::String::static_(reason.as_bytes())
                    .to_js(global)
                    .or_report(global),
                bun_core::String::static_(code.as_bytes())
                    .to_js(global)
                    .or_report(global),
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
        if !cert_ok && !self.destroyed.get() && !self.conn.get().is_null() {
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
            self.endpoint_ref()
                .and_then(|ep| ep.configured_alpn(self.is_server.get()))
        });
        let validation = tls::validation_error(ssl);
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
        // `qlog_fin_sent` is latched above and also gates the guard at the top,
        // so bailing here would silently end the whole qlog stream, not just
        // drop this record.
        let data_js = bun_core::String::clone_utf8(data.as_bytes())
            .to_js(global)
            .or_report(global);
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
            None if self.conn.get().is_null() => {
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
        // `close_reported` is already latched above, so returning here would
        // mark the close delivered without ever delivering it and `closed`
        // would never settle. Report and carry on with undefined.
        let code_js = JSValue::from_uint64_no_truncate(global, code).or_report(global);
        let reason_js = reason
            .filter(|r| !r.is_empty())
            .and_then(|r| match bun_core::String::clone_utf8(&r).to_js(global) {
                Ok(v) => Some(v),
                Err(e) => {
                    global.report_uncaught_exception_from_error(e);
                    None
                }
            })
            .unwrap_or(JSValue::UNDEFINED);
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

    pub(super) fn teardown(&self, _global: &JSGlobalObject) {
        if self.destroyed.replace(true) {
            return;
        }
        let streams = self.streams.with_mut(core::mem::take);
        // Each `teardown` can run user JS that destroys a later entry and
        // lets GC free its Box mid-loop; the taken Vec is not a GC root, so
        // root every wrapper up front.
        let _roots: Vec<Strong> = streams
            .iter()
            .map(|&qs| {
                // SAFETY: entries are live here -- a stream is only downgraded
                // after `remove_stream` drops it from `self.streams`.
                Strong::create(unsafe { (*qs).handle() }, _global)
            })
            .collect();
        for qs in streams {
            // SAFETY: rooted by `_roots` above; teardown is idempotent.
            unsafe { (*qs).teardown(_global) };
        }
        self.pending_local_bidi.with_mut(VecDeque::clear);
        self.pending_local_uni.with_mut(VecDeque::clear);
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
            // SAFETY: endpoint is alive (endpoint_js Strong held below). Its
            // `process()` re-validates against this set, so removing here is
            // what makes the pointer it snapshotted safe to skip.
            unsafe { (*ep).unregister_session(core::ptr::from_ref(self).cast_mut()) };
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
                        .map(|s| s.to_utf8_bytes() == b"application")
                })
                .transpose()?
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

    pub(super) fn apply_graceful_close(&self, app: bool, code: u64, reason: Vec<u8>) {
        let is_http = self
            .endpoint_ref()
            .map(|ep| ep.is_http(self.is_server.get()))
            .unwrap_or(false);
        if is_http && !app && code == 0 && !self.streams.get().is_empty() {
            // RFC 9114 §5.2.
            if let Some(c) = self.conn() {
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
        if self.conn.get().is_null() {
            return false;
        }
        if let Some((app, code, reason)) = self.pending_graceful.with_mut(Option::take) {
            self.apply_graceful_close(app, code, reason);
            return true;
        }
        false
    }

    fn apply_close(&self, app: bool, code: u64, reason: &[u8]) {
        let Some(c) = self.conn() else { return };
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
        self.streams.get().iter().any(|&s| {
            // SAFETY: pointers in `streams` are unregistered before their
            // owner is destroyed (registry invariant).
            unsafe { (*s).has_undelivered_outbound() }
        })
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
            self.with_state(|s| s.graceful_close = 1);
            if self.conn.get().is_null() {
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
                // Node's Destroy with close options.
                self.close_with_options(global, options)?;
                if let Some(endpoint) = self.endpoint_ref() {
                    endpoint.drive_engines_once();
                }
            } else if let Some(c) = self.conn() {
                // Node's server acks the packet that triggered the destroying
                // callback.
                c.ack_now();
                if let Some(endpoint) = self.endpoint_ref() {
                    endpoint.drive_engines_once();
                }
                if let Some(c) = self.conn() {
                    // Node parity: Session::Destroy without close options.
                    c.abort_silent();
                }
            }
            self.schedule_process();
        }
        self.teardown(global);
        Ok(JSValue::UNDEFINED)
    }
    pub(crate) fn open_stream(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.destroyed.get() || self.conn.get().is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        let [direction, body] = frame.arguments_as_array::<2>();
        let unidirectional = direction.is_number() && direction.as_number() == 1.0;
        let (qs, handle) = super::stream::QuicStream::create(
            global,
            self.vtable,
            core::ptr::from_ref(self).cast_mut(),
            frame.this(),
            null_mut(),
        )?;
        if unidirectional {
            self.pending_local_uni.with_mut(|q| q.push_back(qs));
        } else {
            self.pending_local_bidi.with_mut(|q| q.push_back(qs));
        }
        self.streams.with_mut(|v| v.push(qs));
        self.bump_stream_stat(if unidirectional { STREAM_ID_UNI_BIT } else { 0 }, true);
        if let Some(buf) = body.as_array_buffer(global) {
            // SAFETY: `qs` was just created.
            unsafe {
                (*qs).outbound.with_mut(|o| {
                    o.started = true;
                    o.data.extend(buf.byte_slice().iter().copied());
                    o.fin_pending = true;
                });
                // As attach_source/init_streaming_source/send_headers do: this
                // is what makes a later setOutbound() throw instead of
                // appending a second body.
                (*qs).with_state(|s| s.has_outbound = 1);
            }
        }
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
        if is_http && self.conn().and_then(|c| c.peer_h3_datagram()) == Some(false) {
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
        if max_pending > 0 && self.datagram_queue.get().len() >= max_pending as usize {
            // Node reports the abandonment synchronously from within
            // sendDatagram.
            if self.datagram_drop_newest.get() {
                self.report_datagram_abandoned(global, id);
                // SAFETY: as above.
                unsafe { (&raw mut (*self.state_mut()).last_datagram_id).write_unaligned(id) };
                return JSValue::from_uint64_no_truncate(global, id);
            }
            if let Some((dropped_id, _)) = self.datagram_queue.with_mut(VecDeque::pop_front) {
                // Runs the user's `ondatagramstatus`, which can destroy this
                // session or close the conn before we get back here.
                self.report_datagram_abandoned(global, dropped_id);
                if self.destroyed.get() || self.conn.get().is_null() {
                    return JSValue::from_uint64_no_truncate(global, 0);
                }
            }
        }
        self.datagram_queue.with_mut(|q| q.push_back((id, payload)));
        // SAFETY: state buffer is live; ArrayBuffer storage is byte-aligned.
        unsafe { (&raw mut (*self.state_mut()).last_datagram_id).write_unaligned(id) };
        // SAFETY: `conn` is non-null (checked above) and live.
        if let Some(c) = unsafe { lsquic::Conn::from_raw(self.conn.get()) } {
            c.want_datagram_write(true);
        }
        self.schedule_process();
        JSValue::from_uint64_no_truncate(global, id)
    }
    fn report_datagram_abandoned(&self, global: &JSGlobalObject, id: u64) {
        if !self.has_listener(LISTENER_FLAG_DATAGRAM_STATUS) {
            return;
        }
        let id_js = match JSValue::from_uint64_no_truncate(global, id) {
            Ok(v) => v,
            Err(e) => {
                global.report_uncaught_exception_from_error(e);
                return;
            }
        };
        let status_js = match bun_core::String::static_(b"abandoned").to_js(global) {
            Ok(v) => v,
            Err(err) => {
                global.report_uncaught_exception_from_error(err);
                return;
            }
        };
        if let Some(cb) = callbacks::get(global, "onSessionDatagramStatus") {
            let vm = global.bun_vm().as_mut();
            vm.event_loop_ref()
                .run_callback(cb, global, self.handle(), &[id_js, status_js]);
        }
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
        if let Some(der) = self.conn_ssl().and_then(tls::local_certificate_der) {
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
        if let Some(conn) = self.conn() {
            // lsquic returns a STACK_OF(X509)* the callee frees
            // (sk_X509_pop_free inside leaf_certificate_der).
            if let Some(der) = tls::leaf_certificate_der(conn.server_cert_chain()) {
                return ArrayBuffer::create_buffer(global, &der);
            }
            if let Some(ssl) = self.conn_ssl() {
                if let Some(der) = tls::peer_certificate_der(ssl) {
                    return ArrayBuffer::create_buffer(global, &der);
                }
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
        let put_cid = |name: &[u8], s: &str| {
            let v = if s.is_empty() {
                JSValue::UNDEFINED
            } else {
                bun_core::String::clone_utf8(s.as_bytes())
                    .to_js(global)
                    .or_report(global)
            };
            obj.put(global, name, v);
        };
        put_cid(b"initialSCID", tp.initial_scid_str());
        put_cid(b"retrySCID", tp.retry_scid_str());
        put_cid(b"originalDCID", tp.original_dcid_str());
        Ok(obj)
    }
}

fn opt_bytes_to_js(global: &JSGlobalObject, bytes: Option<&[u8]>) -> JSValue {
    match bytes {
        Some(b) => bun_core::String::clone_utf8(b)
            .to_js(global)
            .or_report(global),
        None => JSValue::UNDEFINED,
    }
}

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
    pub(crate) fn finalize(self: Box<Self>) {}
}

lsquic_callback! {
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
    pub(super) fn on_dg_write(session: &QuicSession, buf: *mut c_void, sz: usize) -> isize = -1; {
        // -1 means "nothing written"; lsquic treats any value >= 0 as a
        // datagram it should frame, so 0 emits an empty DATAGRAM frame.
        if buf.is_null() {
            return -1;
        }
        let Some((id, len)) = session
            .datagram_queue
            .get()
            .front()
            .map(|(id, p)| (*id, p.len()))
        else {
            // SAFETY: the conn is live for this callback.
            if let Some(c) = unsafe { lsquic::Conn::from_raw(session.conn.get()) } {
                c.want_datagram_write(false);
            }
            return -1;
        };
        if len > sz {
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
            // SAFETY: the conn is live for this callback.
            if let Some(c) = unsafe { lsquic::Conn::from_raw(session.conn.get()) } {
                c.want_datagram_write(true);
            }
        }
        payload.len() as isize
    }

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
        // Front of the queue: lsquic resets the early streams before this
        // callback, so their clean closes are already queued and would settle
        // `closed` before the rejection node delivers could land.
        session.events.with_mut(|e| e.insert(0, SessionEvent::EarlyDataFailed));
        session.schedule_process();
    }

    pub(super) fn on_origin(session: &QuicSession, chunk: *const u8, len: usize, fin: c_int) {
        if !chunk.is_null() && len > 0 {
            // SAFETY: `chunk[..len]` is live for the duration of this callback.
            let bytes = unsafe { core::slice::from_raw_parts(chunk, len) };
            session.origin_buf.with_mut(|b| {
                let room = MAX_ORIGIN_BYTES.saturating_sub(b.len());
                b.extend_from_slice(&bytes[..bytes.len().min(room)]);
            });
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
        // SAFETY: `session.conn` is the live conn while this callback runs.
        let early = unsafe { lsquic::Conn::from_raw(session.conn.get()) }
            .is_some_and(|c| c.datagram_early());
        session.push_event(SessionEvent::Datagram { payload, early });
    }
}
