#![allow(non_camel_case_types)]

use core::ffi::{c_char, c_int, c_uint, c_ulong, c_void};

use bun_core::strings;

#[repr(C)]
pub struct lsquic_engine {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct lsquic_conn {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct lsquic_stream {
    _opaque: [u8; 0],
}
#[repr(C)]
pub struct lsquic_engine_settings {
    _opaque: [u8; 0],
}
pub type sockaddr = c_void;
#[repr(C)]
pub struct SSL_CTX {
    _opaque: [u8; 0],
}

pub const LSQ_HSK_OK: c_int = 1;
pub const LSQ_HSK_RESUMED_OK: c_int = 2;

pub const LSCONN_ST_HSK_FAILURE: c_int = 2;
pub const LSCONN_ST_TIMED_OUT: c_int = 4;
pub const LSCONN_ST_RESET: c_int = 5;
pub const LSCONN_ST_ERROR: c_int = 7;
pub const LSCONN_ST_VERNEG_FAILURE: c_int = 10;

/// `enum lsquic_dg_status`, the `status` of `NqVtable::on_datagram_status`.
pub const LSQ_DG_ACKED: c_int = 0;
pub const LSQ_DG_LOST: c_int = 1;
pub const LSQ_DG_UNSENT: c_int = 2;

/// What lsquic did with a header block, from [`Stream::send_headers`].
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SendHeaders {
    Sent,
    /// lsquic is still sending the stream's previous block and took nothing of this one. It goes again from the stream's next write event.
    Retry,
    Refused,
}

/// **Layout must match `struct us_nq_vtable` in node_quic_shim.c exactly.**
/// The first field of every conn-ctx and stream-ctx the Rust side returns
/// must be a `*const NqVtable` so the thunks can recover it via
/// `*(struct us_nq_vtable **) ctx`.
#[repr(C)]
pub struct NqVtable {
    pub owner: *mut c_void,
    pub on_new_conn: unsafe extern "C" fn(owner: *mut c_void, c: *mut lsquic_conn) -> *mut c_void,
    pub on_hsk_done: unsafe extern "C" fn(conn_ctx: *mut c_void, status: c_int),
    pub on_hsk_confirmed: unsafe extern "C" fn(conn_ctx: *mut c_void),
    pub on_goaway_received: unsafe extern "C" fn(conn_ctx: *mut c_void),
    pub on_conn_closed: unsafe extern "C" fn(conn_ctx: *mut c_void),
    pub on_conncloseframe: unsafe extern "C" fn(
        conn_ctx: *mut c_void,
        app_error: c_int,
        code: u64,
        reason: *const c_char,
        reason_len: c_int,
    ),
    pub on_new_token:
        unsafe extern "C" fn(conn_ctx: *mut c_void, token: *const u8, token_size: usize),
    pub on_sess_resume:
        unsafe extern "C" fn(conn_ctx: *mut c_void, blob: *const u8, blob_size: usize),
    pub on_new_stream:
        unsafe extern "C" fn(owner: *mut c_void, s: *mut lsquic_stream) -> *mut c_void,
    pub on_stream_read: unsafe extern "C" fn(stream_ctx: *mut c_void, s: *mut lsquic_stream),
    pub on_stream_write: unsafe extern "C" fn(stream_ctx: *mut c_void, s: *mut lsquic_stream),
    pub on_stream_close: unsafe extern "C" fn(stream_ctx: *mut c_void, s: *mut lsquic_stream),
    pub on_stream_reset: unsafe extern "C" fn(stream_ctx: *mut c_void, how: c_int, error_code: u64),
    pub on_dg_write:
        unsafe extern "C" fn(conn_ctx: *mut c_void, buf: *mut c_void, buf_sz: usize) -> isize,
    pub on_datagram: unsafe extern "C" fn(conn_ctx: *mut c_void, buf: *const c_void, sz: usize),
    pub on_datagram_status: unsafe extern "C" fn(conn_ctx: *mut c_void, id: u64, status: c_int),
    pub on_early_data_failed: unsafe extern "C" fn(conn_ctx: *mut c_void),
    pub on_path_switch: unsafe extern "C" fn(
        conn_ctx: *mut c_void,
        validated: c_int,
        is_preferred: c_int,
        new_local: *const sockaddr,
        new_peer: *const sockaddr,
        old_local: *const sockaddr,
        old_peer: *const sockaddr,
    ),
    pub on_origin:
        unsafe extern "C" fn(conn_ctx: *mut c_void, chunk: *const u8, len: usize, fin: c_int),
    pub lookup_cert: unsafe extern "C" fn(
        owner: *mut c_void,
        local: *const sockaddr,
        sni: *const c_char,
    ) -> *mut SSL_CTX,
    pub on_new_mini_conn:
        unsafe extern "C" fn(owner: *mut c_void, c: *mut lsquic_conn) -> *mut c_void,
    pub on_mini_conn_failed: unsafe extern "C" fn(conn_ctx: *mut c_void, error_code: u64),
}

unsafe extern "C" {
    pub fn lsquic_engine_conn_count(engine: *const lsquic_engine) -> c_uint;
    pub fn lsquic_engine_cid_in_use(
        engine: *mut lsquic_engine,
        cid: *const u8,
        cid_len: usize,
    ) -> c_int;
    pub fn lsquic_engine_packet_in(
        engine: *mut lsquic_engine,
        data: *const u8,
        size: usize,
        sa_local: *const sockaddr,
        sa_peer: *const sockaddr,
        peer_ctx: *mut c_void,
        ecn: c_int,
    ) -> c_int;

    pub fn lsquic_conn_get_ctx(c: *const lsquic_conn) -> *mut c_void;
    pub fn lsquic_conn_set_ctx(c: *mut lsquic_conn, ctx: *mut c_void);
    pub fn lsquic_conn_close(c: *mut lsquic_conn);
    fn lsquic_conn_going_away(c: *mut lsquic_conn);
    fn lsquic_conn_status(c: *mut lsquic_conn, errbuf: *mut c_char, bufsz: usize) -> c_int;
    pub fn lsquic_conn_make_stream(c: *mut lsquic_conn);
    pub fn lsquic_conn_make_uni_stream(c: *mut lsquic_conn);
    fn lsquic_conn_cancel_pending_streams(c: *mut lsquic_conn, n: c_uint) -> c_uint;
    fn lsquic_conn_cancel_pending_uni_streams(c: *mut lsquic_conn, n: c_uint) -> c_uint;
    pub fn lsquic_conn_get_sockaddr(
        c: *mut lsquic_conn,
        local: *mut *const sockaddr,
        peer: *mut *const sockaddr,
    ) -> c_int;
    fn lsquic_conn_get_sni(c: *mut lsquic_conn) -> *const c_char;
    fn lsquic_conn_want_datagram_write(c: *mut lsquic_conn, is_want: c_int) -> c_int;
    fn lsquic_conn_crypto_cipher(c: *const lsquic_conn) -> *const c_char;
    fn lsquic_conn_get_server_cert_chain(c: *mut lsquic_conn) -> *mut c_void;
    pub fn lsquic_conn_get_ssl(c: *const lsquic_conn) -> *mut c_void;
    pub fn lsquic_ssl_to_conn(ssl: *const c_void) -> *mut lsquic_conn;
    pub fn lsquic_conn_abort_error(
        c: *mut lsquic_conn,
        is_app: c_int,
        code: c_uint,
        reason: *const c_char,
    );
    pub fn lsquic_conn_get_info(c: *mut lsquic_conn, info: *mut ConnInfo) -> c_int;
    pub fn lsquic_conn_transport_params(
        c: *const lsquic_conn,
        peer: c_int,
        out: *mut NqTransportParams,
    ) -> c_int;
    pub fn us_nq_tp_size() -> usize;

    fn lsquic_stream_id(s: *const lsquic_stream) -> u64;
    pub fn lsquic_stream_conn(s: *const lsquic_stream) -> *mut lsquic_conn;
    pub fn lsquic_stream_read(s: *mut lsquic_stream, buf: *mut c_void, len: usize) -> isize;
    pub fn lsquic_stream_write(s: *mut lsquic_stream, buf: *const c_void, len: usize) -> isize;
    pub fn lsquic_stream_flush(s: *mut lsquic_stream) -> c_int;
    pub fn lsquic_stream_shutdown(s: *mut lsquic_stream, how: c_int) -> c_int;
    pub fn lsquic_stream_close(s: *mut lsquic_stream) -> c_int;
    pub fn lsquic_stream_wantread(s: *mut lsquic_stream, is_want: c_int) -> c_int;
    pub fn lsquic_stream_wantwrite(s: *mut lsquic_stream, is_want: c_int) -> c_int;

    pub fn us_nq_vtable_size() -> usize;
    pub fn us_nq_settings_size() -> usize;
    pub fn us_nq_settings_init(s: *mut lsquic_engine_settings, is_server: c_int, is_http: c_int);
    /// `driver` is the `us_quic_driver_t` that owns the new engine.
    pub fn us_nq_engine_new(
        driver: *mut c_void,
        is_server: c_int,
        is_http: c_int,
        vt: *mut NqVtable,
        settings: *const lsquic_engine_settings,
    ) -> *mut lsquic_engine;
    pub fn lsquic_stream_force_reset_ext(s: *mut lsquic_stream, code: u64);
    pub fn us_nq_hset_pairs(hset: *mut c_void, len: *mut usize) -> *const c_char;
    pub fn us_nq_hset_free(hset: *mut c_void);
    pub fn us_nq_stream_send_headers(
        s: *mut lsquic_stream,
        buf: *const c_char,
        len: usize,
        expected: c_int,
        eos: c_int,
    ) -> c_int;
    pub fn lsquic_stream_get_hset(s: *mut lsquic_stream) -> *mut c_void;

    fn us_nq_settings_set_idle_timeout(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_idle_timeout_ms(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_delayed_acks(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_handshake_to(s: *mut lsquic_engine_settings, v: c_ulong);
    fn us_nq_settings_set_ping_period(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_ping_period_us(s: *mut lsquic_engine_settings, v: u64);
    fn lsquic_conn_pings_received(c: *const lsquic_conn) -> u64;
    fn us_nq_settings_set_init_max_data(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_init_max_stream_data_bidi_local(
        s: *mut lsquic_engine_settings,
        v: c_uint,
    );
    fn us_nq_settings_set_init_max_stream_data_bidi_remote(
        s: *mut lsquic_engine_settings,
        v: c_uint,
    );
    fn us_nq_settings_set_init_max_stream_data_uni(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_init_max_streams_bidi(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_init_max_streams_uni(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_max_udp_payload_size_rx(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_datagrams(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_h3_datagram(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_send_prst(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_honor_prst(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_sreset_burst(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_sreset_rate(s: *mut lsquic_engine_settings, v: f64);
    fn us_nq_settings_set_h3_connect_protocol(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_preferred_address(s: *mut lsquic_engine_settings, addr: *const u8);
    pub fn lsquic_engine_sreset_stats(e: *const lsquic_engine, sent: *mut u64, limited: *mut u64);
    fn us_nq_settings_set_max_datagram_frame_size(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_max_h3_header_pairs(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_max_h3_header_bytes(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_allow_migration(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_origin_blob(
        s: *mut lsquic_engine_settings,
        blob: *const u8,
        len: usize,
    );
    fn us_nq_settings_set_silent_close(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_cc_algo(s: *mut lsquic_engine_settings, v: c_uint);
}

#[derive(PartialEq, Eq)]
pub struct Settings {
    bytes: Vec<u8>,
}

impl Settings {
    /// RFC 9000 preferred_address transport parameter: 4-byte IPv4 + 2-byte
    /// port + 16-byte IPv6 + 2-byte port (network order), zeros = absent.
    pub fn preferred_address(&mut self, addr: &[u8; 24]) {
        // SAFETY: `self.bytes` is the live settings blob; the shim copies.
        unsafe { us_nq_settings_set_preferred_address(self.raw(), addr.as_ptr()) }
    }

    /// Pre-encoded HTTP/3 ORIGIN frame payload (RFC 9412) the server sends
    /// after SETTINGS. NOT copied — the caller must keep `blob` alive for
    /// the engine's lifetime.
    pub fn origin_blob(&mut self, blob: &[u8]) {
        // SAFETY: `self.bytes` is the live settings blob; the caller
        // guarantees `blob` outlives the engine (it lives on the endpoint).
        unsafe { us_nq_settings_set_origin_blob(self.raw(), blob.as_ptr(), blob.len()) }
    }

    pub fn new(is_server: bool, is_http: bool) -> Self {
        // SAFETY: pure size query.
        let size = unsafe { us_nq_settings_size() };
        let mut bytes = vec![0u8; size];
        // SAFETY: `bytes` is a fresh zeroed allocation of the right size.
        unsafe {
            us_nq_settings_init(
                bytes.as_mut_ptr().cast(),
                is_server as c_int,
                is_http as c_int,
            )
        };
        Self { bytes }
    }
    fn raw(&mut self) -> *mut lsquic_engine_settings {
        self.bytes.as_mut_ptr().cast()
    }
    pub fn as_ptr(&self) -> *const lsquic_engine_settings {
        self.bytes.as_ptr().cast()
    }
}

macro_rules! settings_setters {
    ($($name:ident => $ffi:ident : $ty:ty),* $(,)?) => {
        impl Settings {
            $(pub fn $name(&mut self, v: $ty) -> &mut Self {
                // SAFETY: `raw()` is a live settings struct of the size the
                // shim expects.
                unsafe { $ffi(self.raw(), v) };
                self
            })*
        }
    };
}
macro_rules! settings_getters {
    ($($name:ident => $ffi:ident : $ty:ty),* $(,)?) => {
        unsafe extern "C" { $(fn $ffi(s: *const lsquic_engine_settings) -> $ty;)* }
        impl Settings {
            $(pub fn $name(&self) -> u64 {
                // SAFETY: `as_ptr()` is a live settings struct.
                unsafe { $ffi(self.as_ptr()) as u64 }
            })*
        }
    };
}
settings_getters! {
    get_init_max_data => us_nq_settings_get_init_max_data : c_uint,
    get_init_max_stream_data_bidi_local => us_nq_settings_get_init_max_stream_data_bidi_local : c_uint,
    get_init_max_stream_data_bidi_remote => us_nq_settings_get_init_max_stream_data_bidi_remote : c_uint,
    get_init_max_stream_data_uni => us_nq_settings_get_init_max_stream_data_uni : c_uint,
    get_init_max_streams_bidi => us_nq_settings_get_init_max_streams_bidi : c_uint,
    get_init_max_streams_uni => us_nq_settings_get_init_max_streams_uni : c_uint,
    get_idle_timeout => us_nq_settings_get_idle_timeout : c_uint,
    get_idle_timeout_ms => us_nq_settings_get_idle_timeout_ms : c_uint,
    get_max_udp_payload_size_rx => us_nq_settings_get_max_udp_payload_size_rx : u16,
    get_allow_migration => us_nq_settings_get_allow_migration : c_int,
    get_datagrams => us_nq_settings_get_datagrams : c_int,
    get_max_datagram_frame_size => us_nq_settings_get_max_datagram_frame_size : u16,
}

settings_setters! {
    idle_timeout => us_nq_settings_set_idle_timeout : c_uint,
    idle_timeout_ms => us_nq_settings_set_idle_timeout_ms : c_uint,
    delayed_acks => us_nq_settings_set_delayed_acks : c_int,
    handshake_to => us_nq_settings_set_handshake_to : c_ulong,
    ping_period => us_nq_settings_set_ping_period : c_uint,
    ping_period_us => us_nq_settings_set_ping_period_us : u64,
    init_max_data => us_nq_settings_set_init_max_data : c_uint,
    init_max_stream_data_bidi_local => us_nq_settings_set_init_max_stream_data_bidi_local : c_uint,
    init_max_stream_data_bidi_remote => us_nq_settings_set_init_max_stream_data_bidi_remote : c_uint,
    init_max_stream_data_uni => us_nq_settings_set_init_max_stream_data_uni : c_uint,
    init_max_streams_bidi => us_nq_settings_set_init_max_streams_bidi : c_uint,
    init_max_streams_uni => us_nq_settings_set_init_max_streams_uni : c_uint,
    max_udp_payload_size_rx => us_nq_settings_set_max_udp_payload_size_rx : u16,
    datagrams => us_nq_settings_set_datagrams : c_int,
    h3_datagram => us_nq_settings_set_h3_datagram : c_int,
    send_prst => us_nq_settings_set_send_prst : c_int,
    honor_prst => us_nq_settings_set_honor_prst : c_int,
    sreset_burst => us_nq_settings_set_sreset_burst : c_uint,
    sreset_rate => us_nq_settings_set_sreset_rate : f64,
    h3_connect_protocol => us_nq_settings_set_h3_connect_protocol : c_int,
    max_datagram_frame_size => us_nq_settings_set_max_datagram_frame_size : u16,
    max_h3_header_pairs => us_nq_settings_set_max_h3_header_pairs : u16,
    max_h3_header_bytes => us_nq_settings_set_max_h3_header_bytes : c_uint,
    allow_migration => us_nq_settings_set_allow_migration : c_int,
    silent_close => us_nq_settings_set_silent_close : c_int,
    cc_algo => us_nq_settings_set_cc_algo : c_uint,
}

/// `conn` must be a live `lsquic_conn_t`.
unsafe fn sockaddrs(conn: *mut lsquic_conn) -> Option<(*const sockaddr, *const sockaddr)> {
    let mut local = core::ptr::null();
    let mut peer = core::ptr::null();
    // SAFETY: caller contract; the out-params point at stack slots.
    let found = unsafe { lsquic_conn_get_sockaddr(conn, &raw mut local, &raw mut peer) } == 0;
    found.then_some((local, peer))
}

/// Borrowed mini conn (a server handshake). Most `Conn` methods would call through a NULL function pointer on it.
#[derive(Copy, Clone)]
pub struct MiniConn(core::ptr::NonNull<lsquic_conn>);

impl MiniConn {
    /// `raw` must be a live mini conn for the lifetime of the returned value.
    pub unsafe fn from_raw(raw: *mut lsquic_conn) -> Option<Self> {
        core::ptr::NonNull::new(raw).map(Self)
    }
    /// Takes the application context off the conn.
    pub fn clear_ctx(&self) {
        // SAFETY: `self.0` is live (caller contract).
        unsafe { lsquic_conn_set_ctx(self.0.as_ptr(), core::ptr::null_mut()) }
    }
    /// Makes the conn skip its TLS handshake and answer with a transport CONNECTION_CLOSE.
    pub fn refuse(&self, code: c_uint) {
        // SAFETY: as above.
        unsafe { lsquic_conn_abort_error(self.0.as_ptr(), 0, code, core::ptr::null()) }
    }
    /// The `(local, peer)` sockaddrs of the conn's first packet.
    pub fn sockaddrs(&self) -> Option<(*const sockaddr, *const sockaddr)> {
        // SAFETY: as above.
        unsafe { sockaddrs(self.0.as_ptr()) }
    }
}

/// Borrowed `lsquic_conn_t`. lsquic owns the conn and frees it after
/// `on_conn_closed` returns; callers must not hold a `Conn` past that point.
#[derive(Copy, Clone)]
pub struct Conn(*mut lsquic_conn);

impl Conn {
    /// `raw` must be a live full conn (not a `MiniConn`) until `on_conn_closed` returns for it.
    pub unsafe fn from_raw(raw: *mut lsquic_conn) -> Option<Self> {
        (!raw.is_null()).then_some(Self(raw))
    }
    /// The `(local, peer)` sockaddrs of the conn's current path.
    pub fn sockaddrs(&self) -> Option<(*const sockaddr, *const sockaddr)> {
        // SAFETY: `self.0` is live (caller contract).
        unsafe { sockaddrs(self.0) }
    }
    pub fn close(&self) {
        // SAFETY: `self.0` is live (caller contract).
        unsafe { lsquic_conn_close(self.0) }
    }
    pub fn going_away(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_going_away(self.0) }
    }
    pub fn abort_silent(&self) {
        unsafe extern "C" {
            fn lsquic_conn_abort_silent(c: *mut lsquic_conn);
        }
        // SAFETY: as above.
        unsafe { lsquic_conn_abort_silent(self.0) }
    }
    pub fn abort_error(&self, is_app: bool, code: c_uint, reason: &core::ffi::CStr) {
        // SAFETY: as above; `reason` is NUL-terminated by construction.
        unsafe { lsquic_conn_abort_error(self.0, is_app as c_int, code, reason.as_ptr()) }
    }
    /// SETTINGS_H3_DATAGRAM state (RFC 9297).
    pub fn peer_h3_datagram(&self) -> Option<bool> {
        unsafe extern "C" {
            fn lsquic_conn_peer_h3_datagram(c: *const lsquic_conn) -> c_int;
        }
        // SAFETY: as above.
        match unsafe { lsquic_conn_peer_h3_datagram(self.0) } {
            -1 => None,
            v => Some(v != 0),
        }
    }
    pub fn make_stream(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_make_stream(self.0) }
    }
    pub fn make_uni_stream(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_make_uni_stream(self.0) }
    }
    /// Takes back one `make_stream` or `make_uni_stream` request that lsquic hasn't created a stream for yet.
    pub fn cancel_pending_stream(&self, uni: bool) {
        // SAFETY: as above.
        unsafe {
            if uni {
                lsquic_conn_cancel_pending_uni_streams(self.0, 1);
            } else {
                lsquic_conn_cancel_pending_streams(self.0, 1);
            }
        }
    }
    pub fn want_datagram_write(&self, want: bool) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_conn_want_datagram_write(self.0, want as c_int) }
    }
    pub fn sni(&self) -> Option<&core::ffi::CStr> {
        // SAFETY: as above; lsquic returns NULL or a NUL-terminated string
        // owned by the conn.
        let p = unsafe { lsquic_conn_get_sni(self.0) };
        // SAFETY: as above.
        (!p.is_null()).then(|| unsafe { core::ffi::CStr::from_ptr(p) })
    }
    pub fn pings_received(&self) -> u64 {
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_pings_received(self.0) }
    }
    pub fn ack_now(&self) {
        unsafe extern "C" {
            fn lsquic_conn_ack_now(c: *mut lsquic_conn);
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_ack_now(self.0) }
    }
    pub fn use_preferred_address(&self, on: bool) {
        unsafe extern "C" {
            fn lsquic_conn_use_preferred_address(c: *mut lsquic_conn, on: c_int);
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_use_preferred_address(self.0, on as c_int) }
    }
    /// Only valid inside `on_dg_write`: the id `on_datagram_status` reports the frame under.
    pub fn set_datagram_id(&self, id: u64) {
        unsafe extern "C" {
            fn lsquic_conn_set_datagram_id(c: *mut lsquic_conn, id: u64);
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_set_datagram_id(self.0, id) }
    }
    pub fn datagram_early(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_conn_datagram_early(c: *const lsquic_conn) -> c_int;
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_datagram_early(self.0) != 0 }
    }
    pub fn cipher(&self) -> Option<&core::ffi::CStr> {
        // SAFETY: as above.
        let p = unsafe { lsquic_conn_crypto_cipher(self.0) };
        // SAFETY: as above.
        (!p.is_null()).then(|| unsafe { core::ffi::CStr::from_ptr(p) })
    }
    pub fn server_cert_chain(&self) -> *mut c_void {
        // SAFETY: as above.
        unsafe { lsquic_conn_get_server_cert_chain(self.0) }
    }
    pub fn ssl(&self) -> *mut c_void {
        // SAFETY: as above.
        unsafe { lsquic_conn_get_ssl(self.0) }
    }
    /// Returns `lsquic_conn_status()`, its message, and the transport error code recorded for this side's CONNECTION_CLOSE.
    pub fn status(&self) -> (c_int, Vec<u8>, Option<u64>) {
        unsafe extern "C" {
            fn lsquic_conn_local_transport_error(c: *const lsquic_conn, code: *mut u64) -> c_int;
        }
        let mut buf = [0 as c_char; 256];
        // SAFETY: as above.
        let status = unsafe { lsquic_conn_status(self.0, buf.as_mut_ptr(), buf.len()) };
        // SAFETY: `buf` starts zeroed, and lsquic NUL-terminates what it writes.
        let message = unsafe { core::ffi::CStr::from_ptr(buf.as_ptr()) }
            .to_bytes()
            .to_vec();
        let mut code = 0u64;
        // SAFETY: as above. `code` is a stack out-param.
        let recorded = unsafe { lsquic_conn_local_transport_error(self.0, &raw mut code) } != 0;
        (status, message, recorded.then_some(code))
    }
}

/// Borrowed `lsquic_stream_t`. Same lifetime contract as [`Conn`] — invalid
/// after `on_close` returns for it.
#[derive(Copy, Clone)]
pub struct Stream(*mut lsquic_stream);

impl Stream {
    /// # Safety
    /// `raw` must be a live `lsquic_stream_t` (i.e. until its `on_close`).
    pub unsafe fn from_raw(raw: *mut lsquic_stream) -> Option<Self> {
        (!raw.is_null()).then_some(Self(raw))
    }
    pub fn raw(&self) -> *mut lsquic_stream {
        self.0
    }
    /// # Safety
    /// `ctx` must outlive the stream (lsquic stores it verbatim).
    pub unsafe fn set_ctx(&self, ctx: *mut c_void) {
        unsafe extern "C" {
            fn lsquic_stream_set_ctx(s: *mut lsquic_stream, ctx: *mut c_void);
        }
        // SAFETY: `self.0` is live (caller contract).
        unsafe { lsquic_stream_set_ctx(self.0, ctx) }
    }
    pub fn id(&self) -> u64 {
        // SAFETY: `self.0` is live (caller contract).
        unsafe { lsquic_stream_id(self.0) }
    }
    pub fn read(&self, buf: &mut [u8]) -> isize {
        // SAFETY: as above; `buf` is a live slice.
        unsafe { lsquic_stream_read(self.0, buf.as_mut_ptr().cast(), buf.len()) }
    }
    pub fn write(&self, buf: &[u8]) -> isize {
        // SAFETY: as above.
        unsafe { lsquic_stream_write(self.0, buf.as_ptr().cast(), buf.len()) }
    }
    pub fn flush(&self) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_stream_flush(self.0) }
    }
    pub fn shutdown(&self, how: c_int) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_stream_shutdown(self.0, how) }
    }
    pub fn shutdown_internal(&self) {
        unsafe extern "C" {
            fn lsquic_stream_shutdown_internal(s: *mut lsquic_stream);
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_shutdown_internal(self.0) }
    }
    pub fn close(&self) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_stream_close(self.0) }
    }
    pub fn want_read(&self, want: bool) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_stream_wantread(self.0, want as c_int) }
    }
    pub fn want_write(&self, want: bool) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_stream_wantwrite(self.0, want as c_int) }
    }
    /// Receive backpressure, see `lsquic_stream_hold_window()` in lsquic.h.
    pub fn hold_window(&self, hold: bool) {
        unsafe extern "C" {
            fn lsquic_stream_hold_window(s: *mut lsquic_stream, hold: c_int);
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_hold_window(self.0, hold as c_int) }
    }
    /// The smaller of the stream's and the connection's flow-control credit. lsquic only calls `on_write` above 0.
    pub fn write_avail(&self) -> usize {
        unsafe extern "C" {
            fn lsquic_stream_write_avail(s: *mut lsquic_stream) -> usize;
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_write_avail(self.0) }
    }
    pub fn reset(&self, code: u64) {
        // SAFETY: as above.
        unsafe { lsquic_stream_force_reset_ext(self.0, code) }
    }
    pub fn error_code(&self) -> u64 {
        unsafe extern "C" {
            fn lsquic_stream_get_error_code(s: *const lsquic_stream) -> u64;
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_get_error_code(self.0) }
    }
    pub fn take_header_set(&self) -> Option<HeaderSet> {
        // SAFETY: as above.
        let raw = unsafe { lsquic_stream_get_hset(self.0) };
        (!raw.is_null()).then_some(HeaderSet(raw))
    }
    /// `expected` is the caller's header-pair count; the shim rejects a buffer
    /// that does not parse to exactly that many pairs.
    pub fn send_headers(&self, nul_joined: &[u8], expected: c_int, eos: bool) -> SendHeaders {
        /// `US_QUIC_SEND_HEADERS_RETRY` in quic.h.
        const RETRY: c_int = 1;
        // SAFETY: as above; lsquic copies the buffer before returning.
        let result = unsafe {
            us_nq_stream_send_headers(
                self.0,
                nul_joined.as_ptr().cast(),
                nul_joined.len(),
                expected,
                eos as c_int,
            )
        };
        match result {
            0 => SendHeaders::Sent,
            RETRY => SendHeaders::Retry,
            _ => SendHeaders::Refused,
        }
    }
    /// RFC 9218 Extensible HTTP Priority: urgency 0-7, incremental 0/1.
    pub fn set_http_prio(&self, urgency: u8, incremental: bool) -> c_int {
        #[repr(C)]
        struct ExtHttpPrio {
            urgency: u8,
            incremental: i8,
        }
        unsafe extern "C" {
            fn lsquic_stream_set_http_prio(s: *mut lsquic_stream, p: *const ExtHttpPrio) -> c_int;
        }
        let p = ExtHttpPrio {
            urgency: urgency.min(7),
            incremental: incremental as i8,
        };
        // SAFETY: `self.0` is live; `p` is a stack value.
        unsafe { lsquic_stream_set_http_prio(self.0, core::ptr::from_ref(&p)) }
    }
    pub fn get_http_prio(&self) -> Option<(u8, bool)> {
        #[repr(C)]
        struct ExtHttpPrio {
            urgency: u8,
            incremental: i8,
        }
        unsafe extern "C" {
            fn lsquic_stream_get_http_prio(s: *mut lsquic_stream, p: *mut ExtHttpPrio) -> c_int;
        }
        let mut p = ExtHttpPrio {
            urgency: 3,
            incremental: 0,
        };
        // SAFETY: `self.0` is live; `p` is a stack out-param.
        if unsafe { lsquic_stream_get_http_prio(self.0, core::ptr::from_mut(&mut p)) } == 0 {
            Some((p.urgency, p.incremental != 0))
        } else {
            None
        }
    }
    /// Bytes sent but not yet acknowledged by the peer (RFC 9000 §2.2).
    pub fn has_unacked_data(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_has_unacked_data(s: *mut lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_has_unacked_data(self.0) != 0 }
    }
    /// Returns true if both sides are closed and every frame is acknowledged.
    pub fn is_finished(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_is_finished(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_is_finished(self.0) != 0 }
    }
    pub fn reset_received(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_reset_received(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_reset_received(self.0) != 0 }
    }
    pub fn is_rejected(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_is_rejected(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_is_rejected(self.0) != 0 }
    }
    pub fn received_early_data(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_received_early_data(s: *mut lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_received_early_data(self.0) != 0 }
    }
    pub fn stop_sending(&self, code: u64) {
        unsafe extern "C" {
            fn lsquic_stream_send_stop_sending(s: *mut lsquic_stream, code: u64);
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_send_stop_sending(self.0, code) }
    }
}

pub struct HeaderSet(*mut c_void);

impl HeaderSet {
    /// h3 permits bytes that are not valid UTF-8, so the JS boundary picks the
    /// encoding (latin1, as node does for HTTP headers).
    pub fn pairs(&self) -> Vec<Vec<u8>> {
        let mut len: usize = 0;
        // SAFETY: `self.0` is a live `nq_hset` until `Drop`.
        let p = unsafe { us_nq_hset_pairs(self.0, core::ptr::from_mut(&mut len)) };
        if p.is_null() || len == 0 {
            return Vec::new();
        }
        // SAFETY: the shim guarantees `p[..len]` is valid until free.
        let bytes = unsafe { core::slice::from_raw_parts(p.cast::<u8>(), len) };
        let bytes = bytes.strip_suffix(&[0u8][..]).unwrap_or(bytes);
        strings::split(bytes, b"\0").map(<[u8]>::to_vec).collect()
    }
}

impl Drop for HeaderSet {
    fn drop(&mut self) {
        // SAFETY: `self.0` was returned by `lsquic_stream_get_hset` and not
        // freed (lsquic transferred ownership).
        unsafe { us_nq_hset_free(self.0) }
    }
}

/// Mirrors `struct lsquic_conn_info` (lsquic.h).
#[repr(C)]
#[derive(Default)]
pub struct ConnInfo {
    pub cwnd: u32,
    pub(crate) pmtu: u32,
    pub rtt: u32,
    pub rttvar: u32,
    pub rtt_min: u32,
    pub bytes_rcvd: u64,
    pub bytes_sent: u64,
    pub pkts_rcvd: u64,
    pub pkts_sent: u64,
    pub pkts_lost: u64,
    pub pkts_retx: u64,
    pub(crate) bw_estimate: u64,
    pub(crate) max_pacing_rate: u64,
    pub(crate) pacing_rate: u64,
}

impl Conn {
    pub fn info(&self) -> Option<ConnInfo> {
        let mut out = ConnInfo::default();
        // SAFETY: `self.0` is live; `out` is a stack out-param.
        if unsafe { lsquic_conn_get_info(self.0, core::ptr::from_mut(&mut out)) } == 0 {
            Some(out)
        } else {
            None
        }
    }
}

/// Mirrors `struct us_nq_tp` (node_quic_shim.c).
#[repr(C)]
pub struct NqTransportParams {
    pub initial_max_stream_data_bidi_local: u64,
    pub initial_max_stream_data_bidi_remote: u64,
    pub initial_max_stream_data_uni: u64,
    pub initial_max_data: u64,
    pub initial_max_streams_bidi: u64,
    pub initial_max_streams_uni: u64,
    pub max_idle_timeout: u64,
    pub max_udp_payload_size: u64,
    pub ack_delay_exponent: u64,
    pub max_ack_delay: u64,
    pub active_connection_id_limit: u64,
    pub max_datagram_frame_size: u64,
    pub disable_active_migration: c_int,
    pub initial_scid: [u8; 2 * MAX_CID_LEN + 1],
    pub retry_scid: [u8; 2 * MAX_CID_LEN + 1],
    pub original_dcid: [u8; 2 * MAX_CID_LEN + 1],
}

pub const MAX_CID_LEN: usize = 20;

impl NqTransportParams {
    fn cid_str(buf: &[u8; 2 * MAX_CID_LEN + 1]) -> &str {
        let nul = strings::index_of_char_usize(buf, 0).unwrap_or(buf.len());
        core::str::from_utf8(&buf[..nul]).unwrap_or("")
    }
    pub fn initial_scid_str(&self) -> &str {
        Self::cid_str(&self.initial_scid)
    }
    pub fn retry_scid_str(&self) -> &str {
        Self::cid_str(&self.retry_scid)
    }
    pub fn original_dcid_str(&self) -> &str {
        Self::cid_str(&self.original_dcid)
    }
}

impl Default for NqTransportParams {
    fn default() -> Self {
        // SAFETY: `#[repr(C)]` POD (u64 / c_int / byte arrays); all-zero is a valid
        // bit pattern for every field.
        unsafe { core::mem::MaybeUninit::zeroed().assume_init() }
    }
}

impl Conn {
    pub fn peer_transport_params(&self) -> Option<NqTransportParams> {
        let mut out = NqTransportParams::default();
        // SAFETY: `self.0` is live; `out` is a stack out-param.
        if unsafe { lsquic_conn_transport_params(self.0, 1, core::ptr::from_mut(&mut out)) } == 1 {
            Some(out)
        } else {
            None
        }
    }
}

pub fn debug_assert_layout() {
    debug_assert_eq!(
        // SAFETY: pure size query.
        unsafe { us_nq_vtable_size() },
        core::mem::size_of::<NqVtable>(),
        "us_nq_vtable layout mismatch between node_quic_shim.c and lsquic_sys"
    );
    debug_assert_eq!(
        // SAFETY: pure size query.
        unsafe { us_nq_tp_size() },
        core::mem::size_of::<NqTransportParams>(),
        "us_nq_tp layout mismatch: peer_transport_params passes a stack \
         NqTransportParams that C fills with sizeof(struct us_nq_tp) bytes"
    );
}
