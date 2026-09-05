#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
//! lsquic + `node_quic_shim.c` (packages/bun-usockets) for `node:quic`.
//!
//! The shim calls one process-wide table of thunks ([`NqVtable`]); the thunks
//! recover the typed owner of each callback and hand it to the [`NqEndpoint`]
//! / [`NqSession`] / [`NqStream`] impls. lsquic's conn and stream contexts are
//! refs on those objects that this crate installs and releases, so every
//! pointer that comes back from C is one this crate put there.

use core::any::TypeId;
use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_ulong, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;
use std::sync::OnceLock;

use bun_boringssl_sys as boringssl;
use bun_core::strings;
use bun_ptr::{AnyRefCounted, RefPtr, ThisPtr};

bun_opaque::opaque_ffi! {
    /// `lsquic_engine_t`.
    pub struct lsquic_engine;
    /// `lsquic_conn_t`.
    pub struct lsquic_conn;
    /// `lsquic_stream_t`.
    pub struct lsquic_stream;
    /// `struct lsquic_engine_settings`.
    pub struct lsquic_engine_settings;
    /// `struct lsquic_out_spec`.
    pub struct lsquic_out_spec;
    /// `struct us_nq_driver_s` (node_quic_shim.c).
    pub struct us_nq_driver_s;
}

pub use boringssl::SSL_CTX;

#[repr(C)]
pub struct iovec {
    pub iov_base: *mut c_void,
    pub iov_len: usize,
}

pub const LSQ_HSK_OK: c_int = 1;
pub const LSQ_HSK_RESUMED_OK: c_int = 2;

pub const LSCONN_ST_HSK_FAILURE: c_int = 2;
pub const LSCONN_ST_TIMED_OUT: c_int = 4;
pub const LSCONN_ST_RESET: c_int = 5;
pub const LSCONN_ST_ERROR: c_int = 7;
pub const LSCONN_ST_VERNEG_FAILURE: c_int = 10;

pub const N_LSQVER: c_int = 8;

pub const LSQUIC_GLOBAL_CLIENT: c_int = 1;
pub const LSQUIC_GLOBAL_SERVER: c_int = 2;

/// `sizeof(struct sockaddr_in)` / `sizeof(struct sockaddr_in6)`.
pub const SOCKADDR_IN_LEN: usize = 16;
pub const SOCKADDR_IN6_LEN: usize = 28;

/// The bytes of a `struct sockaddr_in` or `sockaddr_in6`. lsquic keeps every
/// address it reports in a `sockaddr_in6`-sized buffer (`struct network_path`
/// in lsquic_conn.h), so a `const struct sockaddr *` from it is readable for
/// all 28 bytes whichever family it holds; callers building one for lsquic
/// fill the family's prefix and zero the rest.
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct SockAddr {
    pub bytes: [u8; SOCKADDR_IN6_LEN],
}

impl Default for SockAddr {
    fn default() -> Self {
        SockAddr {
            bytes: [0; SOCKADDR_IN6_LEN],
        }
    }
}

impl SockAddr {
    /// The leading `sockaddr_in6`-sized prefix of a `sockaddr_storage`.
    pub fn from_storage(storage: &bun_uws_sys::udp::sockaddr_storage) -> &SockAddr {
        const { assert!(core::mem::size_of::<bun_uws_sys::udp::sockaddr_storage>() >= SOCKADDR_IN6_LEN) };
        // SAFETY: `sockaddr_storage` is at least 28 initialized bytes (a
        // family field followed by byte padding, no interior padding) and
        // `SockAddr` is an align-1 view of the first 28.
        unsafe { &*core::ptr::from_ref(storage).cast::<SockAddr>() }
    }

