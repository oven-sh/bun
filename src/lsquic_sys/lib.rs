//! Rust bindings for lsquic (vendor build) plus the small C shim in
//! `packages/bun-usockets/src/node_quic_shim.c`.
//!
//! lsquic's `lsquic_engine_settings` / `lsquic_engine_api` / `lsquic_stream_if`
//! / `lsquic_out_spec` structs are large and version-sensitive, so this crate
//! does **not** mirror their layouts. Instead the shim exposes sizeof, an
//! init-defaults call, and named setters for the handful of settings node:quic
//! touches; everything else is opaque pointers.

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![allow(clippy::missing_safety_doc)]

use core::ffi::{c_char, c_int, c_uint, c_ulong, c_void};

/// Opaque `lsquic_engine_t`.
#[repr(C)]
pub struct lsquic_engine {
    _opaque: [u8; 0],
}
/// Opaque `lsquic_conn_t`.
#[repr(C)]
pub struct lsquic_conn {
    _opaque: [u8; 0],
}
/// Opaque `lsquic_stream_t`.
#[repr(C)]
pub struct lsquic_stream {
    _opaque: [u8; 0],
}
/// Opaque `struct lsquic_engine_settings` (size via [`us_nq_settings_size`]).
#[repr(C)]
pub struct lsquic_engine_settings {
    _opaque: [u8; 0],
}
/// Opaque `struct lsquic_out_spec` (accessed via `us_nq_spec_*`).
#[repr(C)]
pub struct lsquic_out_spec {
    _opaque: [u8; 0],
}
/// Opaque `struct sockaddr`.
pub type sockaddr = c_void;
/// Opaque `struct iovec`.
#[repr(C)]
pub struct iovec {
    pub iov_base: *mut c_void,
    pub iov_len: usize,
}
/// Opaque BoringSSL `SSL_CTX`.
#[repr(C)]
pub struct SSL_CTX {
    _opaque: [u8; 0],
}

/// `enum lsquic_hsk_status` (passed to `on_hsk_done`).
pub const LSQ_HSK_FAIL: c_int = 0;
pub const LSQ_HSK_OK: c_int = 1;
pub const LSQ_HSK_RESUMED_OK: c_int = 2;
pub const LSQ_HSK_RESUMED_FAIL: c_int = 3;

/// `enum LSQUIC_CONN_STATUS` (return of `lsquic_conn_status`).
pub const LSCONN_ST_HSK_IN_PROGRESS: c_int = 0;
pub const LSCONN_ST_CONNECTED: c_int = 1;
pub const LSCONN_ST_HSK_FAILURE: c_int = 2;
pub const LSCONN_ST_GOING_AWAY: c_int = 3;
pub const LSCONN_ST_TIMED_OUT: c_int = 4;
pub const LSCONN_ST_RESET: c_int = 5;
pub const LSCONN_ST_USER_ABORTED: c_int = 6;
pub const LSCONN_ST_ERROR: c_int = 7;
pub const LSCONN_ST_CLOSED: c_int = 8;
pub const LSCONN_ST_PEER_GOING_AWAY: c_int = 9;
pub const LSCONN_ST_VERNEG_FAILURE: c_int = 10;

/// `enum lsquic_version` (subset).
pub const LSQVER_I001: c_int = 5;
pub const LSQVER_I002: c_int = 6;
/// Sentinel "engine picks" passed to `lsquic_engine_connect`.
pub const N_LSQVER: c_int = 8;

/// `lsquic_global_init` flags.
pub const LSQUIC_GLOBAL_CLIENT: c_int = 1;
pub const LSQUIC_GLOBAL_SERVER: c_int = 2;

/// Rust callback table the shim's `lsquic_stream_if` thunks dispatch into.
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
    pub on_datagram_status:
        unsafe extern "C" fn(conn_ctx: *mut c_void, count: c_uint, acked: c_int),
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
    pub get_ssl_ctx:
        unsafe extern "C" fn(owner: *mut c_void, local: *const sockaddr) -> *mut SSL_CTX,
    pub lookup_cert: unsafe extern "C" fn(
        owner: *mut c_void,
        local: *const sockaddr,
        sni: *const c_char,
    ) -> *mut SSL_CTX,
    pub packets_out:
        unsafe extern "C" fn(owner: *mut c_void, specs: *const lsquic_out_spec, n: c_uint) -> c_int,
    pub on_mini_conn_failed:
        unsafe extern "C" fn(owner: *mut c_void, peer_sa: *const sockaddr, error_code: u64),
}