    fn opt<'a>(p: *const c_void) -> Option<&'a SockAddr> {
        // SAFETY: lsquic's sockaddr pointers are null or address a
        // `sockaddr_in6`-sized buffer live for the callback (type doc).
        unsafe { p.cast::<SockAddr>().as_ref() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Raw FFI surface
// ──────────────────────────────────────────────────────────────────────────

unsafe extern "C" {
    safe fn lsquic_global_init(flags: c_int) -> c_int;
    fn lsquic_engine_destroy(engine: *mut lsquic_engine);
    safe fn lsquic_engine_conn_count(engine: &lsquic_engine) -> c_uint;
    fn lsquic_engine_cid_in_use(
        engine: *mut lsquic_engine,
        cid: *const u8,
        cid_len: usize,
    ) -> c_int;
    fn lsquic_engine_packet_in(
        engine: *mut lsquic_engine,
        data: *const u8,
        size: usize,
        sa_local: *const c_void,
        sa_peer: *const c_void,
        peer_ctx: *mut c_void,
        ecn: c_int,
    ) -> c_int;
    safe fn lsquic_engine_process_conns(engine: &lsquic_engine);
    safe fn lsquic_engine_set_idle_timeout_ms(engine: &lsquic_engine, ms: c_uint);
    safe fn lsquic_engine_earliest_adv_tick(engine: &lsquic_engine, diff: &mut c_int) -> c_int;
    safe fn lsquic_engine_has_unsent_packets(engine: &lsquic_engine) -> c_int;
    safe fn lsquic_engine_send_unsent_packets(engine: &lsquic_engine);
    safe fn lsquic_engine_sreset_stats(e: &lsquic_engine, sent: &mut u64, limited: &mut u64);
    fn lsquic_engine_connect(
        engine: *mut lsquic_engine,
        version: c_int,
        local_sa: *const c_void,
        peer_sa: *const c_void,
        peer_ctx: *mut c_void,
        conn_ctx: *mut c_void,
        hostname: *const c_char,
        base_plpmtu: u16,
        sess_resume: *const u8,
        sess_resume_len: usize,
        token: *const u8,
        token_sz: usize,
    ) -> *mut lsquic_conn;

    safe fn lsquic_conn_get_ctx(c: &lsquic_conn) -> *mut c_void;
    safe fn lsquic_conn_get_peer_ctx(c: &lsquic_conn, local_sa: *const c_void) -> *mut c_void;
    safe fn lsquic_conn_set_ctx(c: &lsquic_conn, ctx: *mut c_void);
    safe fn lsquic_conn_close(c: &lsquic_conn);
    safe fn lsquic_conn_going_away(c: &lsquic_conn);
    safe fn lsquic_conn_abort(c: &lsquic_conn);
    safe fn lsquic_conn_abort_silent(c: &lsquic_conn);
    fn lsquic_conn_abort_error(
        c: *mut lsquic_conn,
        is_app: c_int,
        code: c_uint,
        reason: *const c_char,
    );
    fn lsquic_conn_status(c: *mut lsquic_conn, errbuf: *mut c_char, bufsz: usize) -> c_int;
    safe fn lsquic_conn_make_stream(c: &lsquic_conn);
    safe fn lsquic_conn_make_uni_stream(c: &lsquic_conn);
    safe fn lsquic_conn_get_sockaddr(
        c: &lsquic_conn,
        local: &mut *const c_void,
        peer: &mut *const c_void,
    ) -> c_int;
    safe fn lsquic_conn_get_sni(c: &lsquic_conn) -> *const c_char;
    safe fn lsquic_conn_want_datagram_write(c: &lsquic_conn, is_want: c_int) -> c_int;
    safe fn lsquic_conn_crypto_cipher(c: &lsquic_conn) -> *const c_char;
    safe fn lsquic_conn_get_server_cert_chain(
        c: &lsquic_conn,
    ) -> *mut boringssl::struct_stack_st_X509;
    safe fn lsquic_conn_get_ssl(c: &lsquic_conn) -> *mut boringssl::SSL;
    safe fn lsquic_ssl_to_conn(ssl: &boringssl::SSL) -> *mut lsquic_conn;
    safe fn lsquic_conn_get_info(c: &lsquic_conn, info: &mut ConnInfo) -> c_int;
    safe fn lsquic_conn_pings_received(c: &lsquic_conn) -> u64;
    safe fn lsquic_conn_set_ping_period_us(c: &lsquic_conn, usec: u64);
    safe fn lsquic_conn_ack_now(c: &lsquic_conn);
    safe fn lsquic_conn_use_preferred_address(c: &lsquic_conn, on: c_int);
    safe fn lsquic_conn_datagram_early(c: &lsquic_conn) -> c_int;
    safe fn lsquic_conn_peer_h3_datagram(c: &lsquic_conn) -> c_int;
    safe fn us_nq_conn_transport_params(
        c: &lsquic_conn,
        peer: c_int,
        out: &mut NqTransportParams,
    ) -> c_int;
    safe fn us_nq_tp_size() -> usize;
    safe fn us_nq_conn_info_size() -> usize;

    safe fn lsquic_stream_id(s: &lsquic_stream) -> u64;
    safe fn lsquic_stream_conn(s: &lsquic_stream) -> *mut lsquic_conn;
    safe fn lsquic_stream_get_ctx(s: &lsquic_stream) -> *mut c_void;
    safe fn lsquic_stream_set_ctx(s: &lsquic_stream, ctx: *mut c_void);
    fn lsquic_stream_read(s: *mut lsquic_stream, buf: *mut c_void, len: usize) -> isize;
    fn lsquic_stream_write(s: *mut lsquic_stream, buf: *const c_void, len: usize) -> isize;
    safe fn lsquic_stream_flush(s: &lsquic_stream) -> c_int;
    safe fn lsquic_stream_shutdown(s: &lsquic_stream, how: c_int) -> c_int;
    safe fn lsquic_stream_shutdown_internal(s: &lsquic_stream);
    safe fn lsquic_stream_close(s: &lsquic_stream) -> c_int;
    safe fn lsquic_stream_wantread(s: &lsquic_stream, is_want: c_int) -> c_int;
    safe fn lsquic_stream_wantwrite(s: &lsquic_stream, is_want: c_int) -> c_int;
    safe fn lsquic_stream_get_error_code(s: &lsquic_stream) -> u64;
    safe fn lsquic_stream_get_hset(s: &lsquic_stream) -> *mut c_void;
    safe fn lsquic_stream_has_unacked_data(s: &lsquic_stream) -> c_int;
    safe fn lsquic_stream_reset_received(s: &lsquic_stream) -> c_int;
    safe fn lsquic_stream_is_rejected(s: &lsquic_stream) -> c_int;
    safe fn lsquic_stream_received_early_data(s: &lsquic_stream) -> c_int;
    safe fn lsquic_stream_send_stop_sending(s: &lsquic_stream, code: u64);
    safe fn lsquic_stream_set_http_prio(s: &lsquic_stream, p: &ExtHttpPrio) -> c_int;
    safe fn lsquic_stream_get_http_prio(s: &lsquic_stream, p: &mut ExtHttpPrio) -> c_int;

    fn us_nq_enable_logging(level: *const c_char);
    safe fn us_nq_vtable_size() -> usize;
    safe fn us_nq_driver_size() -> usize;
    safe fn us_nq_settings_size() -> usize;
    fn us_nq_settings_init(s: *mut lsquic_engine_settings, is_server: c_int, is_http: c_int);
    fn us_nq_engine_new(
        is_server: c_int,
        is_http: c_int,
        vt: *const RawVtable,
        owner: *mut c_void,
        settings: *const lsquic_engine_settings,
        alpn: *const c_char,
    ) -> *mut lsquic_engine;
    safe fn us_nq_spec_dest(s: &lsquic_out_spec) -> *const c_void;
    safe fn us_nq_spec_local(s: &lsquic_out_spec) -> *const c_void;
    safe fn us_nq_spec_iov(s: &lsquic_out_spec, n: &mut usize) -> *const iovec;
    safe fn us_nq_spec_stride() -> usize;
    /// `lsquic_stream_force_reset_ext`: RFC 9000 §3.1 allows RST in Data Sent.
    safe fn us_nq_stream_reset(s: &lsquic_stream, code: u64);
    fn us_nq_hset_pairs(hset: *mut c_void, len: *mut usize) -> *const c_char;
    fn us_nq_hset_free(hset: *mut c_void);
    fn us_nq_stream_send_headers(
        s: *mut lsquic_stream,
        buf: *const c_char,
        len: usize,
        expected: c_int,
        eos: c_int,
    ) -> c_int;

    fn us_nq_loop_register(
        loop_: *mut bun_uws_sys::Loop,
        d: *mut us_nq_driver_s,
        owner: *mut c_void,
        process: unsafe extern "C" fn(*mut c_void),
        drain: unsafe extern "C" fn(*mut c_void),
    );
    fn us_nq_loop_unregister(loop_: *mut bun_uws_sys::Loop, d: *mut us_nq_driver_s);

    fn us_nq_settings_set_idle_timeout(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_idle_timeout_ms(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_delayed_acks(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_handshake_to(s: *mut lsquic_engine_settings, v: c_ulong);
    fn us_nq_settings_set_ping_period(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_ping_period_us(s: *mut lsquic_engine_settings, v: u64);
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
    fn us_nq_settings_set_preferred_address(s: *mut lsquic_engine_settings, addr: *const u8);
    fn us_nq_settings_set_max_datagram_frame_size(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_max_h3_header_pairs(s: *mut lsquic_engine_settings, v: u16);
    fn us_nq_settings_set_max_h3_header_bytes(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_allow_migration(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_origin_blob(s: *mut lsquic_engine_settings, blob: *const u8, len: usize);
    fn us_nq_settings_set_scid_len(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_silent_close(s: *mut lsquic_engine_settings, v: c_int);
    fn us_nq_settings_set_cc_algo(s: *mut lsquic_engine_settings, v: c_uint);
    fn us_nq_settings_set_delay_onclose(s: *mut lsquic_engine_settings, v: c_int);
}

pub fn global_init() {
    lsquic_global_init(LSQUIC_GLOBAL_CLIENT | LSQUIC_GLOBAL_SERVER);
}

pub fn enable_logging(level: &CStr) {
    // SAFETY: `level` is NUL-terminated; lsquic copies what it needs.
    unsafe { us_nq_enable_logging(level.as_ptr()) }
}

// ──────────────────────────────────────────────────────────────────────────
// Engine settings
// ──────────────────────────────────────────────────────────────────────────

pub struct Settings {
    /// `struct lsquic_engine_settings` storage (u64 for its alignment).
    bytes: Vec<u64>,
    /// `es_origin_blob` is borrowed by the engine for its lifetime.
    origin_blob: Option<Box<[u8]>>,
}

impl Settings {
    /// RFC 9000 preferred_address transport parameter: 4-byte IPv4 + 2-byte
    /// port + 16-byte IPv6 + 2-byte port (network order), zeros = absent.
    pub fn preferred_address(&mut self, addr: &[u8; 24]) {
        // SAFETY: `self.bytes` is the live settings blob; the shim copies.
        unsafe { us_nq_settings_set_preferred_address(self.raw(), addr.as_ptr()) }
    }

    /// Pre-encoded HTTP/3 ORIGIN frame payload (RFC 9412) the server sends
    /// after SETTINGS. The copy is kept alive by the [`Engine`] built from
    /// these settings.
    pub fn origin_blob(&mut self, blob: &[u8]) {
        let blob: Box<[u8]> = blob.into();
        // SAFETY: `self.bytes` is the live settings blob; `blob` is moved into
        // `self` and then into the engine, outliving lsquic's borrow of it.
        unsafe { us_nq_settings_set_origin_blob(self.raw(), blob.as_ptr(), blob.len()) };
        self.origin_blob = Some(blob);
    }

    pub fn new(is_server: bool, is_http: bool) -> Self {
        let mut bytes = vec![0u64; us_nq_settings_size().div_ceil(8)];
        // SAFETY: `bytes` is a fresh zeroed allocation of the right size.
        unsafe {
            us_nq_settings_init(
                bytes.as_mut_ptr().cast(),
                is_server as c_int,
                is_http as c_int,
            )
        };
        Self {
            bytes,
            origin_blob: None,
        }
    }
    fn raw(&mut self) -> *mut lsquic_engine_settings {
        self.bytes.as_mut_ptr().cast()
    }
    fn as_ptr(&self) -> *const lsquic_engine_settings {
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
    scid_len => us_nq_settings_set_scid_len : c_uint,
    silent_close => us_nq_settings_set_silent_close : c_int,
    cc_algo => us_nq_settings_set_cc_algo : c_uint,
    delay_onclose => us_nq_settings_set_delay_onclose : c_int,
}

// ──────────────────────────────────────────────────────────────────────────
// Typed callback owners
// ──────────────────────────────────────────────────────────────────────────

/// The endpoint that owns an [`Engine`]. Engine-level callbacks fire from
/// inside that engine's methods (or its destruction), so `this` is live.
pub trait NqEndpoint: AnyRefCounted + 'static {
    type Session: NqSession;

    /// A new server connection. The returned ref becomes lsquic's conn
    /// context and is released after [`NqSession::on_conn_closed`] (or by
    /// [`Conn::take_ctx`]); `None` leaves the conn without one.
    fn on_new_conn(this: ThisPtr<Self>, conn: Conn) -> Option<RefPtr<Self::Session>>;
    /// `lsquic_packets_out_f`: returns how many of `specs` were sent.
    fn packets_out(this: ThisPtr<Self>, specs: OutSpecs<'_>) -> c_int;
    fn ssl_ctx(&self) -> *mut SSL_CTX;
    fn client_ssl_ctx(&self) -> *mut SSL_CTX;
    fn lookup_cert(&self, sni: Option<&CStr>) -> *mut SSL_CTX;
    fn on_mini_conn_failed(&self, peer: &SockAddr, error_code: u64);
}

/// The object an lsquic conn context refers to.
pub trait NqSession: AnyRefCounted + 'static {
    type Stream: NqStream;

    fn on_hsk_done(&self, status: c_int);
    fn on_hsk_confirmed(&self);
    fn on_goaway_received(&self);
    /// The conn (and its streams) are freed right after this returns; the
    /// context's ref is released then too.
    fn on_conn_closed(&self);
    fn on_conncloseframe(&self, app_error: bool, code: u64, reason: &[u8]);
    fn on_new_token(&self, token: &[u8]);
    fn on_sess_resume(&self, blob: &[u8]);
    /// A new stream on this session's conn. The returned ref becomes
    /// lsquic's stream context and is released after
    /// [`NqStream::on_close`] (or by [`Stream::take_ctx`]).
    fn on_new_stream(this: ThisPtr<Self>, stream: Stream) -> Option<RefPtr<Self::Stream>>;
    /// The next DATAGRAM payload of at most `capacity` bytes, if one is ready.
    fn on_dg_write(&self, capacity: usize) -> Option<Vec<u8>>;
    fn on_datagram(&self, payload: &[u8]);
    fn on_datagram_status(&self, count: c_uint, acked: bool);
    fn on_early_data_failed(&self);
    fn on_path_switch(
        &self,
        validated: bool,
        preferred: bool,
        new_local: Option<&SockAddr>,
        new_peer: Option<&SockAddr>,
        old_local: Option<&SockAddr>,
        old_peer: Option<&SockAddr>,
    );
    /// One chunk of an HTTP/3 ORIGIN frame; `fin` marks the last.
    fn on_origin(&self, chunk: &[u8], fin: bool);
}

/// The object an lsquic stream context refers to.
pub trait NqStream: AnyRefCounted + 'static {
    fn on_read(&self, stream: Stream);
    fn on_write(&self, stream: Stream);
    /// The stream is freed right after this returns; the context's ref is
    /// released then too.
    fn on_close(&self, stream: Stream);
    /// `how`: 0 = read side reset, 1 = STOP_SENDING, 2 = both.
    fn on_reset(&self, how: c_int, code: u64);
}

/// Mirrors `struct us_nq_vtable` in node_quic_shim.c.
#[repr(C)]
struct RawVtable {
    on_new_conn: unsafe extern "C" fn(owner: *mut c_void, c: *mut lsquic_conn) -> *mut c_void,
    on_hsk_done: unsafe extern "C" fn(conn_ctx: *mut c_void, status: c_int),
    on_hsk_confirmed: unsafe extern "C" fn(conn_ctx: *mut c_void),
    on_goaway_received: unsafe extern "C" fn(conn_ctx: *mut c_void),
    on_conn_closed: unsafe extern "C" fn(conn_ctx: *mut c_void),
    on_conncloseframe: unsafe extern "C" fn(
        conn_ctx: *mut c_void,
        app_error: c_int,
        code: u64,
        reason: *const c_char,
        reason_len: c_int,
    ),
    on_new_token: unsafe extern "C" fn(conn_ctx: *mut c_void, token: *const u8, token_size: usize),
    on_sess_resume: unsafe extern "C" fn(conn_ctx: *mut c_void, blob: *const u8, blob_size: usize),
    on_new_stream: unsafe extern "C" fn(s: *mut lsquic_stream) -> *mut c_void,
    on_stream_read: unsafe extern "C" fn(stream_ctx: *mut c_void, s: *mut lsquic_stream),
    on_stream_write: unsafe extern "C" fn(stream_ctx: *mut c_void, s: *mut lsquic_stream),
    on_stream_close: unsafe extern "C" fn(stream_ctx: *mut c_void, s: *mut lsquic_stream),
    on_stream_reset: unsafe extern "C" fn(stream_ctx: *mut c_void, how: c_int, error_code: u64),
    on_dg_write: unsafe extern "C" fn(conn_ctx: *mut c_void, buf: *mut c_void, sz: usize) -> isize,
    on_datagram: unsafe extern "C" fn(conn_ctx: *mut c_void, buf: *const c_void, sz: usize),
    on_datagram_status: unsafe extern "C" fn(conn_ctx: *mut c_void, count: c_uint, acked: c_int),
    on_early_data_failed: unsafe extern "C" fn(conn_ctx: *mut c_void),
    on_path_switch: unsafe extern "C" fn(
        conn_ctx: *mut c_void,
        validated: c_int,
        is_preferred: c_int,
        new_local: *const c_void,
        new_peer: *const c_void,
        old_local: *const c_void,
        old_peer: *const c_void,
    ),
    on_origin:
        unsafe extern "C" fn(conn_ctx: *mut c_void, chunk: *const u8, len: usize, fin: c_int),
    get_ssl_ctx: unsafe extern "C" fn(owner: *mut c_void, local: *const c_void) -> *mut SSL_CTX,
    get_client_ssl_ctx:
        unsafe extern "C" fn(owner: *mut c_void, local: *const c_void) -> *mut SSL_CTX,
    lookup_cert: unsafe extern "C" fn(
        owner: *mut c_void,
        local: *const c_void,
        sni: *const c_char,
    ) -> *mut SSL_CTX,
    packets_out:
        unsafe extern "C" fn(owner: *mut c_void, specs: *const lsquic_out_spec, n: c_uint) -> c_int,
    on_mini_conn_failed:
        unsafe extern "C" fn(owner: *mut c_void, peer_sa: *const c_void, error_code: u64),
}

/// The shim's callback table for endpoint type `E`. Declare one `static` per
/// program with [`NqVtable::new`]; every [`Engine`] takes it.
#[repr(C)]
pub struct NqVtable<E: NqEndpoint> {
    raw: RawVtable,
    _owner: PhantomData<fn() -> E>,
}

/// The `(endpoint, session, stream)` types the installed table dispatches
/// to; set by the first [`Engine::new`]. A conn or stream context is only
/// ever a ref on the recorded session/stream type.
static INSTALLED: OnceLock<[TypeId; 3]> = OnceLock::new();

fn installed_session_is<S: 'static>() -> bool {
    INSTALLED
        .get()
        .is_some_and(|ids| ids[1] == TypeId::of::<S>())
}
fn installed_stream_is<St: 'static>() -> bool {
    INSTALLED
        .get()
        .is_some_and(|ids| ids[2] == TypeId::of::<St>())
}

mod thunk {
    use super::*;

    type S<E> = <E as NqEndpoint>::Session;
    type St<E> = <S<E> as NqSession>::Stream;

    /// A callback's receiver, with a ref held for the callback's duration so
    /// an impl that releases the context's ref mid-callback stays live.
    pub(super) struct Held<T: AnyRefCounted> {
        _ref: RefPtr<T>,
        ptr: ThisPtr<T>,
    }
    impl<T: AnyRefCounted> core::ops::Deref for Held<T> {
        type Target = T;
        fn deref(&self) -> &T {
            self.ptr.get()
        }
    }
    impl<T: AnyRefCounted> Held<T> {
        /// # Safety
        /// `ctx` is a live, intrusively-refcounted `T`.
        unsafe fn new(ctx: *mut c_void) -> Self {
            // SAFETY: caller contract.
            unsafe {
                Held {
                    _ref: RefPtr::init_ref(ctx.cast::<T>()),
                    ptr: ThisPtr::new(ctx.cast::<T>()),
                }
            }
        }
        pub(super) fn this_ptr(&self) -> ThisPtr<T> {
            self.ptr
        }
    }
    /// # Safety
    /// `ctx` is a non-null conn context, i.e. the `RefPtr<S<E>>` this crate
    /// leaked into it.
    unsafe fn session<E: NqEndpoint>(ctx: *mut c_void) -> Held<S<E>> {
        // SAFETY: caller contract; the context's ref keeps it live.
        unsafe { Held::new(ctx) }
    }
    /// # Safety
    /// `ctx` is a non-null stream context, i.e. the `RefPtr<St<E>>` this
    /// crate leaked into it.
    unsafe fn stream<E: NqEndpoint>(ctx: *mut c_void) -> Held<St<E>> {
        // SAFETY: caller contract; the context's ref keeps it live.
        unsafe { Held::new(ctx) }
    }
    /// # Safety
    /// `owner` is the engine owner `Engine::<E>::new` registered.
    unsafe fn endpoint<E: NqEndpoint>(owner: *mut c_void) -> ThisPtr<E> {
        // SAFETY: caller contract; the engine holds a ref on its owner and
        // only calls back from inside its own methods.
        unsafe { ThisPtr::new(owner.cast::<E>()) }
    }
    /// # Safety
    /// `p[..n]` is readable for the call when `p` is non-null.
    unsafe fn bytes<'a>(p: *const u8, n: usize) -> &'a [u8] {
        if p.is_null() || n == 0 {
            return &[];
        }
        // SAFETY: caller contract.
        unsafe { core::slice::from_raw_parts(p, n) }
    }

    pub(super) unsafe extern "C" fn on_new_conn<E: NqEndpoint>(
        owner: *mut c_void,
        c: *mut lsquic_conn,
    ) -> *mut c_void {
        let Some(conn) = Conn::from_raw(c) else {
            return core::ptr::null_mut();
        };
        // SAFETY: shim contract — `owner` is the `ea_stream_if_ctx` we set.
        match E::on_new_conn(unsafe { endpoint::<E>(owner) }, conn) {
            Some(session) => RefPtr::into_raw(session).cast(),
            None => core::ptr::null_mut(),
        }
    }
    pub(super) unsafe extern "C" fn on_hsk_done<E: NqEndpoint>(ctx: *mut c_void, status: c_int) {
        // SAFETY: shim contract — non-null conn ctx.
        unsafe { session::<E>(ctx) }.on_hsk_done(status);
    }
    pub(super) unsafe extern "C" fn on_hsk_confirmed<E: NqEndpoint>(ctx: *mut c_void) {
        // SAFETY: as above.
        unsafe { session::<E>(ctx) }.on_hsk_confirmed();
    }
    pub(super) unsafe extern "C" fn on_goaway_received<E: NqEndpoint>(ctx: *mut c_void) {
        // SAFETY: as above.
        unsafe { session::<E>(ctx) }.on_goaway_received();
    }
    pub(super) unsafe extern "C" fn on_conn_closed<E: NqEndpoint>(ctx: *mut c_void) {
        // SAFETY: as above; the shim already cleared the conn's context, so
        // this is the last use of the ref it held.
        unsafe {
            session::<E>(ctx).on_conn_closed();
            drop(RefPtr::<S<E>>::from_raw(ctx.cast()));
        }
    }
    pub(super) unsafe extern "C" fn on_conncloseframe<E: NqEndpoint>(
        ctx: *mut c_void,
        app_error: c_int,
        code: u64,
        reason: *const c_char,
        reason_len: c_int,
    ) {
        // SAFETY: as above; `reason[..reason_len]` is valid for the call.
        unsafe {
            let reason = bytes(reason.cast(), usize::try_from(reason_len).unwrap_or(0));
            session::<E>(ctx).on_conncloseframe(app_error != 0, code, reason);
        }
    }
    pub(super) unsafe extern "C" fn on_new_token<E: NqEndpoint>(
        ctx: *mut c_void,
        t: *const u8,
        n: usize,
    ) {
        // SAFETY: as above; `t[..n]` is valid for the call.
        unsafe { session::<E>(ctx).on_new_token(bytes(t, n)) };
    }
    pub(super) unsafe extern "C" fn on_sess_resume<E: NqEndpoint>(
        ctx: *mut c_void,
        b: *const u8,
        n: usize,
    ) {
        // SAFETY: as above; `b[..n]` is valid for the call.
        unsafe { session::<E>(ctx).on_sess_resume(bytes(b, n)) };
    }
    pub(super) unsafe extern "C" fn on_new_stream<E: NqEndpoint>(
        s: *mut lsquic_stream,
    ) -> *mut c_void {
        let Some(stream) = Stream::from_raw(s) else {
            return core::ptr::null_mut();
        };
        let Some(conn) = stream.conn() else {
            return core::ptr::null_mut();
        };
        let ctx = lsquic_conn_get_ctx(conn.get());
        if ctx.is_null() {
            return core::ptr::null_mut();
        }
        // SAFETY: non-null conn ctx (the ref this crate leaked into it).
        let session = unsafe { session::<E>(ctx) };
        match S::<E>::on_new_stream(session.this_ptr(), stream) {
            Some(owner) => RefPtr::into_raw(owner).cast(),
            None => core::ptr::null_mut(),
        }
    }
    pub(super) unsafe extern "C" fn on_stream_read<E: NqEndpoint>(
        ctx: *mut c_void,
        s: *mut lsquic_stream,
    ) {
        if let Some(s) = Stream::from_raw(s) {
            // SAFETY: shim contract — non-null stream ctx.
            unsafe { stream::<E>(ctx) }.on_read(s);
        }
    }
    pub(super) unsafe extern "C" fn on_stream_write<E: NqEndpoint>(
        ctx: *mut c_void,
        s: *mut lsquic_stream,
    ) {
        if let Some(s) = Stream::from_raw(s) {
            // SAFETY: as above.
            unsafe { stream::<E>(ctx) }.on_write(s);
        }
    }
    pub(super) unsafe extern "C" fn on_stream_close<E: NqEndpoint>(
        ctx: *mut c_void,
        s: *mut lsquic_stream,
    ) {
        // SAFETY: as above; lsquic frees the stream after this, so this is
        // the last use of the ref its context held. The context is cleared
        // first so the callback cannot take it a second time.
        unsafe {
            if let Some(s) = Stream::from_raw(s) {
                lsquic_stream_set_ctx(s.get(), core::ptr::null_mut());
                stream::<E>(ctx).on_close(s);
            }
            drop(RefPtr::<St<E>>::from_raw(ctx.cast()));
        }
    }
    pub(super) unsafe extern "C" fn on_stream_reset<E: NqEndpoint>(
        ctx: *mut c_void,
        how: c_int,
        code: u64,
    ) {
        // SAFETY: as above.
        unsafe { stream::<E>(ctx) }.on_reset(how, code);
    }
    pub(super) unsafe extern "C" fn on_dg_write<E: NqEndpoint>(
        ctx: *mut c_void,
        buf: *mut c_void,
        sz: usize,
    ) -> isize {
        if buf.is_null() {
            return -1;
        }
        // SAFETY: shim contract — non-null conn ctx.
        let Some(payload) = unsafe { session::<E>(ctx) }.on_dg_write(sz) else {
            return -1;
        };
        if payload.len() > sz {
            debug_assert!(false, "on_dg_write returned more than `capacity` bytes");
            return -1;
        }
        let n = payload.len();
        // SAFETY: `buf[..sz]` is writable for the call and `n <= sz`.
        unsafe { core::ptr::copy_nonoverlapping(payload.as_ptr(), buf.cast::<u8>(), n) };
        n as isize
    }
    pub(super) unsafe extern "C" fn on_datagram<E: NqEndpoint>(
        ctx: *mut c_void,
        buf: *const c_void,
        sz: usize,
    ) {
        if buf.is_null() {
            return;
        }
        // SAFETY: as above; `buf[..sz]` is valid for the call.
        unsafe { session::<E>(ctx).on_datagram(bytes(buf.cast(), sz)) };
    }
    pub(super) unsafe extern "C" fn on_datagram_status<E: NqEndpoint>(
        ctx: *mut c_void,
        count: c_uint,
        acked: c_int,
    ) {
        // SAFETY: as above.
        unsafe { session::<E>(ctx) }.on_datagram_status(count, acked != 0);
    }
    pub(super) unsafe extern "C" fn on_early_data_failed<E: NqEndpoint>(ctx: *mut c_void) {
        // SAFETY: as above.
        unsafe { session::<E>(ctx) }.on_early_data_failed();
    }
    pub(super) unsafe extern "C" fn on_path_switch<E: NqEndpoint>(
        ctx: *mut c_void,
        validated: c_int,
        is_preferred: c_int,
        new_local: *const c_void,
        new_peer: *const c_void,
        old_local: *const c_void,
        old_peer: *const c_void,
    ) {
        // SAFETY: as above.
        unsafe { session::<E>(ctx) }.on_path_switch(
            validated != 0,
            is_preferred != 0,
            SockAddr::opt(new_local),
            SockAddr::opt(new_peer),
            SockAddr::opt(old_local),
            SockAddr::opt(old_peer),
        );
    }
    pub(super) unsafe extern "C" fn on_origin<E: NqEndpoint>(
        ctx: *mut c_void,
        chunk: *const u8,
        len: usize,
        fin: c_int,
    ) {
        // SAFETY: as above; `chunk[..len]` is valid for the call.
        unsafe { session::<E>(ctx).on_origin(bytes(chunk, len), fin != 0) };
    }
    pub(super) unsafe extern "C" fn get_ssl_ctx<E: NqEndpoint>(
        owner: *mut c_void,
        _local: *const c_void,
    ) -> *mut SSL_CTX {
        // SAFETY: shim contract — `owner` is the `peer_ctx` `Engine<E>`
        // feeds, which is always its owner.
        unsafe { endpoint::<E>(owner) }.ssl_ctx()
    }
    pub(super) unsafe extern "C" fn get_client_ssl_ctx<E: NqEndpoint>(
        owner: *mut c_void,
        _local: *const c_void,
    ) -> *mut SSL_CTX {
        // SAFETY: as above.
        unsafe { endpoint::<E>(owner) }.client_ssl_ctx()
    }
    pub(super) unsafe extern "C" fn lookup_cert<E: NqEndpoint>(
        owner: *mut c_void,
        _local: *const c_void,
        sni: *const c_char,
    ) -> *mut SSL_CTX {
        // SAFETY: shim contract — `owner` is `ea_cert_lu_ctx`; `sni` is null
        // or NUL-terminated for the call.
        unsafe {
            let sni = (!sni.is_null()).then(|| CStr::from_ptr(sni));
            endpoint::<E>(owner).lookup_cert(sni)
        }
    }
    pub(super) unsafe extern "C" fn packets_out<E: NqEndpoint>(
        owner: *mut c_void,
        specs: *const lsquic_out_spec,
        n: c_uint,
    ) -> c_int {
        let specs = OutSpecs {
            ptr: specs,
            n: n as usize,
            _call: PhantomData,
        };
        // SAFETY: shim contract — `owner` is `ea_packets_out_ctx`.
        E::packets_out(unsafe { endpoint::<E>(owner) }, specs)
    }
    pub(super) unsafe extern "C" fn on_mini_conn_failed<E: NqEndpoint>(
        owner: *mut c_void,
        peer_sa: *const c_void,
        error_code: u64,
    ) {
        let Some(peer) = SockAddr::opt(peer_sa) else {
            return;
        };
        // SAFETY: shim contract — `owner` is `ea_stream_if_ctx`.
        unsafe { endpoint::<E>(owner) }.on_mini_conn_failed(peer, error_code);
    }
}

impl<E: NqEndpoint> NqVtable<E> {
    pub const fn new() -> Self {
        NqVtable {
            raw: RawVtable {
                on_new_conn: thunk::on_new_conn::<E>,
                on_hsk_done: thunk::on_hsk_done::<E>,
                on_hsk_confirmed: thunk::on_hsk_confirmed::<E>,
                on_goaway_received: thunk::on_goaway_received::<E>,
                on_conn_closed: thunk::on_conn_closed::<E>,
                on_conncloseframe: thunk::on_conncloseframe::<E>,
                on_new_token: thunk::on_new_token::<E>,
                on_sess_resume: thunk::on_sess_resume::<E>,
                on_new_stream: thunk::on_new_stream::<E>,
                on_stream_read: thunk::on_stream_read::<E>,
                on_stream_write: thunk::on_stream_write::<E>,
                on_stream_close: thunk::on_stream_close::<E>,
                on_stream_reset: thunk::on_stream_reset::<E>,
                on_dg_write: thunk::on_dg_write::<E>,
                on_datagram: thunk::on_datagram::<E>,
                on_datagram_status: thunk::on_datagram_status::<E>,
                on_early_data_failed: thunk::on_early_data_failed::<E>,
                on_path_switch: thunk::on_path_switch::<E>,
                on_origin: thunk::on_origin::<E>,
                get_ssl_ctx: thunk::get_ssl_ctx::<E>,
                get_client_ssl_ctx: thunk::get_client_ssl_ctx::<E>,
                lookup_cert: thunk::lookup_cert::<E>,
                packets_out: thunk::packets_out::<E>,
                on_mini_conn_failed: thunk::on_mini_conn_failed::<E>,
            },
            _owner: PhantomData,
        }
    }
}

impl<E: NqEndpoint> Default for NqVtable<E> {
    fn default() -> Self {
        Self::new()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Engine
// ──────────────────────────────────────────────────────────────────────────

/// An lsquic engine owned by an `E`, which it holds a ref on: the owner is
/// the `peer_ctx` of every packet and connection and the receiver of every
/// engine-level callback. Destroyed (closing its conns) on drop.
pub struct Engine<E: NqEndpoint> {
    raw: NonNull<lsquic_engine>,
    owner: RefPtr<E>,
    _origin_blob: Option<Box<[u8]>>,
}

impl<E: NqEndpoint> Engine<E> {
    pub fn new(
        vtable: &'static NqVtable<E>,
        owner: ThisPtr<E>,
        is_server: bool,
        is_http: bool,
        mut settings: Settings,
    ) -> Option<Self> {
        let ids = [
            TypeId::of::<E>(),
            TypeId::of::<E::Session>(),
            TypeId::of::<<E::Session as NqSession>::Stream>(),
        ];
        assert!(
            *INSTALLED.get_or_init(|| ids) == ids,
            "bun_lsquic_sys dispatches to one endpoint type per process"
        );
        let owner = RefPtr::from_this(owner);
        // SAFETY: `vtable` is static; `owner` stays live while the engine
        // holds its ref; `settings` is copied by lsquic and its origin blob
        // moves into the engine.
        let raw = unsafe {
            us_nq_engine_new(
                is_server as c_int,
                is_http as c_int,
                &raw const vtable.raw,
                owner.as_ptr().cast(),
                settings.as_ptr(),
                core::ptr::null(),
            )
        };
        match NonNull::new(raw) {
            Some(raw) => Some(Engine {
                raw,
                owner,
                _origin_blob: settings.origin_blob.take(),
            }),
            None => None,
        }
    }

    fn get(&self) -> &lsquic_engine {
        lsquic_engine::opaque_ref(self.raw.as_ptr())
    }

    pub fn process_conns(&self) {
        lsquic_engine_process_conns(self.get())
    }
    pub fn has_unsent_packets(&self) -> bool {
        lsquic_engine_has_unsent_packets(self.get()) != 0
    }
    pub fn send_unsent_packets(&self) {
        lsquic_engine_send_unsent_packets(self.get())
    }
    pub fn conn_count(&self) -> u32 {
        lsquic_engine_conn_count(self.get())
    }
    pub fn set_idle_timeout_ms(&self, ms: c_uint) {
        lsquic_engine_set_idle_timeout_ms(self.get(), ms)
    }
    /// Microseconds until lsquic next wants a tick, if it has one scheduled.
    pub fn earliest_adv_tick(&self) -> Option<c_int> {
        let mut diff: c_int = 0;
        (lsquic_engine_earliest_adv_tick(self.get(), &mut diff) != 0).then_some(diff)
    }
    /// `(sent, rate_limited)` stateless resets.
    pub fn sreset_stats(&self) -> (u64, u64) {
        let (mut sent, mut limited) = (0u64, 0u64);
        lsquic_engine_sreset_stats(self.get(), &mut sent, &mut limited);
        (sent, limited)
    }
    pub fn cid_in_use(&self, cid: &[u8]) -> bool {
        // SAFETY: live engine; `cid` is readable for its length.
        unsafe { lsquic_engine_cid_in_use(self.raw.as_ptr(), cid.as_ptr(), cid.len()) != 0 }
    }
    /// Feed one UDP datagram; the owner is its `peer_ctx`.
    pub fn packet_in(&self, data: &[u8], local: &SockAddr, peer: &SockAddr, ecn: c_int) -> c_int {
        // SAFETY: live engine; `data`/`local`/`peer` are readable for the
        // call (lsquic copies what it keeps).
        unsafe {
            lsquic_engine_packet_in(
                self.raw.as_ptr(),
                data.as_ptr(),
                data.len(),
                core::ptr::from_ref(local).cast(),
                core::ptr::from_ref(peer).cast(),
                self.owner.as_ptr().cast(),
                ecn,
            )
        }
    }
    /// Open a client connection whose context is `session`. `on_new_conn`
    /// runs before this returns and sees the context already set. On
    /// failure the ref is handed back.
    #[allow(clippy::too_many_arguments)]
    pub fn connect(
        &self,
        version: c_int,
        local: &SockAddr,
        peer: &SockAddr,
        session: RefPtr<E::Session>,
        hostname: Option<&CStr>,
        base_plpmtu: u16,
        sess_resume: &[u8],
        token: &[u8],
    ) -> Result<Conn, RefPtr<E::Session>> {
        let ctx = session.as_ptr();
        // SAFETY: live engine; every pointer is readable for the call and
        // copied by lsquic; `ctx` becomes the conn context, whose ref this
        // crate releases in `on_conn_closed`/`take_ctx`.
        let conn = unsafe {
            lsquic_engine_connect(
                self.raw.as_ptr(),
                version,
                core::ptr::from_ref(local).cast(),
                core::ptr::from_ref(peer).cast(),
                self.owner.as_ptr().cast(),
                ctx.cast(),
                hostname.map_or(core::ptr::null(), CStr::as_ptr),
                base_plpmtu,
                if sess_resume.is_empty() {
                    core::ptr::null()
                } else {
                    sess_resume.as_ptr()
                },
                sess_resume.len(),
                if token.is_empty() {
                    core::ptr::null()
                } else {
                    token.as_ptr()
                },
                token.len(),
            )
        };
        match Conn::from_raw(conn) {
            Some(conn) => {
                let _ = RefPtr::into_raw(session);
                Ok(conn)
            }
            None => Err(session),
        }
    }
}

impl<E: NqEndpoint> Drop for Engine<E> {
    fn drop(&mut self) {
        // SAFETY: created by `us_nq_engine_new`, destroyed once; callbacks it
        // runs still see a live owner (`owner` is released after this).
        unsafe { lsquic_engine_destroy(self.raw.as_ptr()) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// packets_out specs
// ──────────────────────────────────────────────────────────────────────────

/// The `specs[0..n]` array of one `packets_out` call.
pub struct OutSpecs<'a> {
    ptr: *const lsquic_out_spec,
    n: usize,
    _call: PhantomData<&'a lsquic_out_spec>,
}

/// One outgoing packet: its iovecs and addresses.
#[derive(Clone, Copy)]
pub struct OutSpec<'a> {
    spec: &'a lsquic_out_spec,
}

impl<'a> OutSpecs<'a> {
    pub fn len(&self) -> usize {
        self.n
    }
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }
    pub fn iter(&self) -> impl Iterator<Item = OutSpec<'a>> + '_ {
        let stride = us_nq_spec_stride();
        (0..self.n).map(move |i| OutSpec {
            // SAFETY: lsquic passes `n` specs `stride` bytes apart, valid for
            // the call `'a` spans.
            spec: lsquic_out_spec::opaque_ref(unsafe { self.ptr.byte_add(i * stride) }),
        })
    }
}

impl<'a> OutSpec<'a> {
    /// The packet's byte ranges, in order (empty ones skipped).
    pub fn iov(self) -> impl Iterator<Item = &'a [u8]> {
        let mut n = 0usize;
        let iov = us_nq_spec_iov(self.spec, &mut n);
        let iov: &'a [iovec] = if iov.is_null() || n == 0 {
            &[]
        } else {
            // SAFETY: lsquic guarantees `iov[..n]` for the call.
            unsafe { core::slice::from_raw_parts(iov, n) }
        };
        iov.iter()
            .filter(|v| !v.iov_base.is_null() && v.iov_len != 0)
            // SAFETY: lsquic guarantees `iov_base[..iov_len]` for the call.
            .map(|v| unsafe { core::slice::from_raw_parts(v.iov_base.cast::<u8>(), v.iov_len) })
    }
    pub fn dest(self) -> Option<&'a SockAddr> {
        SockAddr::opt(us_nq_spec_dest(self.spec))
    }
    pub fn local(self) -> Option<&'a SockAddr> {
        SockAddr::opt(us_nq_spec_local(self.spec))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Conn / Stream handles
// ──────────────────────────────────────────────────────────────────────────

/// A `lsquic_conn_t` handle. lsquic owns the conn and frees it right after
/// [`NqSession::on_conn_closed`]; holders drop their copy there.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Conn(NonNull<lsquic_conn>);

impl Conn {
    fn from_raw(raw: *mut lsquic_conn) -> Option<Self> {
        NonNull::new(raw).map(Self)
    }
    fn get<'a>(self) -> &'a lsquic_conn {
        lsquic_conn::opaque_ref(self.0.as_ptr())
    }
    /// The session this conn's context refers to. Valid while the context
    /// holds its ref (until `on_conn_closed` / [`take_ctx`](Self::take_ctx)).
    pub fn ctx<S: NqSession>(self) -> Option<ThisPtr<S>> {
        let ctx = lsquic_conn_get_ctx(self.get());
        if ctx.is_null() || !installed_session_is::<S>() {
            return None;
        }
        // SAFETY: a non-null conn context is the `RefPtr<S>` this crate
        // installed (S is the recorded session type), live while set.
        Some(unsafe { ThisPtr::new(ctx.cast::<S>()) })
    }
    /// Detach the conn's context early, handing back the ref it held; later
    /// callbacks for this conn see no context and are skipped.
    pub fn take_ctx<S: NqSession>(self) -> Option<RefPtr<S>> {
        let ctx = lsquic_conn_get_ctx(self.get());
        if ctx.is_null() || !installed_session_is::<S>() {
            return None;
        }
        lsquic_conn_set_ctx(self.get(), core::ptr::null_mut());
        // SAFETY: as in `ctx`; the slot is cleared so the ref moves out once.
        Some(unsafe { RefPtr::from_raw(ctx.cast::<S>()) })
    }
    /// The endpoint that fed this conn's packets (its engine's owner).
    pub fn peer_ctx<E: NqEndpoint>(self) -> Option<ThisPtr<E>> {
        let p = lsquic_conn_get_peer_ctx(self.get(), core::ptr::null());
        if p.is_null()
            || INSTALLED
                .get()
                .is_none_or(|ids| ids[0] != TypeId::of::<E>())
        {
            return None;
        }
        // SAFETY: every `peer_ctx` is `Engine::<E>`'s owner (E is the
        // recorded endpoint type), which the engine keeps live.
        Some(unsafe { ThisPtr::new(p.cast::<E>()) })
    }
    pub fn close(self) {
        lsquic_conn_close(self.get())
    }
    pub fn going_away(self) {
        lsquic_conn_going_away(self.get())
    }
    pub fn abort(self) {
        lsquic_conn_abort(self.get())
    }
    pub fn abort_silent(self) {
        lsquic_conn_abort_silent(self.get())
    }
    pub fn abort_error(self, is_app: bool, code: c_uint, reason: &CStr) {
        // SAFETY: live conn; `reason` is NUL-terminated and copied.
        unsafe { lsquic_conn_abort_error(self.0.as_ptr(), is_app as c_int, code, reason.as_ptr()) }
    }
    /// `(status, message)` — `enum LSCONN_STATUS` and lsquic's error text.
    pub fn status(self) -> (c_int, Vec<u8>) {
        const ERRBUF_LEN: usize = 256;
        let mut buf = [0u8; ERRBUF_LEN];
        // SAFETY: live conn; `buf` is writable for its length and lsquic
        // NUL-terminates what it writes.
        let status =
            unsafe { lsquic_conn_status(self.0.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) };
        let len = strings::index_of_char_usize(&buf, 0).unwrap_or(buf.len());
        (status, buf[..len].to_vec())
    }
    /// SETTINGS_H3_DATAGRAM state (RFC 9297).
    pub fn peer_h3_datagram(self) -> Option<bool> {
        match lsquic_conn_peer_h3_datagram(self.get()) {
            -1 => None,
            v => Some(v != 0),
        }
    }
    pub fn make_stream(self) {
        lsquic_conn_make_stream(self.get())
    }
    pub fn make_uni_stream(self) {
        lsquic_conn_make_uni_stream(self.get())
    }
    pub fn want_datagram_write(self, want: bool) -> c_int {
        lsquic_conn_want_datagram_write(self.get(), want as c_int)
    }
    /// `(local, peer)` of the current path.
    pub fn sockaddrs(self) -> Option<(SockAddr, SockAddr)> {
        let mut local: *const c_void = core::ptr::null();
        let mut peer: *const c_void = core::ptr::null();
        if lsquic_conn_get_sockaddr(self.get(), &mut local, &mut peer) != 0 {
            return None;
        }
        Some((*SockAddr::opt(local)?, *SockAddr::opt(peer)?))
    }
    pub fn sni(self) -> Option<Vec<u8>> {
        let p = lsquic_conn_get_sni(self.get());
        // SAFETY: null or a NUL-terminated string owned by the conn.
        (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) }.to_bytes().to_vec())
    }
    pub fn cipher(self) -> Option<Vec<u8>> {
        let p = lsquic_conn_crypto_cipher(self.get());
        // SAFETY: null or a static cipher name.
        (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) }.to_bytes().to_vec())
    }
    pub fn pings_received(self) -> u64 {
        lsquic_conn_pings_received(self.get())
    }
    pub fn set_ping_period_us(self, usec: u64) {
        lsquic_conn_set_ping_period_us(self.get(), usec)
    }
    pub fn ack_now(self) {
        lsquic_conn_ack_now(self.get())
    }
    pub fn use_preferred_address(self, on: bool) {
        lsquic_conn_use_preferred_address(self.get(), on as c_int)
    }
    pub fn datagram_early(self) -> bool {
        lsquic_conn_datagram_early(self.get()) != 0
    }
    /// The server's certificate chain as sent (client conns only).
    pub fn server_cert_chain(self) -> Option<boringssl::OwnedX509Stack> {
        // SAFETY: lsquic returns null or a new stack the caller owns.
        unsafe {
            boringssl::OwnedX509Stack::from_raw(lsquic_conn_get_server_cert_chain(self.get()))
        }
    }
    /// Run `f` on the conn's TLS handle, which the conn owns.
    pub fn with_ssl<R>(self, f: impl FnOnce(&boringssl::SSL) -> R) -> Option<R> {
        let p = lsquic_conn_get_ssl(self.get());
        (!p.is_null()).then(|| f(boringssl::SSL::opaque_ref(p)))
    }
    pub fn info(self) -> Option<ConnInfo> {
        let mut out = ConnInfo::default();
        (lsquic_conn_get_info(self.get(), &mut out) == 0).then_some(out)
    }
    pub fn peer_transport_params(self) -> Option<NqTransportParams> {
        let mut out = NqTransportParams::default();
        (us_nq_conn_transport_params(self.get(), 1, &mut out) == 1).then_some(out)
    }
}

/// The conn a TLS handle belongs to, as seen from a TLS callback. During a
/// server handshake this is lsquic's mini conn, which implements only a few
/// of the conn operations, so only those are exposed.
#[derive(Copy, Clone)]
pub struct HandshakeConn(Conn);

impl HandshakeConn {
    pub fn from_ssl(ssl: &boringssl::SSL) -> Option<Self> {
        Conn::from_raw(lsquic_ssl_to_conn(ssl)).map(HandshakeConn)
    }
    pub fn ctx<S: NqSession>(self) -> Option<ThisPtr<S>> {
        self.0.ctx()
    }
    pub fn peer_ctx<E: NqEndpoint>(self) -> Option<ThisPtr<E>> {
        self.0.peer_ctx()
    }
    pub fn sockaddrs(self) -> Option<(SockAddr, SockAddr)> {
        self.0.sockaddrs()
    }
}

/// RFC 9218 Extensible HTTP Priority (`struct lsquic_ext_http_prio`).
#[repr(C)]
pub struct ExtHttpPrio {
    urgency: u8,
    incremental: i8,
}

/// One [`Stream::read_uninit`] result.
pub enum StreamRead<'a> {
    Data(&'a [u8]),
    /// FIN reached.
    Eof,
    /// Nothing to read now (or an error lsquic reports through the stream).
    WouldBlock,
}

/// A `lsquic_stream_t` handle. lsquic owns the stream and frees it right
/// after [`NqStream::on_close`]; holders drop their copy there.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct Stream(NonNull<lsquic_stream>);

impl Stream {
    fn from_raw(raw: *mut lsquic_stream) -> Option<Self> {
        NonNull::new(raw).map(Self)
    }
    fn get<'a>(self) -> &'a lsquic_stream {
        lsquic_stream::opaque_ref(self.0.as_ptr())
    }
    pub fn conn(self) -> Option<Conn> {
        Conn::from_raw(lsquic_stream_conn(self.get()))
    }
    /// Detach the stream's context early, handing back the ref it held;
    /// later callbacks for this stream see no context and are skipped.
    pub fn take_ctx<St: NqStream>(self) -> Option<RefPtr<St>> {
        let ctx = lsquic_stream_get_ctx(self.get());
        if ctx.is_null() || !installed_stream_is::<St>() {
            return None;
        }
        lsquic_stream_set_ctx(self.get(), core::ptr::null_mut());
        // SAFETY: a non-null stream context is the `RefPtr<St>` this crate
        // installed (St is the recorded stream type); the slot is cleared
        // so the ref moves out once.
        Some(unsafe { RefPtr::from_raw(ctx.cast::<St>()) })
    }
    pub fn id(self) -> u64 {
        lsquic_stream_id(self.get())
    }
    pub fn read(self, buf: &mut [u8]) -> isize {
        // SAFETY: live stream; `buf` is writable for its length.
        unsafe { lsquic_stream_read(self.0.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) }
    }
    /// Read into uninitialized scratch, returning what was filled.
    pub fn read_uninit(self, buf: &mut [core::mem::MaybeUninit<u8>]) -> StreamRead<'_> {
        // SAFETY: live stream; `buf` is writable for its length.
        let n = unsafe { lsquic_stream_read(self.0.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) };
        match usize::try_from(n) {
            Ok(0) => StreamRead::Eof,
            // SAFETY: lsquic initialized `buf[..n]`, `n <= buf.len()`.
            Ok(n) => StreamRead::Data(unsafe {
                core::slice::from_raw_parts(buf.as_ptr().cast::<u8>(), n.min(buf.len()))
            }),
            Err(_) => StreamRead::WouldBlock,
        }
    }
    pub fn write(self, buf: &[u8]) -> isize {
        // SAFETY: live stream; `buf` is readable for its length.
        unsafe { lsquic_stream_write(self.0.as_ptr(), buf.as_ptr().cast(), buf.len()) }
    }
    pub fn flush(self) -> c_int {
        lsquic_stream_flush(self.get())
    }
    pub fn shutdown(self, how: c_int) -> c_int {
        lsquic_stream_shutdown(self.get(), how)
    }
    pub fn shutdown_internal(self) {
        lsquic_stream_shutdown_internal(self.get())
    }
    pub fn close(self) -> c_int {
        lsquic_stream_close(self.get())
    }
    pub fn want_read(self, want: bool) -> c_int {
        lsquic_stream_wantread(self.get(), want as c_int)
    }
    pub fn want_write(self, want: bool) -> c_int {
        lsquic_stream_wantwrite(self.get(), want as c_int)
    }
    pub fn reset(self, code: u64) {
        us_nq_stream_reset(self.get(), code)
    }
    pub fn error_code(self) -> u64 {
        lsquic_stream_get_error_code(self.get())
    }
    pub fn take_header_set(self) -> Option<HeaderSet> {
        NonNull::new(lsquic_stream_get_hset(self.get())).map(HeaderSet)
    }
    /// `expected` is the caller's header-pair count; the shim rejects a buffer
    /// that does not parse to exactly that many pairs.
    pub fn send_headers(self, nul_joined: &[u8], expected: c_int, eos: bool) -> c_int {
        // SAFETY: live stream; lsquic copies the buffer before returning.
        unsafe {
            us_nq_stream_send_headers(
                self.0.as_ptr(),
                nul_joined.as_ptr().cast(),
                nul_joined.len(),
                expected,
                eos as c_int,
            )
        }
    }
    /// RFC 9218 Extensible HTTP Priority: urgency 0-7, incremental 0/1.
    pub fn set_http_prio(self, urgency: u8, incremental: bool) -> c_int {
        let p = ExtHttpPrio {
            urgency: urgency.min(7),
            incremental: incremental as i8,
        };
        lsquic_stream_set_http_prio(self.get(), &p)
    }
    pub fn get_http_prio(self) -> Option<(u8, bool)> {
        let mut p = ExtHttpPrio {
            urgency: 3,
            incremental: 0,
        };
        (lsquic_stream_get_http_prio(self.get(), &mut p) == 0)
            .then_some((p.urgency, p.incremental != 0))
    }
    /// Bytes sent but not yet acknowledged by the peer (RFC 9000 §2.2).
    pub fn has_unacked_data(self) -> bool {
        lsquic_stream_has_unacked_data(self.get()) != 0
    }
    pub fn reset_received(self) -> bool {
        lsquic_stream_reset_received(self.get()) != 0
    }
    pub fn is_rejected(self) -> bool {
        lsquic_stream_is_rejected(self.get()) != 0
    }
    pub fn received_early_data(self) -> bool {
        lsquic_stream_received_early_data(self.get()) != 0
    }
    pub fn stop_sending(self, code: u64) {
        lsquic_stream_send_stop_sending(self.get(), code)
    }
}

pub struct HeaderSet(NonNull<c_void>);

impl HeaderSet {
    /// h3 permits bytes that are not valid UTF-8, so the JS boundary picks the
    /// encoding (latin1, as node does for HTTP headers).
    pub fn pairs(&self) -> Vec<Vec<u8>> {
        let mut len: usize = 0;
        // SAFETY: `self.0` is a live `nq_hset` until `Drop`.
        let p = unsafe { us_nq_hset_pairs(self.0.as_ptr(), &raw mut len) };
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
        unsafe { us_nq_hset_free(self.0.as_ptr()) }
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
        NqTransportParams {
            initial_max_stream_data_bidi_local: 0,
            initial_max_stream_data_bidi_remote: 0,
            initial_max_stream_data_uni: 0,
            initial_max_data: 0,
            initial_max_streams_bidi: 0,
            initial_max_streams_uni: 0,
            max_idle_timeout: 0,
            max_udp_payload_size: 0,
            ack_delay_exponent: 0,
            max_ack_delay: 0,
            active_connection_id_limit: 0,
            max_datagram_frame_size: 0,
            disable_active_migration: 0,
            initial_scid: [0; 2 * MAX_CID_LEN + 1],
            retry_scid: [0; 2 * MAX_CID_LEN + 1],
            original_dcid: [0; 2 * MAX_CID_LEN + 1],
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Loop driver
// ──────────────────────────────────────────────────────────────────────────

/// Receives the per-loop-turn and microtask-drain passes of an [`NqDriver`].
pub trait NqDriverOwner: Sized + 'static {
    /// One process pass per loop turn (loop_pre/loop_post).
    fn process_pass(this: ThisPtr<Self>);
    /// The microtask-drain pass.
    fn drain_pass(this: ThisPtr<Self>);
}

/// Mirrors `struct us_nq_driver_s`; the C side links it into the loop's list
/// and reads/writes `next`/`pending`.
#[repr(C)]
struct DriverNode {
    next: Cell<*mut us_nq_driver_s>,
    owner: Cell<*mut c_void>,
    pending: Cell<c_int>,
    process: Cell<unsafe extern "C" fn(*mut c_void)>,
    drain: Cell<unsafe extern "C" fn(*mut c_void)>,
}

/// An endpoint's node on the loop's node:quic driver list. While registered
/// it holds a ref on its owner, so the loop's walk always reaches a live one.
pub struct NqDriver<T: NqDriverOwner + AnyRefCounted> {
    node: Box<DriverNode>,
    registered: Cell<Option<(NonNull<bun_uws_sys::Loop>, RefPtr<T>)>>,
}

unsafe extern "C" fn driver_process<T: NqDriverOwner>(owner: *mut c_void) {
    // SAFETY: `owner` is the `RefPtr<T>` `NqDriver::register` installed and
    // still holds (it clears the node before releasing it).
    T::process_pass(unsafe { ThisPtr::new(owner.cast::<T>()) })
}
unsafe extern "C" fn driver_drain<T: NqDriverOwner>(owner: *mut c_void) {
    // SAFETY: as above.
    T::drain_pass(unsafe { ThisPtr::new(owner.cast::<T>()) })
}

impl<T: NqDriverOwner + AnyRefCounted> NqDriver<T> {
    pub fn new() -> Self {
        NqDriver {
            node: Box::new(DriverNode {
                next: Cell::new(core::ptr::null_mut()),
                owner: Cell::new(core::ptr::null_mut()),
                pending: Cell::new(0),
                process: Cell::new(driver_process::<T>),
                drain: Cell::new(driver_drain::<T>),
            }),
            registered: Cell::new(None),
        }
    }

    fn node_ptr(&self) -> *mut us_nq_driver_s {
        core::ptr::from_ref(&*self.node).cast_mut().cast()
    }

    pub fn is_registered(&self) -> bool {
        // `Cell<Option<(.., RefPtr)>>` is not `Copy`; peek through take/set.
        let v = self.registered.take();
        let r = v.is_some();
        self.registered.set(v);
        r
    }

    /// Link into this thread's loop's driver list (idempotent), taking a ref
    /// on `owner`.
    pub fn register(&self, owner: ThisPtr<T>) {
        if self.is_registered() {
            return;
        }
        let Some(loop_) = NonNull::new(bun_uws_sys::Loop::get()) else {
            return;
        };
        let owner = RefPtr::from_this(owner);
        // SAFETY: `node` is heap-pinned for `self`'s life and unlinked in
        // `unregister`/`Drop`; the loop is the live per-thread loop; every
        // field the C side writes is a `Cell`.
        unsafe {
            us_nq_loop_register(
                loop_.as_ptr(),
                self.node_ptr(),
                owner.as_ptr().cast(),
                driver_process::<T>,
                driver_drain::<T>,
            )
        };
        self.registered.set(Some((loop_, owner)));
    }

    /// Unlink (idempotent) and release the owner ref.
    pub fn unregister(&self) {
        if let Some((loop_, owner)) = self.registered.take() {
            // SAFETY: registered on this loop by `register`.
            unsafe { us_nq_loop_unregister(loop_.as_ptr(), self.node_ptr()) };
            self.node.owner.set(core::ptr::null_mut());
            drop(owner);
        }
    }

    /// Ask for a pass at the next loop point.
    pub fn mark_pending(&self) {
        self.node.pending.set(1);
    }

    /// Clear and return the pending flag.
    pub fn take_pending(&self) -> bool {
        self.node.pending.replace(0) != 0
    }
}

impl<T: NqDriverOwner + AnyRefCounted> Default for NqDriver<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: NqDriverOwner + AnyRefCounted> Drop for NqDriver<T> {
    fn drop(&mut self) {
        self.unregister();
    }
}

pub fn assert_layout() {
    assert_eq!(
        us_nq_vtable_size(),
        core::mem::size_of::<RawVtable>(),
        "us_nq_vtable layout mismatch between node_quic_shim.c and lsquic_sys"
    );
    assert_eq!(
        us_nq_driver_size(),
        core::mem::size_of::<DriverNode>(),
        "us_nq_driver_s layout mismatch between node_quic_shim.c and lsquic_sys"
    );
    assert_eq!(
        us_nq_conn_info_size(),
        core::mem::size_of::<ConnInfo>(),
        "lsquic_conn_info layout mismatch: Conn::info passes a stack ConnInfo \
         that lsquic fills with sizeof(struct lsquic_conn_info) bytes"
    );
    assert_eq!(
        us_nq_tp_size(),
        core::mem::size_of::<NqTransportParams>(),
        "us_nq_tp layout mismatch: peer_transport_params passes a stack \
         NqTransportParams that C fills with sizeof(struct us_nq_tp) bytes"
    );
}