unsafe extern "C" {
    // ── lsquic core ───────────────────────────────────────────────────────
    pub fn lsquic_global_init(flags: c_int) -> c_int;
    pub fn lsquic_engine_destroy(engine: *mut lsquic_engine);
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
    pub fn lsquic_engine_process_conns(engine: *mut lsquic_engine);
    pub fn lsquic_engine_set_idle_timeout_ms(engine: *mut lsquic_engine, ms: c_uint);
    pub fn lsquic_engine_earliest_adv_tick(engine: *mut lsquic_engine, diff: *mut c_int) -> c_int;
    pub fn lsquic_engine_has_unsent_packets(engine: *mut lsquic_engine) -> c_int;
    pub fn lsquic_engine_send_unsent_packets(engine: *mut lsquic_engine);
    pub fn lsquic_engine_connect(
        engine: *mut lsquic_engine,
        version: c_int,
        local_sa: *const sockaddr,
        peer_sa: *const sockaddr,
        peer_ctx: *mut c_void,
        conn_ctx: *mut c_void,
        hostname: *const c_char,
        base_plpmtu: u16,
        sess_resume: *const u8,
        sess_resume_len: usize,
        token: *const u8,
        token_sz: usize,
    ) -> *mut lsquic_conn;

    // ── conn ─────────────────────────────────────────────────────────────
    pub fn lsquic_conn_get_ctx(c: *const lsquic_conn) -> *mut c_void;
    pub fn lsquic_conn_get_peer_ctx(c: *const lsquic_conn, local_sa: *const c_void) -> *mut c_void;
    pub fn lsquic_conn_set_ctx(c: *mut lsquic_conn, ctx: *mut c_void);
    pub fn lsquic_conn_close(c: *mut lsquic_conn);
    pub fn lsquic_conn_going_away(c: *mut lsquic_conn);
    pub fn lsquic_conn_abort(c: *mut lsquic_conn);
    pub fn lsquic_conn_status(c: *mut lsquic_conn, errbuf: *mut c_char, bufsz: usize) -> c_int;
    pub fn lsquic_conn_make_stream(c: *mut lsquic_conn);
    pub fn lsquic_conn_make_uni_stream(c: *mut lsquic_conn);
    pub fn lsquic_conn_n_avail_streams(c: *const lsquic_conn) -> c_uint;
    pub fn lsquic_conn_n_pending_streams(c: *const lsquic_conn) -> c_uint;
    pub fn lsquic_conn_get_sockaddr(
        c: *mut lsquic_conn,
        local: *mut *const sockaddr,
        peer: *mut *const sockaddr,
    ) -> c_int;
    pub fn lsquic_conn_get_sni(c: *mut lsquic_conn) -> *const c_char;
    pub fn lsquic_conn_want_datagram_write(c: *mut lsquic_conn, is_want: c_int) -> c_int;
    pub fn lsquic_conn_crypto_cipher(c: *const lsquic_conn) -> *const c_char;
    pub fn lsquic_conn_get_server_cert_chain(c: *mut lsquic_conn) -> *mut c_void;
    pub fn lsquic_conn_get_ssl(c: *const lsquic_conn) -> *mut c_void;
    pub fn lsquic_ssl_to_conn(ssl: *const c_void) -> *mut lsquic_conn;
    pub fn lsquic_conn_abort_error(
        c: *mut lsquic_conn,
        is_app: c_int,
        code: c_uint,
        reason: *const c_char,
    );
    pub fn lsquic_conn_get_info(c: *mut lsquic_conn, info: *mut ConnInfo) -> c_int;
    pub fn us_nq_conn_transport_params(
        c: *const lsquic_conn,
        peer: c_int,
        out: *mut NqTransportParams,
    ) -> c_int;
    pub fn us_nq_tp_size() -> usize;

    // ── stream ───────────────────────────────────────────────────────────
    pub fn lsquic_stream_id(s: *const lsquic_stream) -> u64;
    pub fn lsquic_stream_conn(s: *const lsquic_stream) -> *mut lsquic_conn;
    pub fn lsquic_stream_get_ctx(s: *const lsquic_stream) -> *mut c_void;
    pub fn lsquic_stream_set_ctx(s: *mut lsquic_stream, ctx: *mut c_void);
    pub fn lsquic_stream_read(s: *mut lsquic_stream, buf: *mut c_void, len: usize) -> isize;
    pub fn lsquic_stream_write(s: *mut lsquic_stream, buf: *const c_void, len: usize) -> isize;
    pub fn lsquic_stream_flush(s: *mut lsquic_stream) -> c_int;
    pub fn lsquic_stream_shutdown(s: *mut lsquic_stream, how: c_int) -> c_int;
    pub fn lsquic_stream_close(s: *mut lsquic_stream) -> c_int;
    pub fn lsquic_stream_wantread(s: *mut lsquic_stream, is_want: c_int) -> c_int;
    pub fn lsquic_stream_wantwrite(s: *mut lsquic_stream, is_want: c_int) -> c_int;
    pub fn lsquic_stream_is_pushed(s: *const lsquic_stream) -> c_int;

    // ── shim ─────────────────────────────────────────────────────────────
    pub fn us_nq_enable_logging(level: *const c_char);
    pub fn us_nq_vtable_size() -> usize;
    pub fn us_nq_settings_size() -> usize;
    pub fn us_nq_settings_init(s: *mut lsquic_engine_settings, is_server: c_int, is_http: c_int);
    pub fn us_nq_engine_new(
        is_server: c_int,
        is_http: c_int,
        vt: *mut NqVtable,
        settings: *const lsquic_engine_settings,
        alpn: *const c_char,
    ) -> *mut lsquic_engine;
    pub fn us_nq_spec_dest(s: *const lsquic_out_spec) -> *const sockaddr;
    pub fn us_nq_spec_local(s: *const lsquic_out_spec) -> *const sockaddr;
    pub fn us_nq_spec_peer_ctx(s: *const lsquic_out_spec) -> *mut c_void;
    pub fn us_nq_spec_iov(s: *const lsquic_out_spec, n: *mut usize) -> *const iovec;
    pub fn us_nq_spec_stride() -> usize;
    pub fn us_nq_stream_reset(s: *mut lsquic_stream, code: u64);
    pub fn us_nq_hset_pairs(hset: *mut c_void, len: *mut usize) -> *const c_char;
    pub fn us_nq_hset_free(hset: *mut c_void);
    pub fn us_nq_stream_send_headers(
        s: *mut lsquic_stream,
        buf: *const c_char,
        len: usize,
        eos: c_int,
    ) -> c_int;
    pub fn lsquic_stream_get_hset(s: *mut lsquic_stream) -> *mut c_void;

    pub fn us_nq_settings_set_idle_timeout(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_idle_timeout_ms(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_delayed_acks(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_handshake_to(s: *mut lsquic_engine_settings, v: c_ulong);
    pub fn us_nq_settings_set_ping_period(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_ping_period_us(s: *mut lsquic_engine_settings, v: u64);
    pub fn lsquic_conn_pings_received(c: *const lsquic_conn) -> u64;
    pub fn us_nq_settings_set_init_max_data(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_init_max_stream_data_bidi_local(
        s: *mut lsquic_engine_settings,
        v: c_uint,
    );
    pub fn us_nq_settings_set_init_max_stream_data_bidi_remote(
        s: *mut lsquic_engine_settings,
        v: c_uint,
    );
    pub fn us_nq_settings_set_init_max_stream_data_uni(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_init_max_streams_bidi(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_init_max_streams_uni(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_max_udp_payload_size_rx(s: *mut lsquic_engine_settings, v: u16);
    pub fn us_nq_settings_set_datagrams(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_h3_datagram(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_send_prst(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_honor_prst(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_sreset_burst(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_sreset_rate(s: *mut lsquic_engine_settings, v: f64);
    pub fn us_nq_settings_set_h3_connect_protocol(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_preferred_address(s: *mut lsquic_engine_settings, addr: *const u8);
    pub fn lsquic_engine_sreset_stats(e: *const lsquic_engine, sent: *mut u64, limited: *mut u64);
    pub fn us_nq_settings_set_max_datagram_frame_size(s: *mut lsquic_engine_settings, v: u16);
    pub fn us_nq_settings_set_max_h3_header_pairs(s: *mut lsquic_engine_settings, v: u16);
    pub fn us_nq_settings_set_max_h3_header_bytes(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_allow_migration(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_origin_blob(
        s: *mut lsquic_engine_settings,
        blob: *const u8,
        len: usize,
    );
    pub fn us_nq_settings_set_scid_len(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_silent_close(s: *mut lsquic_engine_settings, v: c_int);
    pub fn us_nq_settings_set_cc_algo(s: *mut lsquic_engine_settings, v: c_uint);
    pub fn us_nq_settings_set_delay_onclose(s: *mut lsquic_engine_settings, v: c_int);
}

// ═══════════════════════════════════════════════════════════════════════════
// Safe wrappers
//
// Each newtype owns the raw pointer and the single `unsafe` per FFI call, so
// the runtime quic code works in safe Rust. The pattern follows
// `bun_uws::udp::Socket`: the raw pointer is the only field, methods take
// `&self` (lsquic is single-threaded — all calls happen on the JS thread),
// and lifetime is documented per type.
// ═══════════════════════════════════════════════════════════════════════════

/// Heap-backed `lsquic_engine_settings` initialized to defaults for the given
/// mode. Pass to [`Engine::new`]; lsquic copies the struct, so this can be
/// dropped immediately after.
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

/// Named setters for the fields node:quic touches. Each forwards to the
/// matching C shim setter; the macro avoids repeating the SAFETY block.
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
/// Read-back getters for the fields `localTransportParams` echoes.
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
    scid_len => us_nq_settings_set_scid_len : c_uint,
    silent_close => us_nq_settings_set_silent_close : c_int,
    cc_algo => us_nq_settings_set_cc_algo : c_uint,
    delay_onclose => us_nq_settings_set_delay_onclose : c_int,
}

/// A raw-QUIC `lsquic_engine_t`. Owns the engine; [`Drop`] destroys it.
pub struct Engine(*mut lsquic_engine);

impl Engine {
    /// Create a raw-QUIC or HTTP/3 engine. `vtable` and `alpn` must outlive
    /// the returned engine — lsquic stores both pointers.
    pub fn new(
        is_server: bool,
        is_http: bool,
        vtable: &NqVtable,
        settings: &Settings,
        alpn: Option<&[u8]>,
    ) -> Option<Self> {
        // SAFETY: settings is a live struct lsquic copies; alpn is
        // caller-guaranteed to outlive the engine.
        let raw = unsafe {
            us_nq_engine_new(
                is_server as c_int,
                is_http as c_int,
                core::ptr::from_ref(vtable).cast_mut(),
                settings.as_ptr(),
                alpn.map_or(core::ptr::null(), |a| a.as_ptr().cast()),
            )
        };
        (!raw.is_null()).then_some(Self(raw))
    }

    /// Feed one received UDP packet to the engine.
    ///
    /// # Safety
    /// `local`/`peer` must point to valid sockaddrs for the duration of the
    /// call, and `peer_ctx` must be the pointer the engine was configured with.
    pub unsafe fn packet_in(
        &self,
        data: &[u8],
        local: *const sockaddr,
        peer: *const sockaddr,
        peer_ctx: *mut c_void,
    ) -> c_int {
        // SAFETY: `self.0` is live; `data` is a slice; the sockaddrs are
        // caller-guaranteed valid for this call (lsquic copies them).
        unsafe {
            lsquic_engine_packet_in(self.0, data.as_ptr(), data.len(), local, peer, peer_ctx, 0)
        }
    }

    pub fn process_conns(&self) {
        // SAFETY: `self.0` is live.
        unsafe { lsquic_engine_process_conns(self.0) }
    }

    /// Microseconds until the next required `process_conns`, or `None` when
    /// idle.
    pub fn earliest_adv_tick(&self) -> Option<i32> {
        let mut diff: c_int = 0;
        // SAFETY: `self.0` is live; `diff` is a stack out-param.
        if unsafe { lsquic_engine_earliest_adv_tick(self.0, core::ptr::from_mut(&mut diff)) } != 0 {
            Some(diff)
        } else {
            None
        }
    }

    /// Initiate a client connection. Returns the conn-ctx that
    /// `vtable.on_new_conn` set (lsquic calls it inside this function).
    ///
    /// # Safety
    /// `local`/`peer` must point to valid sockaddrs for the duration of the
    /// call; `peer_ctx`/`conn_ctx` must stay valid for the connection's life.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn connect(
        &self,
        local: *const sockaddr,
        peer: *const sockaddr,
        peer_ctx: *mut c_void,
        conn_ctx: *mut c_void,
        sni: Option<&[u8]>,
        sess_resume: Option<&[u8]>,
        token: Option<&[u8]>,
    ) -> Option<Conn> {
        // SAFETY: `self.0` is live; the sockaddrs/peer_ctx/conn_ctx are
        // caller-guaranteed valid for this call. lsquic copies sni/sess/token.
        let raw = unsafe {
            lsquic_engine_connect(
                self.0,
                N_LSQVER,
                local,
                peer,
                peer_ctx,
                conn_ctx,
                sni.map_or(core::ptr::null(), |s| s.as_ptr().cast()),
                0,
                sess_resume.map_or(core::ptr::null(), |s| s.as_ptr()),
                sess_resume.map_or(0, |s| s.len()),
                token.map_or(core::ptr::null(), |t| t.as_ptr()),
                token.map_or(0, |t| t.len()),
            )
        };
        (!raw.is_null()).then_some(Conn(raw))
    }

    pub fn raw(&self) -> *mut lsquic_engine {
        self.0
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: `self.0` was returned by `us_nq_engine_new` and not freed.
        unsafe { lsquic_engine_destroy(self.0) }
    }
}

/// Borrowed `lsquic_conn_t`. lsquic owns the conn and frees it after
/// `on_conn_closed` returns; callers must not hold a `Conn` past that point.
#[derive(Copy, Clone)]
pub struct Conn(*mut lsquic_conn);

impl Conn {
    /// Wrap a raw conn for the duration of one callback.
    ///
    /// # Safety
    /// `raw` must be a live `lsquic_conn_t` for the lifetime of the returned
    /// value (i.e. until `on_conn_closed` returns for it).
    pub unsafe fn from_raw(raw: *mut lsquic_conn) -> Option<Self> {
        (!raw.is_null()).then_some(Self(raw))
    }
    pub fn raw(&self) -> *mut lsquic_conn {
        self.0
    }
    pub fn close(&self) {
        // SAFETY: `self.0` is live (caller contract).
        unsafe { lsquic_conn_close(self.0) }
    }
    /// HTTP mode: send GOAWAY and stop accepting new streams (no-op
    /// otherwise). The connection stays open for existing streams.
    pub fn going_away(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_going_away(self.0) }
    }
    pub fn abort(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_abort(self.0) }
    }
    /// Abort without sending CONNECTION_CLOSE: the peer discovers the death
    /// via stateless reset or its idle timeout.
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
    /// SETTINGS_H3_DATAGRAM state (RFC 9297): `None` while the peer's
    /// SETTINGS frame has not arrived, else whether it advertised support.
    /// `Some(false)` for non-HTTP/3 connections.
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
    /// # Safety
    /// `ctx` must outlive the connection (lsquic stores it verbatim).
    pub unsafe fn set_ctx(&self, ctx: *mut c_void) {
        // SAFETY: as above.
        unsafe { lsquic_conn_set_ctx(self.0, ctx) }
    }
    pub fn ctx(&self) -> *mut c_void {
        // SAFETY: as above.
        unsafe { lsquic_conn_get_ctx(self.0) }
    }
    pub fn make_stream(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_make_stream(self.0) }
    }
    pub fn make_uni_stream(&self) {
        // SAFETY: as above.
        unsafe { lsquic_conn_make_uni_stream(self.0) }
    }
    pub fn n_avail_streams(&self) -> u32 {
        // SAFETY: as above.
        unsafe { lsquic_conn_n_avail_streams(self.0) }
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
    /// PING frames received on this conn (session stats).
    pub fn pings_received(&self) -> u64 {
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_pings_received(self.0) }
    }
    /// Set this conn's keep-alive PING cadence (µs; 0 disables), overriding
    /// the engine-wide `ping_period_us` setting for this conn only.
    pub fn set_ping_period_us(&self, usec: u64) {
        unsafe extern "C" {
            fn lsquic_conn_set_ping_period_us(c: *mut lsquic_conn, usec: u64);
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_set_ping_period_us(self.0, usec) }
    }
    /// Force the pending delayed ACK to be scheduled on the next engine
    /// tick (used before a silent abort so the peer's last packets are
    /// acknowledged instead of retransmitted into a dead conn).
    pub fn ack_now(&self) {
        unsafe extern "C" {
            fn lsquic_conn_ack_now(c: *mut lsquic_conn);
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_ack_now(self.0) }
    }
    /// Opt this client conn in to migrating to the server's preferred
    /// address after the handshake (off by default).
    pub fn use_preferred_address(&self, on: bool) {
        unsafe extern "C" {
            fn lsquic_conn_use_preferred_address(c: *mut lsquic_conn, on: c_int);
        }
        // SAFETY: `self.0` is a live conn (constructor contract).
        unsafe { lsquic_conn_use_preferred_address(self.0, on as c_int) }
    }
    /// The DATAGRAM frame currently being delivered via `on_datagram`
    /// arrived in a 0-RTT packet. Valid only during that callback.
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
    /// The per-connection BoringSSL `SSL*` (IETF QUIC only).
    pub fn ssl(&self) -> *mut c_void {
        // SAFETY: as above.
        unsafe { lsquic_conn_get_ssl(self.0) }
    }
    pub fn sockaddr(&self) -> Option<(*const sockaddr, *const sockaddr)> {
        let mut local: *const sockaddr = core::ptr::null();
        let mut peer: *const sockaddr = core::ptr::null();
        // SAFETY: as above; out-params are stack slots.
        if unsafe {
            lsquic_conn_get_sockaddr(
                self.0,
                core::ptr::from_mut(&mut local),
                core::ptr::from_mut(&mut peer),
            )
        } == 0
        {
            Some((local, peer))
        } else {
            None
        }
    }
    pub fn status(&self, buf: &mut [c_char]) -> c_int {
        // SAFETY: as above; `buf` is a live slice.
        unsafe { lsquic_conn_status(self.0, buf.as_mut_ptr(), buf.len()) }
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
    /// `how`: 0=read, 1=write (sends FIN), 2=both.
    pub fn shutdown(&self, how: c_int) -> c_int {
        // SAFETY: as above.
        unsafe { lsquic_stream_shutdown(self.0, how) }
    }
    /// Force-finish both sides without sending RESET_STREAM or FIN — nothing
    /// goes on the wire, so the peer never learns the stream existed. Used to
    /// discard a just-created local stream whose JS wrapper was destroyed
    /// while still pending. (Exported by liblsquic but not in lsquic.h.)
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
    pub fn reset(&self, code: u64) {
        // SAFETY: as above.
        unsafe { us_nq_stream_reset(self.0, code) }
    }
    /// Received error code (from RESET_STREAM or STOP_SENDING).
    pub fn error_code(&self) -> u64 {
        unsafe extern "C" {
            fn lsquic_stream_get_error_code(s: *const lsquic_stream) -> u64;
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_get_error_code(self.0) }
    }
    /// HTTP/3 only: take ownership of the decoded header set (the
    /// `nq_hset` the shim's `ea_hsi_if` accumulated). Must be called
    /// before any `read()` on an HTTP stream — lsquic blocks body reads
    /// until the application claims it.
    pub fn take_header_set(&self) -> Option<HeaderSet> {
        // SAFETY: as above.
        let raw = unsafe { lsquic_stream_get_hset(self.0) };
        (!raw.is_null()).then_some(HeaderSet(raw))
    }
    /// HTTP/3 only: send a header block built from the JS layer's
    /// NUL-delimited `name\0value\0flags` triplets. Must precede any
    /// `write()`.
    pub fn send_headers(&self, nul_joined: &[u8], eos: bool) -> c_int {
        // SAFETY: as above; lsquic copies the buffer before returning.
        unsafe {
            us_nq_stream_send_headers(
                self.0,
                nul_joined.as_ptr().cast(),
                nul_joined.len(),
                eos as c_int,
            )
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
    /// A RESET_STREAM frame was received (any code, including 0).
    pub fn reset_received(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_reset_received(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_reset_received(self.0) != 0 }
    }
    /// The peer sent STOP_SENDING for this stream (`STREAM_SS_RECVD`).
    pub fn is_rejected(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_is_rejected(s: *const lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_is_rejected(self.0) != 0 }
    }
    /// Any data on this stream arrived in 0-RTT (early data) packets.
    pub fn received_early_data(&self) -> bool {
        unsafe extern "C" {
            fn lsquic_stream_received_early_data(s: *mut lsquic_stream) -> c_int;
        }
        // SAFETY: `self.0` is a live stream (constructor contract).
        unsafe { lsquic_stream_received_early_data(self.0) != 0 }
    }
    /// Queue STOP_SENDING(code) and shut the read side.
    pub fn stop_sending(&self, code: u64) {
        unsafe extern "C" {
            fn lsquic_stream_send_stop_sending(s: *mut lsquic_stream, code: u64);
        }
        // SAFETY: as above.
        unsafe { lsquic_stream_send_stop_sending(self.0, code) }
    }
}

/// Decoded HTTP/3 header block (the shim's `nq_hset`). Ownership is
/// transferred from lsquic via [`Stream::take_header_set`]; [`Drop`] frees
/// the C allocation.
pub struct HeaderSet(*mut c_void);

impl HeaderSet {
    /// Flat `[name, value, name, value, ...]`. Header octets are returned raw:
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
        // The shim writes `name\0value\0` pairs; strip the trailing NUL so
        // `split` doesn't yield an empty terminal element.
        let bytes = bytes.strip_suffix(&[0u8][..]).unwrap_or(bytes);
        bytes.split(|&b| b == 0).map(<[u8]>::to_vec).collect()
    }
}

impl Drop for HeaderSet {
    fn drop(&mut self) {
        // SAFETY: `self.0` was returned by `lsquic_stream_get_hset` and not
        // freed (lsquic transferred ownership).
        unsafe { us_nq_hset_free(self.0) }
    }
}

/// One-time global init (idempotent).
pub fn global_init() {
    // SAFETY: pure library init.
    unsafe { lsquic_global_init(LSQUIC_GLOBAL_CLIENT | LSQUIC_GLOBAL_SERVER) };
}

/// Route lsquic's own debug logging to stderr.
pub fn enable_logging(level: &core::ffi::CStr) {
    // SAFETY: `level` is a NUL-terminated string.
    unsafe { us_nq_enable_logging(level.as_ptr()) }
}

/// Mirrors `struct lsquic_conn_info` (lsquic.h).
#[repr(C)]
#[derive(Default)]
pub struct ConnInfo {
    pub cwnd: u32,
    pub pmtu: u32,
    pub rtt: u32,
    pub rttvar: u32,
    pub rtt_min: u32,
    pub bytes_rcvd: u64,
    pub bytes_sent: u64,
    pub pkts_rcvd: u64,
    pub pkts_sent: u64,
    pub pkts_lost: u64,
    pub pkts_retx: u64,
    pub bw_estimate: u64,
    pub max_pacing_rate: u64,
    pub pacing_rate: u64,
}

impl Conn {
    /// Snapshot of conn-level counters; None until lsquic has data.
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
        let nul = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        // The C side writes hex digits only, but validate anyway: a corrupt
        // FFI buffer must not become an invalid str.
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
    /// Peer transport params, or None before the handshake.
    pub fn peer_transport_params(&self) -> Option<NqTransportParams> {
        let mut out = NqTransportParams::default();
        // SAFETY: `self.0` is live; `out` is a stack out-param.
        if unsafe { us_nq_conn_transport_params(self.0, 1, core::ptr::from_mut(&mut out)) } == 1 {
            Some(out)
        } else {
            None
        }
    }
}

/// Debug-only check that the C and Rust definitions of `us_nq_vtable` agree.
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
