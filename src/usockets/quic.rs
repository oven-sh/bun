//! QUIC / HTTP/3 transport for usockets, backed by lsquic.
//!
//! One `us_quic_socket_context_t` per server (engine + UDP socket + timer + SSL).
//! No global state — multiple contexts can coexist on the same loop.
//! Port of `packages/bun-usockets/src/quic.{c,h}`.

use core::ffi::{c_char, c_int, c_uint, c_ulong, c_ushort, c_void};
use core::mem::{MaybeUninit, size_of, zeroed};
use core::ptr;

use bun_boringssl_sys::{
    SSL, SSL_CTX, SSL_CTX_free, SSL_CTX_new, SSL_CTX_set_alpn_select_cb, SSL_METHOD,
    SSL_TLSEXT_ERR_ALERT_FATAL, SSL_TLSEXT_ERR_OK, SSL_VERIFY_PEER, SSL_get_SSL_CTX, X509,
    X509_STORE, X509_STORE_CTX, struct_stack_st_X509,
};

use crate::bsd::{LIBUS_SOCKET_ERROR, bsd_close_socket, bsd_create_socket};
use crate::eventing::{LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE, us_poll_change, us_poll_fd};
#[cfg(windows)]
use crate::eventing::{us_create_timer, us_timer_loop, us_timer_set, us_timer_t};
#[cfg(not(any(target_os = "linux", target_os = "android")))]
use crate::types::LIBUS_SOCKET_DESCRIPTOR;
use crate::types::{
    Bun__addrinfo_freeRequest, Bun__addrinfo_get, Bun__addrinfo_getRequestResult, addrinfo,
    addrinfo_request, addrinfo_result, ext_of, sockaddr_storage, socklen_t,
    us_bun_socket_context_options_t, us_loop_t, us_poll_t, us_quic_socket_context_s,
    us_udp_socket_t,
};
use crate::udp::{
    us_create_udp_socket, us_udp_packet_buffer_payload, us_udp_packet_buffer_payload_length,
    us_udp_packet_buffer_peer, us_udp_packet_buffer_t, us_udp_socket_close, us_udp_socket_user,
};

// ═══════════════════════════════════════════════════════════════════════════
// Platform glue — sockaddr types, AF_* constants, errno
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
use libc::{AF_INET, AF_INET6, SOCK_DGRAM, sockaddr, sockaddr_in, sockaddr_in6};

#[cfg(windows)]
use bun_windows_sys::ws2_32::{sockaddr, sockaddr_in, sockaddr_in6};
#[cfg(windows)]
const AF_INET: c_int = 2;
#[cfg(windows)]
const AF_INET6: c_int = 23;
#[cfg(windows)]
const SOCK_DGRAM: c_int = 2;

#[cfg(not(windows))]
type ssize_t = libc::ssize_t;
#[cfg(windows)]
type ssize_t = isize;

/// `struct iovec` — same layout on POSIX (`sys/uio.h`) and lsquic's `vc_compat.h`.
#[repr(C)]
struct iovec {
    iov_base: *mut c_void,
    iov_len: usize,
}

#[inline(always)]
unsafe fn errno_ptr() -> *mut c_int {
    unsafe extern "C" {
        #[cfg_attr(
            any(target_os = "macos", target_os = "ios", target_os = "freebsd"),
            link_name = "__error"
        )]
        #[cfg_attr(target_os = "linux", link_name = "__errno_location")]
        #[cfg_attr(target_os = "android", link_name = "__errno")]
        #[cfg_attr(windows, link_name = "_errno")]
        fn __errno() -> *mut c_int;
    }
    // SAFETY: always returns a valid thread-local int* for the calling thread.
    unsafe { __errno() }
}
#[inline(always)]
unsafe fn errno() -> c_int {
    unsafe { *errno_ptr() }
}
#[inline(always)]
unsafe fn set_errno(e: c_int) {
    unsafe { *errno_ptr() = e }
}

#[inline(always)]
unsafe fn sa_family(sa: *const sockaddr) -> c_int {
    // SAFETY: caller guarantees `sa` points to a valid sockaddr header.
    unsafe { (*sa).sa_family as c_int }
}

#[inline(always)]
unsafe fn sa_len(sa: *const sockaddr) -> socklen_t {
    if unsafe { sa_family(sa) } == AF_INET6 {
        size_of::<sockaddr_in6>() as socklen_t
    } else {
        size_of::<sockaddr_in>() as socklen_t
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// lsquic — opaque handles, constants, and FFI structs
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct lsquic_engine_t {
    _p: [u8; 0],
}
#[repr(C)]
pub struct lsquic_conn_t {
    _p: [u8; 0],
}
#[repr(C)]
pub struct lsquic_stream_t {
    _p: [u8; 0],
}
// lsquic_conn_ctx_t / lsquic_stream_ctx_t are opaque typedefs — we pass our own
// `us_quic_socket_t*` / `us_quic_stream_t*` through them as `*mut c_void`.

const LSENG_SERVER: c_uint = 1 << 0;
const LSENG_HTTP: c_uint = 1 << 1;
const LSENG_HTTP_SERVER: c_uint = LSENG_SERVER | LSENG_HTTP;
const LSQUIC_GLOBAL_CLIENT: c_int = 1 << 0;
const LSQUIC_GLOBAL_SERVER: c_int = 1 << 1;

// enum lsquic_version — only the values we use.
const LSQVER_ID27: c_uint = 3;
const LSQVER_ID29: c_uint = 4;
const LSQVER_I001: c_uint = 5;
const LSQVER_I002: c_uint = 6;
const LSQVER_RESVED: c_uint = 7;
const N_LSQVER: c_int = 8;

const LSQUIC_SUPPORTED_VERSIONS: c_uint = (1 << N_LSQVER) - 1;
const LSQUIC_EXPERIMENTAL_VERSIONS: c_uint = 1 << LSQVER_RESVED;
const LSQUIC_DEPRECATED_VERSIONS: c_uint = 1 << LSQVER_ID27;
const LSQUIC_DF_VERSIONS: c_uint =
    LSQUIC_SUPPORTED_VERSIONS & !LSQUIC_DEPRECATED_VERSIONS & !LSQUIC_EXPERIMENTAL_VERSIONS;
const LSQUIC_IETF_VERSIONS: c_uint = (1 << LSQVER_ID27)
    | (1 << LSQVER_ID29)
    | (1 << LSQVER_I001)
    | (1 << LSQVER_I002)
    | (1 << LSQVER_RESVED);

// enum lsquic_hsk_status
const LSQ_HSK_OK: c_int = 1;
const LSQ_HSK_RESUMED_OK: c_int = 2;

// enum lsxpack_flag
const LSXPACK_QPACK_IDX: u8 = 2;

// enum lsquic_logger_timestamp_style
#[cfg(debug_assertions)]
const LLTS_HHMMSSUS: c_int = 4;

/// `struct lsxpack_header` — mirrors `vendor/lsquic/include/lsxpack_header.h`.
/// `flags` is `enum lsxpack_flag flags:8` in C; MSVC allocates an int-sized
/// bitfield storage unit for enum bitfields, so Windows layout differs.
#[repr(C)]
#[derive(Clone, Copy)]
struct lsxpack_header {
    buf: *mut c_char,
    name_hash: u32,
    nameval_hash: u32,
    name_offset: i32,
    val_offset: i32,
    name_len: u16,
    val_len: u16,
    chain_next_idx: u16,
    hpack_index: u8,
    qpack_index: u8,
    app_index: u8,
    #[cfg(windows)]
    _msvc_bitfield_pad: [u8; 3],
    flags: u8,
    #[cfg(windows)]
    _msvc_bitfield_tail: [u8; 3],
    indexed_type: u8,
    dec_overhead: u8,
}

const _: () = assert!(size_of::<lsxpack_header>() == if cfg!(windows) { 48 } else { 40 });

#[repr(C)]
struct lsquic_http_headers {
    count: c_int,
    headers: *mut lsxpack_header,
}

#[repr(C)]
struct lsquic_out_spec {
    iov: *mut iovec,
    iovlen: usize,
    local_sa: *const sockaddr,
    dest_sa: *const sockaddr,
    peer_ctx: *mut c_void,
    conn_ctx: *mut c_void,
    ecn: c_int,
}

#[repr(C)]
struct lsquic_stream_if {
    on_new_conn: Option<unsafe extern "C" fn(*mut c_void, *mut lsquic_conn_t) -> *mut c_void>,
    on_goaway_received: Option<unsafe extern "C" fn(*mut lsquic_conn_t)>,
    on_conn_closed: Option<unsafe extern "C" fn(*mut lsquic_conn_t)>,
    on_new_stream: Option<unsafe extern "C" fn(*mut c_void, *mut lsquic_stream_t) -> *mut c_void>,
    on_read: Option<unsafe extern "C" fn(*mut lsquic_stream_t, *mut c_void)>,
    on_write: Option<unsafe extern "C" fn(*mut lsquic_stream_t, *mut c_void)>,
    on_close: Option<unsafe extern "C" fn(*mut lsquic_stream_t, *mut c_void)>,
    on_dg_write: Option<unsafe extern "C" fn(*mut lsquic_conn_t, *mut c_void, usize) -> ssize_t>,
    on_datagram: Option<unsafe extern "C" fn(*mut lsquic_conn_t, *const c_void, usize)>,
    on_hsk_done: Option<unsafe extern "C" fn(*mut lsquic_conn_t, c_int)>,
    on_new_token: Option<unsafe extern "C" fn(*mut lsquic_conn_t, *const u8, usize)>,
    on_sess_resume_info: Option<unsafe extern "C" fn(*mut lsquic_conn_t, *const u8, usize)>,
    on_reset: Option<unsafe extern "C" fn(*mut lsquic_stream_t, *mut c_void, c_int)>,
    on_conncloseframe_received:
        Option<unsafe extern "C" fn(*mut lsquic_conn_t, c_int, u64, *const c_char, c_int)>,
}
unsafe impl Sync for lsquic_stream_if {}

#[repr(C)]
struct lsquic_hset_if {
    hsi_create_header_set:
        Option<unsafe extern "C" fn(*mut c_void, *mut lsquic_stream_t, c_int) -> *mut c_void>,
    hsi_prepare_decode: Option<
        unsafe extern "C" fn(*mut c_void, *mut lsxpack_header, usize) -> *mut lsxpack_header,
    >,
    hsi_process_header: Option<unsafe extern "C" fn(*mut c_void, *mut lsxpack_header) -> c_int>,
    hsi_discard_header_set: Option<unsafe extern "C" fn(*mut c_void)>,
    hsi_flags: c_uint,
}
unsafe impl Sync for lsquic_hset_if {}

#[cfg(debug_assertions)]
#[repr(C)]
struct lsquic_logger_if {
    log_buf: Option<unsafe extern "C" fn(*mut c_void, *const c_char, usize) -> c_int>,
}
#[cfg(debug_assertions)]
unsafe impl Sync for lsquic_logger_if {}

/// `struct lsquic_engine_settings` — field-for-field mirror of lsquic.h
/// (LSQUIC_WEBTRANSPORT_SERVER_SUPPORT=0 in Bun's build, so the trailing
/// webtransport fields are omitted).
#[repr(C)]
struct lsquic_engine_settings {
    es_versions: c_uint,
    es_cfcw: c_uint,
    es_sfcw: c_uint,
    es_max_cfcw: c_uint,
    es_max_sfcw: c_uint,
    es_max_streams_in: c_uint,
    es_handshake_to: c_ulong,
    es_idle_conn_to: c_ulong,
    es_silent_close: c_int,
    es_max_header_list_size: c_uint,
    es_ua: *const c_char,
    es_sttl: u64,
    es_pdmd: u32,
    es_aead: u32,
    es_kexs: u32,
    es_max_inchoate: c_uint,
    es_support_srej: c_int,
    es_support_push: c_int,
    es_support_tcid0: c_int,
    es_support_nstp: c_int,
    es_honor_prst: c_int,
    es_send_prst: c_int,
    es_progress_check: c_uint,
    es_rw_once: c_int,
    es_proc_time_thresh: c_uint,
    es_pace_packets: c_int,
    es_clock_granularity: c_uint,
    es_cc_algo: c_uint,
    es_cc_rtt_thresh: c_uint,
    es_enable_bw_sampler: c_int,
    es_noprogress_timeout: c_uint,
    es_init_max_data: c_uint,
    es_init_max_stream_data_bidi_remote: c_uint,
    es_init_max_stream_data_bidi_local: c_uint,
    es_init_max_stream_data_uni: c_uint,
    es_init_max_streams_bidi: c_uint,
    es_init_max_streams_uni: c_uint,
    es_idle_timeout: c_uint,
    es_ping_period: c_uint,
    es_scid_len: c_uint,
    es_scid_iss_rate: c_uint,
    es_qpack_dec_max_size: c_uint,
    es_qpack_dec_max_blocked: c_uint,
    es_qpack_enc_max_size: c_uint,
    es_qpack_enc_max_blocked: c_uint,
    es_ecn: c_int,
    es_allow_migration: c_int,
    es_retry_token_duration: c_uint,
    es_ql_bits: c_int,
    es_spin: c_int,
    es_delayed_acks: c_int,
    es_timestamps: c_int,
    es_max_udp_payload_size_rx: c_ushort,
    es_grease_quic_bit: c_int,
    es_dplpmtud: c_int,
    es_base_plpmtu: c_ushort,
    es_max_plpmtu: c_ushort,
    es_mtu_probe_timer: c_uint,
    es_datagrams: c_int,
    es_optimistic_nat: c_int,
    es_ext_http_prio: c_int,
    es_qpack_experiment: c_int,
    es_ptpc_periodicity: c_uint,
    es_ptpc_max_packtol: c_uint,
    es_ptpc_dyn_target: c_int,
    es_ptpc_target: f32,
    es_ptpc_prop_gain: f32,
    es_ptpc_int_gain: f32,
    es_ptpc_err_thresh: f32,
    es_ptpc_err_divisor: f32,
    es_delay_onclose: c_int,
    es_max_batch_size: c_uint,
    es_check_tp_sanity: c_int,
    es_amp_factor: c_int,
    es_send_verneg: c_int,
    es_preferred_address: [u8; 24],
}

#[repr(C)]
struct lsquic_engine_api {
    ea_settings: *const lsquic_engine_settings,
    ea_stream_if: *const lsquic_stream_if,
    ea_stream_if_ctx: *mut c_void,
    ea_packets_out:
        Option<unsafe extern "C" fn(*mut c_void, *const lsquic_out_spec, c_uint) -> c_int>,
    ea_packets_out_ctx: *mut c_void,
    ea_lookup_cert:
        Option<unsafe extern "C" fn(*mut c_void, *const sockaddr, *const c_char) -> *mut SSL_CTX>,
    ea_cert_lu_ctx: *mut c_void,
    ea_get_ssl_ctx: Option<unsafe extern "C" fn(*mut c_void, *const sockaddr) -> *mut SSL_CTX>,
    ea_shi: *const c_void,
    ea_shi_ctx: *mut c_void,
    ea_pmi: *const c_void,
    ea_pmi_ctx: *mut c_void,
    ea_new_scids:
        Option<unsafe extern "C" fn(*mut c_void, *mut *mut c_void, *const c_void, c_uint)>,
    ea_live_scids:
        Option<unsafe extern "C" fn(*mut c_void, *mut *mut c_void, *const c_void, c_uint)>,
    ea_old_scids:
        Option<unsafe extern "C" fn(*mut c_void, *mut *mut c_void, *const c_void, c_uint)>,
    ea_cids_update_ctx: *mut c_void,
    ea_verify_cert: Option<unsafe extern "C" fn(*mut c_void, *mut struct_stack_st_X509) -> c_int>,
    ea_verify_ctx: *mut c_void,
    ea_hsi_if: *const lsquic_hset_if,
    ea_hsi_ctx: *mut c_void,
    ea_stats_fh: *mut c_void,
    ea_alpn: *const c_char,
    ea_generate_scid:
        Option<unsafe extern "C" fn(*mut c_void, *mut lsquic_conn_t, *mut u8, c_uint)>,
    ea_gen_scid_ctx: *mut c_void,
}

// Layout asserts against vendor/lsquic/include/lsquic.h. `es_handshake_to` /
// `es_idle_conn_to` are `unsigned long`, so settings is 8 bytes smaller on LLP64.
const _: () = {
    assert!(size_of::<lsquic_engine_settings>() == if cfg!(windows) { 328 } else { 336 });
    assert!(size_of::<lsquic_engine_api>() == 192);
    assert!(size_of::<lsquic_out_spec>() == 56);
    assert!(size_of::<lsquic_stream_if>() == 112);
    assert!(size_of::<lsquic_hset_if>() == 40);
};

// ═══════════════════════════════════════════════════════════════════════════
// lsquic externs
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn lsquic_global_init(flags: c_int) -> c_int;
    fn lsquic_engine_init_settings(s: *mut lsquic_engine_settings, flags: c_uint);
    fn lsquic_engine_new(flags: c_uint, api: *const lsquic_engine_api) -> *mut lsquic_engine_t;
    fn lsquic_engine_destroy(e: *mut lsquic_engine_t);
    fn lsquic_engine_process_conns(e: *mut lsquic_engine_t);
    fn lsquic_engine_earliest_adv_tick(e: *mut lsquic_engine_t, diff: *mut c_int) -> c_int;
    fn lsquic_engine_send_unsent_packets(e: *mut lsquic_engine_t);
    fn lsquic_engine_packet_in(
        e: *mut lsquic_engine_t,
        data: *const u8,
        len: usize,
        sa_local: *const sockaddr,
        sa_peer: *const sockaddr,
        peer_ctx: *mut c_void,
        ecn: c_int,
    ) -> c_int;
    fn lsquic_engine_cooldown(e: *mut lsquic_engine_t);
    fn lsquic_engine_connect(
        e: *mut lsquic_engine_t,
        version: c_int,
        local_sa: *const sockaddr,
        peer_sa: *const sockaddr,
        peer_ctx: *mut c_void,
        conn_ctx: *mut c_void,
        sni: *const c_char,
        base_plpmtu: c_ushort,
        sess_resume: *const u8,
        sess_resume_len: usize,
        token: *const u8,
        token_sz: usize,
    ) -> *mut lsquic_conn_t;

    fn lsquic_conn_close(c: *mut lsquic_conn_t);
    fn lsquic_conn_get_ctx(c: *mut lsquic_conn_t) -> *mut c_void;
    fn lsquic_conn_set_ctx(c: *mut lsquic_conn_t, ctx: *mut c_void);
    fn lsquic_conn_make_stream(c: *mut lsquic_conn_t);
    fn lsquic_conn_n_avail_streams(c: *const lsquic_conn_t) -> c_uint;
    fn lsquic_conn_status(c: *mut lsquic_conn_t, buf: *mut c_char, len: usize) -> c_int;
    fn lsquic_conn_get_sockaddr(
        c: *mut lsquic_conn_t,
        local: *mut *const sockaddr,
        peer: *mut *const sockaddr,
    ) -> c_int;

    fn lsquic_stream_wantread(s: *mut lsquic_stream_t, want: c_int) -> c_int;
    fn lsquic_stream_wantwrite(s: *mut lsquic_stream_t, want: c_int) -> c_int;
    fn lsquic_stream_read(s: *mut lsquic_stream_t, buf: *mut c_void, len: usize) -> ssize_t;
    fn lsquic_stream_write(s: *mut lsquic_stream_t, buf: *const c_void, len: usize) -> ssize_t;
    fn lsquic_stream_flush(s: *mut lsquic_stream_t) -> c_int;
    fn lsquic_stream_shutdown(s: *mut lsquic_stream_t, how: c_int) -> c_int;
    fn lsquic_stream_close(s: *mut lsquic_stream_t) -> c_int;
    fn lsquic_stream_send_headers(
        s: *mut lsquic_stream_t,
        headers: *const lsquic_http_headers,
        eos: c_int,
    ) -> c_int;
    fn lsquic_stream_get_hset(s: *mut lsquic_stream_t) -> *mut c_void;
    fn lsquic_stream_conn(s: *const lsquic_stream_t) -> *mut lsquic_conn_t;
    fn lsquic_stream_has_unacked_data(s: *mut lsquic_stream_t) -> c_int;
    // Internal symbol (not in public header).
    fn lsquic_stream_maybe_reset(s: *mut lsquic_stream_t, error_code: u64, do_close: c_int);
    fn lsquic_ssl_to_conn(ssl: *const SSL) -> *mut lsquic_conn_t;

    #[cfg(debug_assertions)]
    fn lsquic_logger_init(logger: *const lsquic_logger_if, ctx: *mut c_void, ts: c_int);
    #[cfg(debug_assertions)]
    fn lsquic_set_log_level(level: *const c_char) -> c_int;
}

// ═══════════════════════════════════════════════════════════════════════════
// BoringSSL / usockets externs not covered by types.rs
// ═══════════════════════════════════════════════════════════════════════════

type ssl_verify_result_t = c_int;
const ssl_verify_ok: ssl_verify_result_t = 0;
const ssl_verify_invalid: ssl_verify_result_t = 1;
const TLS1_3_VERSION: u16 = 0x0304;
const X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS: c_uint = 0x4;

unsafe extern "C" {
    fn TLS_method() -> *const SSL_METHOD;
    fn SSL_CTX_set_min_proto_version(ctx: *mut SSL_CTX, version: u16) -> c_int;
    fn SSL_CTX_set_max_proto_version(ctx: *mut SSL_CTX, version: u16) -> c_int;
    fn SSL_CTX_set_early_data_enabled(ctx: *mut SSL_CTX, enabled: c_int);
    fn SSL_CTX_set_cert_store(ctx: *mut SSL_CTX, store: *mut X509_STORE);
    fn SSL_CTX_set_custom_verify(
        ctx: *mut SSL_CTX,
        mode: c_int,
        cb: Option<unsafe extern "C" fn(*mut SSL, *mut u8) -> ssl_verify_result_t>,
    );
    fn SSL_CTX_get_cert_store(ctx: *const SSL_CTX) -> *mut X509_STORE;
    fn SSL_get_peer_full_cert_chain(ssl: *const SSL) -> *mut struct_stack_st_X509;
    fn X509_STORE_CTX_new() -> *mut X509_STORE_CTX;
    fn X509_STORE_CTX_init(
        ctx: *mut X509_STORE_CTX,
        store: *mut X509_STORE,
        x509: *mut X509,
        chain: *mut struct_stack_st_X509,
    ) -> c_int;
    fn X509_STORE_CTX_set_default(ctx: *mut X509_STORE_CTX, name: *const c_char) -> c_int;
    fn X509_verify_cert(ctx: *mut X509_STORE_CTX) -> c_int;
    fn X509_STORE_CTX_free(ctx: *mut X509_STORE_CTX);
    fn X509_check_host(
        x: *mut X509,
        chk: *const c_char,
        chklen: usize,
        flags: c_uint,
        peername: *mut *mut c_char,
    ) -> c_int;
    fn X509_check_ip_asc(x: *mut X509, ipasc: *const c_char, flags: c_uint) -> c_int;
    // `sk_num`/`sk_value` — BoringSSL exposes `STACK_OF(X509)` only via these.
    fn sk_num(sk: *const c_void) -> usize;
    fn sk_value(sk: *const c_void, i: usize) -> *mut c_void;

    // From other usockets units / Bun runtime.
    fn us_ssl_ctx_build_raw(
        options: us_bun_socket_context_options_t,
        err: *mut c_int,
    ) -> *mut SSL_CTX;
    fn us_get_default_ca_store() -> *mut X509_STORE;
}

// Platform network externs.
#[cfg(not(windows))]
unsafe extern "C" {
    fn inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
    fn getsockname(fd: c_int, addr: *mut sockaddr, len: *mut socklen_t) -> c_int;
    fn setsockopt(
        fd: c_int,
        level: c_int,
        name: c_int,
        val: *const c_void,
        len: socklen_t,
    ) -> c_int;
    fn connect(fd: c_int, addr: *const sockaddr, len: socklen_t) -> c_int;
}
#[cfg(windows)]
#[link(name = "ws2_32")]
unsafe extern "system" {
    fn inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
    fn getsockname(s: LIBUS_SOCKET_DESCRIPTOR, name: *mut sockaddr, namelen: *mut c_int) -> c_int;
    fn setsockopt(
        s: LIBUS_SOCKET_DESCRIPTOR,
        level: c_int,
        optname: c_int,
        optval: *const c_char,
        optlen: c_int,
    ) -> c_int;
    fn sendto(
        s: LIBUS_SOCKET_DESCRIPTOR,
        buf: *const c_char,
        len: c_int,
        flags: c_int,
        to: *const sockaddr,
        tolen: c_int,
    ) -> c_int;
    fn WSAGetLastError() -> c_int;
    fn WSAIoctl(
        s: LIBUS_SOCKET_DESCRIPTOR,
        dwIoControlCode: u32,
        lpvInBuffer: *mut c_void,
        cbInBuffer: u32,
        lpvOutBuffer: *mut c_void,
        cbOutBuffer: u32,
        lpcbBytesReturned: *mut u32,
        lpOverlapped: *mut c_void,
        lpCompletionRoutine: *mut c_void,
    ) -> c_int;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public header types / our own structs
// ═══════════════════════════════════════════════════════════════════════════

const US_QUIC_READ_BUF: usize = 16 * 1024;

/// One name/value pair pointing into stream-owned storage. `qpack_index` is
/// an optional `enum lsqpack_tnv` hint (0..98); -1 = no hint.
#[repr(C)]
pub struct us_quic_header_t {
    pub name: *const c_char,
    pub name_len: c_uint,
    pub value: *const c_char,
    pub value_len: c_uint,
    pub qpack_index: c_int,
}

/// Incoming header set: contiguous storage + index. Created before the stream
/// object exists, so it lives standalone until on_read claims it.
#[repr(C)]
struct us_quic_hset {
    buf: *mut c_char,
    len: c_uint,
    cap: c_uint,
    scratch: lsxpack_header,
    headers: *mut us_quic_header_t,
    count: c_uint,
    hcap: c_uint,
}

#[repr(C)]
struct us_quic_sni {
    name: *mut c_char,
    ctx: *mut SSL_CTX,
}

type on_open_cb = Option<unsafe extern "C" fn(*mut us_quic_socket_t)>;
type on_hsk_done_cb = Option<unsafe extern "C" fn(*mut us_quic_socket_t, c_int)>;
type on_stream_open_cb = Option<unsafe extern "C" fn(*mut us_quic_stream_t, c_int)>;
type on_stream_hdr_cb = Option<unsafe extern "C" fn(*mut us_quic_stream_t)>;
type on_stream_data_cb =
    Option<unsafe extern "C" fn(*mut us_quic_stream_t, *const c_char, c_uint, c_int)>;

#[repr(C)]
pub struct us_quic_socket_context_t {
    loop_: *mut us_loop_t,
    engine: *mut lsquic_engine_t,
    settings: lsquic_engine_settings,
    ssl_ctx: *mut SSL_CTX,
    sni: *mut us_quic_sni,
    sni_count: c_uint,
    sni_cap: c_uint,
    processing: c_int,
    closing: c_int,
    is_client: c_int,
    conn_count: c_uint,
    conn_ext_size: c_uint,
    /// Stream bytes written since the last process_conns. Once this exceeds
    /// roughly one full sendmmsg(64) batch, flush immediately instead of
    /// waiting for loop_post.
    pending_write_bytes: c_uint,
    next: *mut us_quic_socket_context_t,
    stream_ext_size: c_uint,
    /// Listen sockets stay reachable as lsquic peer_ctx after the UDP fd
    /// closes; defer freeing until the engine itself is torn down.
    listeners: *mut us_quic_listen_socket_t,
    closed_listeners: *mut us_quic_listen_socket_t,
    client_udp: *mut us_quic_listen_socket_t,
    /// Live conns, so listen_socket_close can lsquic_conn_close each one
    /// before the UDP fd disappears.
    conns: *mut us_quic_socket_t,

    on_open: on_open_cb,
    on_hsk_done: on_hsk_done_cb,
    on_goaway: on_open_cb,
    on_close: on_open_cb,
    on_stream_open: on_stream_open_cb,
    on_stream_headers: on_stream_hdr_cb,
    on_stream_data: on_stream_data_cb,
    on_stream_writable: on_stream_hdr_cb,
    on_stream_close: on_stream_hdr_cb,

    read_buf: [c_char; US_QUIC_READ_BUF],
    // ext follows
}

#[repr(C)]
pub struct us_quic_listen_socket_t {
    udp: *mut us_udp_socket_t,
    ctx: *mut us_quic_socket_context_t,
    local: sockaddr_storage,
    next: *mut us_quic_listen_socket_t,
}

#[repr(C)]
pub struct us_quic_socket_t {
    conn: *mut lsquic_conn_t,
    ctx: *mut us_quic_socket_context_t,
    next: *mut us_quic_socket_t,
    reject_unauthorized: c_int,
    going_away: c_int,
    hostname: *mut c_char,
    // ext follows
}

#[repr(C)]
pub struct us_quic_stream_t {
    stream: *mut lsquic_stream_t,
    ctx: *mut us_quic_socket_context_t,
    hset: *mut us_quic_hset,
    headers_delivered: c_int,
    fin_delivered: c_int,
    // ext follows
}

#[repr(C)]
pub struct us_quic_pending_connect_s {
    ctx: *mut us_quic_socket_context_t,
    sni: *mut c_char,
    port: c_int,
    reject_unauthorized: c_int,
    ai_req: *mut addrinfo_request,
    user: *mut c_void,
}

// ═══════════════════════════════════════════════════════════════════════════
// Process driver
//
// lsquic_engine_process_conns is the only call that turns queued stream writes
// into UDP packets. It is driven from us_internal_loop_pre/post plus lsquic's
// time-driven state folded into the epoll_pwait2 timeout via quic_next_tick_us.
// ═══════════════════════════════════════════════════════════════════════════

#[inline(always)]
unsafe fn loop_quic_head(loop_: *mut us_loop_t) -> *mut us_quic_socket_context_t {
    // SAFETY: `loop_` is live; quic_head is the opaque typedef of our context.
    unsafe { (*loop_).data.quic_head.cast() }
}

#[cfg(windows)]
unsafe extern "C" fn us_quic_on_timer(t: *mut us_timer_t) {
    // SAFETY: `t` is the loop's fallthrough timer, always live.
    unsafe { us_quic_loop_process(us_timer_loop(t)) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_loop_process(loop_: *mut us_loop_t) {
    // SAFETY: caller owns the loop; engines in the list are live.
    unsafe {
        let mut min_diff: c_int = 0;
        let mut have_tick = false;
        let mut ctx = loop_quic_head(loop_);
        while !ctx.is_null() {
            if (*ctx).processing == 0 && !(*ctx).engine.is_null() {
                (*ctx).processing = 1;
                (*ctx).pending_write_bytes = 0;
                lsquic_engine_process_conns((*ctx).engine);
                (*ctx).processing = 0;
                let mut diff: c_int = 0;
                if lsquic_engine_earliest_adv_tick((*ctx).engine, &mut diff) != 0 {
                    if !have_tick || diff < min_diff {
                        min_diff = diff;
                    }
                    have_tick = true;
                }
            }
            ctx = (*ctx).next;
        }
        // Relative µs from now (≤0 means "tick due"). getTimeout() folds this
        // into the epoll_pwait2 timeout on epoll/kqueue; libuv uses a uv_timer.
        (*loop_).data.quic_next_tick_us = if have_tick {
            if min_diff < 0 { 0 } else { min_diff as _ }
        } else {
            -1
        };
        #[cfg(windows)]
        if have_tick {
            if (*loop_).data.quic_timer.is_null() {
                (*loop_).data.quic_timer = us_create_timer(loop_, 1, 0);
            }
            let ms = if min_diff <= 0 {
                1
            } else {
                (min_diff + 999) / 1000
            };
            us_timer_set((*loop_).data.quic_timer, Some(us_quic_on_timer), ms, 0);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_loop_flush_if_pending(loop_: *mut us_loop_t) {
    // SAFETY: caller owns the loop.
    unsafe {
        let mut ctx = loop_quic_head(loop_);
        while !ctx.is_null() {
            if (*ctx).pending_write_bytes != 0 && (*ctx).processing == 0 {
                us_quic_loop_process(loop_);
                return;
            }
            ctx = (*ctx).next;
        }
    }
}

unsafe fn us_quic_process(ctx: *mut us_quic_socket_context_t) {
    // SAFETY: `ctx` is live; re-entrancy guard via `processing`.
    unsafe {
        if (*ctx).processing != 0 || (*ctx).engine.is_null() {
            return;
        }
        (*ctx).processing = 1;
        lsquic_engine_process_conns((*ctx).engine);
        (*ctx).processing = 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Packets out
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(windows)]
unsafe fn us_quic_send_one(fd: LIBUS_SOCKET_DESCRIPTOR, spec: *const lsquic_out_spec) -> c_int {
    // SAFETY: `spec` points into lsquic's batch array for the duration of the call.
    unsafe {
        // Winsock has no sendmsg; sendto takes one buffer. iovlen is 1 for every
        // post-handshake packet; coalesced Initial+Handshake can be 2-3 iovecs
        // but never exceeds one MTU, so flatten into a small stack buffer.
        let mut flat = [0u8; 2048];
        let (buf, len): (*const c_char, c_int);
        if (*spec).iovlen == 1 {
            buf = (*(*spec).iov).iov_base as *const c_char;
            len = (*(*spec).iov).iov_len as c_int;
        } else {
            let mut off = 0usize;
            for i in 0..(*spec).iovlen {
                let v = (*spec).iov.add(i);
                if off + (*v).iov_len > flat.len() {
                    set_errno(libc::EMSGSIZE);
                    return -1;
                }
                ptr::copy_nonoverlapping(
                    (*v).iov_base as *const u8,
                    flat.as_mut_ptr().add(off),
                    (*v).iov_len,
                );
                off += (*v).iov_len;
            }
            buf = flat.as_ptr() as *const c_char;
            len = off as c_int;
        }
        let r = sendto(fd, buf, len, 0, (*spec).dest_sa, sa_len((*spec).dest_sa));
        if r < 0 {
            const WSAEWOULDBLOCK: c_int = 10035;
            set_errno(if WSAGetLastError() == WSAEWOULDBLOCK {
                libc::EAGAIN
            } else {
                libc::EIO
            });
            return -1;
        }
        1
    }
}

#[cfg(all(not(windows), not(any(target_os = "linux", target_os = "android"))))]
unsafe fn us_quic_send_one(fd: LIBUS_SOCKET_DESCRIPTOR, spec: *const lsquic_out_spec) -> c_int {
    // SAFETY: `spec` valid for call; retry on EINTR.
    unsafe {
        let mut msg: libc::msghdr = zeroed();
        msg.msg_name = (*spec).dest_sa as *mut c_void;
        msg.msg_namelen = sa_len((*spec).dest_sa);
        msg.msg_iov = (*spec).iov.cast();
        msg.msg_iovlen = (*spec).iovlen as _;
        let r = loop {
            let r = libc::sendmsg(fd, &msg, 0);
            if !(r < 0 && errno() == libc::EINTR) {
                break r;
            }
        };
        if r < 0 { -1 } else { 1 }
    }
}

/// lsquic hands back packets in batches; on Linux push them through one
/// sendmmsg() so a 32-packet flight is a single syscall.
unsafe extern "C" fn us_quic_packets_out(
    _out_ctx: *mut c_void,
    specs: *const lsquic_out_spec,
    n: c_uint,
) -> c_int {
    // SAFETY: specs[0..n] are valid for the call; peer_ctx points to our listen socket.
    unsafe {
        let mut sent: c_uint = 0;

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            const BATCH: usize = 64;
            let mut mm: [libc::mmsghdr; BATCH] = [zeroed(); BATCH];
            while sent < n {
                let ls = (*specs.add(sent as usize)).peer_ctx as *mut us_quic_listen_socket_t;
                if (*ls).udp.is_null() {
                    set_errno(libc::EBADF);
                    break;
                }
                let fd = us_poll_fd((*ls).udp.cast::<us_poll_t>());
                let mut k: c_uint = 0;
                while (k as usize) < BATCH
                    && sent + k < n
                    && (*specs.add((sent + k) as usize)).peer_ctx == ls.cast()
                {
                    let sp = specs.add((sent + k) as usize);
                    mm[k as usize] = zeroed();
                    mm[k as usize].msg_hdr.msg_name = (*sp).dest_sa as *mut c_void;
                    mm[k as usize].msg_hdr.msg_namelen = sa_len((*sp).dest_sa);
                    mm[k as usize].msg_hdr.msg_iov = (*sp).iov.cast();
                    mm[k as usize].msg_hdr.msg_iovlen = (*sp).iovlen as _;
                    k += 1;
                }
                let r = loop {
                    let r = libc::sendmmsg(fd, mm.as_mut_ptr(), k, 0);
                    if !(r < 0 && errno() == libc::EINTR) {
                        break r;
                    }
                };
                if r < 0 {
                    break;
                }
                sent += r as c_uint;
                // Short return: loop instead of breaking; `sent` advanced so the
                // retry's first message consumes any stale ICMP error or succeeds.
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        while sent < n {
            let ls = (*specs.add(sent as usize)).peer_ctx as *mut us_quic_listen_socket_t;
            if (*ls).udp.is_null() {
                set_errno(libc::EBADF);
                break;
            }
            if us_quic_send_one(
                us_poll_fd((*ls).udp.cast::<us_poll_t>()),
                specs.add(sent as usize),
            ) < 0
            {
                break;
            }
            sent += 1;
        }

        if sent < n {
            // lsquic only treats EAGAIN/EWOULDBLOCK as backpressure; map any
            // other send error to EAGAIN so the engine pauses and retries via
            // on_drain → send_unsent_packets.
            let e = errno();
            if e != libc::EAGAIN && e != libc::EWOULDBLOCK {
                set_errno(libc::EAGAIN);
            }
            let ls = (*specs.add(sent as usize)).peer_ctx as *mut us_quic_listen_socket_t;
            if !(*ls).udp.is_null() {
                us_poll_change(
                    (*ls).udp.cast::<us_poll_t>(),
                    (*(*ls).ctx).loop_,
                    LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE,
                );
            }
        }
        sent as c_int
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UDP callbacks
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" fn us_quic_udp_on_data(u: *mut us_udp_socket_t, recvbuf: *mut c_void, n: c_int) {
    // SAFETY: `u` is live; `recvbuf` is a `us_udp_packet_buffer_t`.
    unsafe {
        let ls = us_udp_socket_user(u) as *mut us_quic_listen_socket_t;
        let ctx = (*ls).ctx;
        if (*ctx).engine.is_null() {
            return;
        }
        let buf = recvbuf as *mut us_udp_packet_buffer_t;
        for i in 0..n {
            let payload = us_udp_packet_buffer_payload(buf, i);
            let len = us_udp_packet_buffer_payload_length(buf, i);
            let peer = us_udp_packet_buffer_peer(buf, i) as *const sockaddr;
            lsquic_engine_packet_in(
                (*ctx).engine,
                payload as *const u8,
                len as usize,
                ptr::addr_of!((*ls).local).cast(),
                peer,
                ls.cast(),
                0,
            );
        }
        // Don't process here — let loop_post run a single process_conns so all
        // of this iteration's writes go out in one sendmmsg batch.
    }
}

unsafe extern "C" fn us_quic_udp_on_drain(u: *mut us_udp_socket_t) {
    // SAFETY: `u` is live while the callback runs.
    unsafe {
        let ls = us_udp_socket_user(u) as *mut us_quic_listen_socket_t;
        if !(*(*ls).ctx).engine.is_null() {
            lsquic_engine_send_unsent_packets((*(*ls).ctx).engine);
        }
    }
}

unsafe extern "C" fn us_quic_udp_on_close(u: *mut us_udp_socket_t) {
    // SAFETY: `u` is live; lsquic still holds `ls` as peer_ctx so free is deferred.
    unsafe {
        let ls = us_udp_socket_user(u) as *mut us_quic_listen_socket_t;
        let ctx = (*ls).ctx;
        (*ls).udp = ptr::null_mut();
        if (*ctx).client_udp == ls {
            (*ctx).client_udp = ptr::null_mut();
        }
        let mut pp = ptr::addr_of_mut!((*ctx).listeners);
        while !(*pp).is_null() {
            if *pp == ls {
                *pp = (*ls).next;
                break;
            }
            pp = ptr::addr_of_mut!((**pp).next);
        }
        (*ls).next = (*ctx).closed_listeners;
        (*ctx).closed_listeners = ls;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SSL
// ═══════════════════════════════════════════════════════════════════════════

/// Exact match, then `*.tail` wildcards (matches "a.tail" but not "tail").
unsafe fn us_quic_match_sni(
    ctx: *mut us_quic_socket_context_t,
    sni: *const c_char,
) -> *mut SSL_CTX {
    // SAFETY: ctx->sni[0..sni_count] are valid strdup'd C strings.
    unsafe {
        if sni.is_null() {
            return (*ctx).ssl_ctx;
        }
        let sl = libc::strlen(sni);
        for i in 0..(*ctx).sni_count {
            let e = (*ctx).sni.add(i as usize);
            if libc::strcmp((*e).name, sni) == 0 {
                return (*e).ctx;
            }
        }
        for i in 0..(*ctx).sni_count {
            let e = (*ctx).sni.add(i as usize);
            let n = (*e).name;
            if *n == b'*' as c_char && *n.add(1) == b'.' as c_char {
                let tl = libc::strlen(n.add(1));
                if sl > tl && libc::memcmp(sni.add(sl - tl).cast(), n.add(1).cast(), tl) == 0 {
                    return (*e).ctx;
                }
            }
        }
        (*ctx).ssl_ctx
    }
}

unsafe extern "C" fn us_quic_get_ssl_ctx(
    peer_ctx: *mut c_void,
    _local: *const sockaddr,
) -> *mut SSL_CTX {
    // SAFETY: peer_ctx is our `us_quic_listen_socket_t*`.
    unsafe { (*(*(peer_ctx as *mut us_quic_listen_socket_t)).ctx).ssl_ctx }
}

unsafe extern "C" fn us_quic_lookup_cert(
    cert_ctx: *mut c_void,
    _local: *const sockaddr,
    sni: *const c_char,
) -> *mut SSL_CTX {
    // SAFETY: cert_ctx is our `us_quic_socket_context_t*`.
    unsafe { us_quic_match_sni(cert_ctx.cast(), sni) }
}

unsafe extern "C" fn us_quic_alpn_select(
    _ssl: *mut SSL,
    out: *mut *const u8,
    outlen: *mut u8,
    in_: *const u8,
    inlen: c_uint,
    _arg: *mut c_void,
) -> c_int {
    // SAFETY: `in_` is the client's 1-byte-length-prefixed ALPN list.
    unsafe {
        let mut i: c_uint = 0;
        while i + 1 <= inlen {
            let n = *in_.add(i as usize) as c_uint;
            if i + 1 + n > inlen {
                break;
            }
            let p = in_.add((i + 1) as usize);
            if (n == 2 && *p == b'h' && *p.add(1) == b'3')
                || (n >= 3 && *p == b'h' && *p.add(1) == b'3' && *p.add(2) == b'-')
            {
                *out = p;
                *outlen = n as u8;
                return SSL_TLSEXT_ERR_OK;
            }
            i += 1 + n;
        }
        SSL_TLSEXT_ERR_ALERT_FATAL
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Header-set interface (lsquic_hset_if callbacks)
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" fn us_quic_hsi_create(
    _hsi_ctx: *mut c_void,
    _s: *mut lsquic_stream_t,
    _is_push: c_int,
) -> *mut c_void {
    // SAFETY: lsquic treats NULL as allocation failure.
    unsafe { libc::calloc(1, size_of::<us_quic_hset>()) }
}

unsafe extern "C" fn us_quic_hsi_prepare(
    hset_p: *mut c_void,
    mut hdr: *mut lsxpack_header,
    space: usize,
) -> *mut lsxpack_header {
    // SAFETY: `hset_p` was produced by `us_quic_hsi_create`.
    unsafe {
        let h = hset_p as *mut us_quic_hset;
        if space > 64 * 1024 {
            return ptr::null_mut();
        }
        let need = (*h).len + space as c_uint;
        if need > (*h).cap {
            let mut ncap = if (*h).cap != 0 { (*h).cap } else { 512 };
            while ncap < need {
                ncap *= 2;
            }
            let nb = libc::realloc((*h).buf.cast(), ncap as usize) as *mut c_char;
            if nb.is_null() {
                return ptr::null_mut();
            }
            (*h).buf = nb;
            (*h).cap = ncap;
        }
        if hdr.is_null() {
            hdr = ptr::addr_of_mut!((*h).scratch);
            *hdr = zeroed();
            (*hdr).buf = (*h).buf;
            (*hdr).name_offset = (*h).len as i32;
            (*hdr).val_len = if space > u16::MAX as usize {
                u16::MAX
            } else {
                space as u16
            };
        } else {
            // Resize: lsqpack already wrote part of name/value into the previous
            // buffer; only the storage may move.
            (*hdr).buf = (*h).buf;
            (*hdr).val_len = space as u16;
        }
        hdr
    }
}

unsafe extern "C" fn us_quic_hsi_process(hset_p: *mut c_void, hdr: *mut lsxpack_header) -> c_int {
    // SAFETY: `hset_p` is our allocation; `hdr` points at `scratch` or NULL.
    unsafe {
        let h = hset_p as *mut us_quic_hset;
        if hdr.is_null() {
            return 0; // end of headers
        }
        if (*h).count == (*h).hcap {
            let ncap = if (*h).hcap != 0 { (*h).hcap * 2 } else { 16 };
            let nh = libc::realloc(
                (*h).headers.cast(),
                ncap as usize * size_of::<us_quic_header_t>(),
            ) as *mut us_quic_header_t;
            if nh.is_null() {
                return -1;
            }
            (*h).headers = nh;
            (*h).hcap = ncap;
        }
        // Record offsets (cast into pointer-sized field); resolved after the
        // buffer stops moving in hset_finalize.
        let e = (*h).headers.add((*h).count as usize);
        (*e).name = (*hdr).name_offset as usize as *const c_char;
        (*e).name_len = (*hdr).name_len as c_uint;
        (*e).value = (*hdr).val_offset as usize as *const c_char;
        (*e).value_len = (*hdr).val_len as c_uint;
        (*e).qpack_index = -1;
        (*h).count += 1;
        (*h).len =
            (*hdr).val_offset as c_uint + (*hdr).val_len as c_uint + (*hdr).dec_overhead as c_uint;
        0
    }
}

unsafe fn us_quic_hset_finalize(h: *mut us_quic_hset) {
    // SAFETY: `h->buf` is final; convert stored offsets to pointers.
    unsafe {
        for i in 0..(*h).count {
            let e = (*h).headers.add(i as usize);
            (*e).name = (*h).buf.add((*e).name as usize);
            (*e).value = (*h).buf.add((*e).value as usize);
        }
    }
}

unsafe fn us_quic_hset_free(h: *mut us_quic_hset) {
    // SAFETY: `h` owns `buf` and `headers`; all came from libc alloc.
    unsafe {
        if h.is_null() {
            return;
        }
        libc::free((*h).buf.cast());
        libc::free((*h).headers.cast());
        libc::free(h.cast());
    }
}

unsafe extern "C" fn us_quic_hsi_discard(hset_p: *mut c_void) {
    unsafe { us_quic_hset_free(hset_p.cast()) }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stream interface (lsquic_stream_if callbacks)
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" fn us_quic_on_new_conn(
    if_ctx: *mut c_void,
    conn: *mut lsquic_conn_t,
) -> *mut c_void {
    // SAFETY: `if_ctx` is our socket context; `conn` is live.
    unsafe {
        let ctx = if_ctx as *mut us_quic_socket_context_t;
        if (*ctx).closing != 0 {
            lsquic_conn_close(conn);
            return ptr::null_mut();
        }
        let qs = libc::calloc(
            1,
            size_of::<us_quic_socket_t>() + (*ctx).conn_ext_size as usize,
        ) as *mut us_quic_socket_t;
        if qs.is_null() {
            return ptr::null_mut();
        }
        (*qs).conn = conn;
        (*qs).ctx = ctx;
        // QUIC connections share one UDP fd, so they aren't real polls. Count
        // each as a virtual poll so the loop stays alive while conns are open.
        #[cfg(not(windows))]
        {
            (*(*ctx).loop_).num_polls += 1;
        }
        (*ctx).conn_count += 1;
        (*qs).next = (*ctx).conns;
        (*ctx).conns = qs;
        if let Some(cb) = (*ctx).on_open {
            cb(qs);
        }
        qs.cast()
    }
}

unsafe extern "C" fn us_quic_on_conn_closed(conn: *mut lsquic_conn_t) {
    // SAFETY: our ctx pointer was stashed by on_new_conn.
    unsafe {
        let qs = lsquic_conn_get_ctx(conn) as *mut us_quic_socket_t;
        if qs.is_null() {
            return;
        }
        let ctx = (*qs).ctx;
        if let Some(cb) = (*ctx).on_close {
            cb(qs);
        }
        lsquic_conn_set_ctx(conn, ptr::null_mut());
        let mut pp = ptr::addr_of_mut!((*ctx).conns);
        while !(*pp).is_null() {
            if *pp == qs {
                *pp = (*qs).next;
                break;
            }
            pp = ptr::addr_of_mut!((**pp).next);
        }
        libc::free((*qs).hostname.cast());
        libc::free(qs.cast());
        #[cfg(not(windows))]
        {
            (*(*ctx).loop_).num_polls -= 1;
        }
        (*ctx).conn_count -= 1;
        // During graceful drain the UDP fd is the only thing left holding the
        // loop; release it when the last conn closes so the process can exit.
        if (*ctx).closing != 0 && (*ctx).conn_count == 0 {
            while !(*ctx).listeners.is_null() {
                us_udp_socket_close((*(*ctx).listeners).udp);
            }
        }
    }
}

unsafe extern "C" fn us_quic_on_hsk_done(conn: *mut lsquic_conn_t, st: c_int) {
    unsafe {
        let qs = lsquic_conn_get_ctx(conn) as *mut us_quic_socket_t;
        if qs.is_null() {
            return;
        }
        if let Some(cb) = (*(*qs).ctx).on_hsk_done {
            cb(qs, (st == LSQ_HSK_OK || st == LSQ_HSK_RESUMED_OK) as c_int);
        }
    }
}

unsafe extern "C" fn us_quic_on_goaway_received(conn: *mut lsquic_conn_t) {
    unsafe {
        let qs = lsquic_conn_get_ctx(conn) as *mut us_quic_socket_t;
        if qs.is_null() {
            return;
        }
        (*qs).going_away = 1;
        if let Some(cb) = (*(*qs).ctx).on_goaway {
            cb(qs);
        }
    }
}

unsafe extern "C" fn us_quic_on_new_stream(
    if_ctx: *mut c_void,
    stream: *mut lsquic_stream_t,
) -> *mut c_void {
    unsafe {
        let ctx = if_ctx as *mut us_quic_socket_context_t;
        if stream.is_null() {
            return ptr::null_mut(); // going-away
        }
        let s = libc::calloc(
            1,
            size_of::<us_quic_stream_t>() + (*ctx).stream_ext_size as usize,
        ) as *mut us_quic_stream_t;
        if s.is_null() {
            lsquic_stream_close(stream);
            return ptr::null_mut();
        }
        (*s).stream = stream;
        (*s).ctx = ctx;
        if let Some(cb) = (*ctx).on_stream_open {
            cb(s, (*ctx).is_client);
        }
        lsquic_stream_wantread(stream, 1);
        s.cast()
    }
}

unsafe extern "C" fn us_quic_on_read(stream: *mut lsquic_stream_t, h: *mut c_void) {
    unsafe {
        let s = h as *mut us_quic_stream_t;
        let ctx = (*s).ctx;

        // lsquic queues a fresh hset for every HEADERS block (1xx interims,
        // the final response, trailers); re-dispatch each time.
        let hset = lsquic_stream_get_hset(stream) as *mut us_quic_hset;
        if !hset.is_null() {
            us_quic_hset_finalize(hset);
            us_quic_hset_free((*s).hset);
            (*s).hset = hset;
            (*s).headers_delivered = 1;
            if let Some(cb) = (*ctx).on_stream_headers {
                cb(s);
            }
            if (*s).stream.is_null() {
                return;
            }
        }

        let buf = (*ctx).read_buf.as_mut_ptr();
        loop {
            let r = lsquic_stream_read(stream, buf.cast(), US_QUIC_READ_BUF);
            if r > 0 {
                if let Some(cb) = (*ctx).on_stream_data {
                    cb(s, buf, r as c_uint, 0);
                }
                if (*s).stream.is_null() {
                    return;
                }
                continue;
            }
            if r == 0 && (*s).fin_delivered == 0 {
                (*s).fin_delivered = 1;
                lsquic_stream_wantread(stream, 0);
                lsquic_stream_shutdown(stream, 0);
                if let Some(cb) = (*ctx).on_stream_data {
                    cb(s, buf, 0, 1);
                }
            }
            break;
        }
    }
}

unsafe extern "C" fn us_quic_on_write(stream: *mut lsquic_stream_t, h: *mut c_void) {
    unsafe {
        let s = h as *mut us_quic_stream_t;
        lsquic_stream_wantwrite(stream, 0);
        if let Some(cb) = (*(*s).ctx).on_stream_writable {
            cb(s);
        }
    }
}

unsafe extern "C" fn us_quic_on_close(_stream: *mut lsquic_stream_t, h: *mut c_void) {
    unsafe {
        let s = h as *mut us_quic_stream_t;
        if s.is_null() {
            return;
        }
        if let Some(cb) = (*(*s).ctx).on_stream_close {
            cb(s);
        }
        (*s).stream = ptr::null_mut();
        us_quic_hset_free((*s).hset);
        libc::free(s.cast());
    }
}

unsafe extern "C" fn us_quic_on_reset(stream: *mut lsquic_stream_t, h: *mut c_void, how: c_int) {
    // how=0 → peer RESET_STREAM (read half gone): close so on_stream_close fires.
    // how=1 → peer STOP_SENDING: lsquic already queues RESET_STREAM; keep read open.
    unsafe {
        if !h.is_null() && !stream.is_null() && how == 0 {
            lsquic_stream_close(stream);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Static tables
// ═══════════════════════════════════════════════════════════════════════════

static US_QUIC_STREAM_IF: lsquic_stream_if = lsquic_stream_if {
    on_new_conn: Some(us_quic_on_new_conn),
    on_goaway_received: Some(us_quic_on_goaway_received),
    on_conn_closed: Some(us_quic_on_conn_closed),
    on_new_stream: Some(us_quic_on_new_stream),
    on_read: Some(us_quic_on_read),
    on_write: Some(us_quic_on_write),
    on_close: Some(us_quic_on_close),
    on_dg_write: None,
    on_datagram: None,
    on_hsk_done: Some(us_quic_on_hsk_done),
    on_new_token: None,
    on_sess_resume_info: None,
    on_reset: Some(us_quic_on_reset),
    on_conncloseframe_received: None,
};

static US_QUIC_HSET_IF: lsquic_hset_if = lsquic_hset_if {
    hsi_create_header_set: Some(us_quic_hsi_create),
    hsi_prepare_decode: Some(us_quic_hsi_prepare),
    hsi_process_header: Some(us_quic_hsi_process),
    hsi_discard_header_set: Some(us_quic_hsi_discard),
    hsi_flags: 0,
};

#[cfg(debug_assertions)]
unsafe extern "C" fn us_quic_log_buf(_ctx: *mut c_void, buf: *const c_char, len: usize) -> c_int {
    // SAFETY: `buf` valid for `len` bytes; write to stderr (fd 2).
    unsafe {
        libc::write(2, buf.cast(), len as _);
        libc::write(2, b"\n".as_ptr().cast(), 1);
    }
    0
}
#[cfg(debug_assertions)]
static US_QUIC_LOGGER: lsquic_logger_if = lsquic_logger_if {
    log_buf: Some(us_quic_log_buf),
};

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_global_init() {
    // SAFETY: called once via a thread-safe static local in uws_h3_create_app.
    unsafe {
        lsquic_global_init(LSQUIC_GLOBAL_SERVER | LSQUIC_GLOBAL_CLIENT);
        #[cfg(debug_assertions)]
        if !libc::getenv(b"BUN_DEBUG_lsquic\0".as_ptr().cast()).is_null() {
            lsquic_logger_init(&US_QUIC_LOGGER, ptr::null_mut(), LLTS_HHMMSSUS);
            lsquic_set_log_level(b"debug\0".as_ptr().cast());
        }
    }
}

unsafe fn us_quic_prepare_ssl_ctx(ssl: *mut SSL_CTX) {
    // SAFETY: `ssl` is a fresh SSL_CTX we own.
    unsafe {
        SSL_CTX_set_min_proto_version(ssl, TLS1_3_VERSION);
        SSL_CTX_set_max_proto_version(ssl, TLS1_3_VERSION);
        SSL_CTX_set_alpn_select_cb(ssl, Some(us_quic_alpn_select), ptr::null_mut());
        SSL_CTX_set_early_data_enabled(ssl, 0);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_quic_socket_context(
    loop_: *mut us_loop_t,
    options: us_bun_socket_context_options_t,
    ext_size: c_uint,
    idle_timeout_s: c_uint,
) -> *mut us_quic_socket_context_t {
    // SAFETY: `loop_` is a live loop.
    unsafe {
        let mut ssl_err: c_int = 0;
        let ssl = us_ssl_ctx_build_raw(options, &mut ssl_err);
        if ssl.is_null() {
            return ptr::null_mut();
        }
        us_quic_prepare_ssl_ctx(ssl);

        let ctx = libc::calloc(1, size_of::<us_quic_socket_context_t>() + ext_size as usize)
            as *mut us_quic_socket_context_t;
        if ctx.is_null() {
            SSL_CTX_free(ssl);
            return ptr::null_mut();
        }
        (*ctx).loop_ = loop_;
        (*ctx).ssl_ctx = ssl;

        lsquic_engine_init_settings(ptr::addr_of_mut!((*ctx).settings), LSENG_HTTP_SERVER);
        (*ctx).settings.es_versions = LSQUIC_DF_VERSIONS & LSQUIC_IETF_VERSIONS;
        (*ctx).settings.es_ecn = 0;
        // Cap post-decode header size so a single request can't run hsi_prepare to OOM.
        (*ctx).settings.es_max_header_list_size = 16 * 1024;
        (*ctx).settings.es_init_max_streams_bidi = 100;
        // Static-table-only response encoding: skips per-header dynamic table search.
        (*ctx).settings.es_qpack_enc_max_size = 0;
        (*ctx).settings.es_qpack_enc_max_blocked = 0;
        (*ctx).settings.es_ext_http_prio = 0;
        if idle_timeout_s != 0 {
            (*ctx).settings.es_idle_timeout = if idle_timeout_s > 600 {
                600
            } else {
                idle_timeout_s
            };
        }

        let mut api: lsquic_engine_api = zeroed();
        api.ea_settings = ptr::addr_of!((*ctx).settings);
        api.ea_stream_if = &US_QUIC_STREAM_IF;
        api.ea_stream_if_ctx = ctx.cast();
        api.ea_packets_out = Some(us_quic_packets_out);
        api.ea_packets_out_ctx = ctx.cast();
        api.ea_get_ssl_ctx = Some(us_quic_get_ssl_ctx);
        api.ea_lookup_cert = Some(us_quic_lookup_cert);
        api.ea_cert_lu_ctx = ctx.cast();
        api.ea_hsi_if = &US_QUIC_HSET_IF;
        api.ea_hsi_ctx = ctx.cast();

        (*ctx).engine = lsquic_engine_new(LSENG_HTTP_SERVER, &api);
        if (*ctx).engine.is_null() {
            SSL_CTX_free(ssl);
            libc::free(ctx.cast());
            return ptr::null_mut();
        }

        (*ctx).next = loop_quic_head(loop_);
        (*loop_).data.quic_head = ctx.cast::<us_quic_socket_context_s>();
        ctx
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_add_server_name(
    ctx: *mut us_quic_socket_context_t,
    hostname: *const c_char,
    options: us_bun_socket_context_options_t,
) -> c_int {
    unsafe {
        let mut ssl_err: c_int = 0;
        let ssl = us_ssl_ctx_build_raw(options, &mut ssl_err);
        if ssl.is_null() {
            return -1;
        }
        us_quic_prepare_ssl_ctx(ssl);
        if (*ctx).sni_count == (*ctx).sni_cap {
            let ncap = if (*ctx).sni_cap != 0 {
                (*ctx).sni_cap * 2
            } else {
                4
            };
            let n = libc::realloc((*ctx).sni.cast(), ncap as usize * size_of::<us_quic_sni>())
                as *mut us_quic_sni;
            if n.is_null() {
                SSL_CTX_free(ssl);
                return -1;
            }
            (*ctx).sni = n;
            (*ctx).sni_cap = ncap;
        }
        let name = libc::strdup(hostname);
        if name.is_null() {
            SSL_CTX_free(ssl);
            return -1;
        }
        let e = (*ctx).sni.add((*ctx).sni_count as usize);
        (*e).name = name;
        (*e).ctx = ssl;
        (*ctx).sni_count += 1;
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_shutdown(ctx: *mut us_quic_socket_context_t) {
    unsafe {
        if ctx.is_null() || (*ctx).closing != 0 || (*ctx).engine.is_null() {
            return;
        }
        (*ctx).closing = 1;
        // GOAWAY every conn and flush; loop_post keeps ticking so in-flight
        // streams drain. New conns are rejected in on_new_conn while closing.
        lsquic_engine_cooldown((*ctx).engine);
        lsquic_engine_send_unsent_packets((*ctx).engine);
        us_quic_process(ctx);
        if (*ctx).conn_count == 0 {
            while !(*ctx).listeners.is_null() {
                us_udp_socket_close((*(*ctx).listeners).udp);
            }
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_free(ctx: *mut us_quic_socket_context_t) {
    unsafe {
        if ctx.is_null() {
            return;
        }
        (*ctx).closing = 1;
        let loop_ = (*ctx).loop_;
        let mut pp =
            ptr::addr_of_mut!((*loop_).data.quic_head) as *mut *mut us_quic_socket_context_t;
        while !(*pp).is_null() {
            if *pp == ctx {
                *pp = (*ctx).next;
                break;
            }
            pp = ptr::addr_of_mut!((**pp).next);
        }
        if (*loop_).data.quic_head.is_null() {
            (*loop_).data.quic_next_tick_us = -1;
        }
        while !(*ctx).listeners.is_null() {
            us_udp_socket_close((*(*ctx).listeners).udp);
        }
        if !(*ctx).engine.is_null() {
            lsquic_engine_destroy((*ctx).engine);
            (*ctx).engine = ptr::null_mut();
        }
        if !(*ctx).ssl_ctx.is_null() {
            SSL_CTX_free((*ctx).ssl_ctx);
            (*ctx).ssl_ctx = ptr::null_mut();
        }
        for i in 0..(*ctx).sni_count {
            let e = (*ctx).sni.add(i as usize);
            libc::free((*e).name.cast());
            SSL_CTX_free((*e).ctx);
        }
        libc::free((*ctx).sni.cast());
        let mut ls = (*ctx).closed_listeners;
        while !ls.is_null() {
            let next = (*ls).next;
            libc::free(ls.cast());
            ls = next;
        }
        libc::free(ctx.cast());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_ext(
    ctx: *mut us_quic_socket_context_t,
) -> *mut c_void {
    unsafe { ext_of(ctx) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_loop(
    ctx: *mut us_quic_socket_context_t,
) -> *mut us_loop_t {
    unsafe { (*ctx).loop_ }
}

/// RFC 9000 §14: QUIC packets must not be IP-fragmented. _PROBE sets DF but
/// ignores cached path-MTU so lsquic's DPLPMTUD can send oversized probes
/// without sendmsg returning EMSGSIZE.
unsafe fn us_quic_set_dontfrag(udp: *mut us_udp_socket_t) {
    // SAFETY: `udp` is live; setsockopt failures are ignored.
    unsafe {
        let fd = us_poll_fd(udp.cast::<us_poll_t>());
        #[cfg(windows)]
        {
            const IPPROTO_IP: c_int = 0;
            const IPPROTO_IPV6: c_int = 41;
            const IP_DONTFRAGMENT: c_int = 14;
            const IPV6_DONTFRAG: c_int = 14;
            let on: c_int = 1;
            let p = (&raw const on).cast::<c_char>();
            setsockopt(
                fd,
                IPPROTO_IP,
                IP_DONTFRAGMENT,
                p,
                size_of::<c_int>() as c_int,
            );
            setsockopt(
                fd,
                IPPROTO_IPV6,
                IPV6_DONTFRAG,
                p,
                size_of::<c_int>() as c_int,
            );
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let on: c_int = libc::IP_PMTUDISC_PROBE;
            let p = (&raw const on).cast::<c_void>();
            let sz = size_of::<c_int>() as socklen_t;
            setsockopt(fd, libc::IPPROTO_IP, libc::IP_MTU_DISCOVER, p, sz);
            setsockopt(fd, libc::IPPROTO_IPV6, libc::IPV6_MTU_DISCOVER, p, sz);
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
        {
            let on: c_int = 1;
            let p = (&raw const on).cast::<c_void>();
            let sz = size_of::<c_int>() as socklen_t;
            setsockopt(fd, libc::IPPROTO_IP, libc::IP_DONTFRAG, p, sz);
            setsockopt(fd, libc::IPPROTO_IPV6, libc::IPV6_DONTFRAG, p, sz);
        }
        let _ = fd;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_listen(
    ctx: *mut us_quic_socket_context_t,
    host: *const c_char,
    port: c_int,
    flags: c_int,
    stream_ext_size: c_uint,
) -> *mut us_quic_listen_socket_t {
    unsafe {
        (*ctx).stream_ext_size = stream_ext_size;

        let ls =
            libc::calloc(1, size_of::<us_quic_listen_socket_t>()) as *mut us_quic_listen_socket_t;
        if ls.is_null() {
            return ptr::null_mut();
        }
        (*ls).ctx = ctx;

        let mut err: c_int = 0;
        (*ls).udp = us_create_udp_socket(
            (*ctx).loop_,
            Some(us_quic_udp_on_data),
            Some(us_quic_udp_on_drain),
            Some(us_quic_udp_on_close),
            None,
            host,
            port as c_ushort,
            flags,
            &mut err,
            ls.cast(),
        );
        if (*ls).udp.is_null() {
            libc::free(ls.cast());
            return ptr::null_mut();
        }
        us_quic_set_dontfrag((*ls).udp);

        // Record actual bound address — packet_in needs sa_local.
        let mut sl = size_of::<sockaddr_storage>() as socklen_t;
        getsockname(
            us_poll_fd((*ls).udp.cast::<us_poll_t>()),
            ptr::addr_of_mut!((*ls).local).cast(),
            &mut sl,
        );

        (*ls).next = (*ctx).listeners;
        (*ctx).listeners = ls;
        ls
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_listen_socket_close(ls: *mut us_quic_listen_socket_t) {
    unsafe {
        if ls.is_null() || (*ls).udp.is_null() {
            return;
        }
        // Send CONNECTION_CLOSE on every live conn before the fd disappears.
        if !(*(*ls).ctx).engine.is_null() {
            let mut qs = (*(*ls).ctx).conns;
            while !qs.is_null() {
                if !(*qs).conn.is_null() {
                    lsquic_conn_close((*qs).conn);
                }
                qs = (*qs).next;
            }
            lsquic_engine_cooldown((*(*ls).ctx).engine);
            us_quic_process((*ls).ctx);
            lsquic_engine_send_unsent_packets((*(*ls).ctx).engine);
        }
        us_udp_socket_close((*ls).udp);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_listen_socket_port(ls: *mut us_quic_listen_socket_t) -> c_int {
    // SAFETY: ls->udp may be NULL; read from cached getsockname() result.
    unsafe {
        let local = ptr::addr_of!((*ls).local);
        let port: u16 = if (*local).ss_family as c_int == AF_INET6 {
            (*(local as *const sockaddr_in6)).sin6_port
        } else {
            (*(local as *const sockaddr_in)).sin_port
        };
        u16::from_be(port) as c_int
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_listen_socket_local_address(
    ls: *mut us_quic_listen_socket_t,
    buf: *mut c_char,
    len: c_int,
) -> c_int {
    unsafe {
        let local = ptr::addr_of!((*ls).local);
        if (*local).ss_family as c_int == AF_INET6 {
            if len < 16 {
                return 0;
            }
            ptr::copy_nonoverlapping(
                ptr::addr_of!((*(local as *const sockaddr_in6)).sin6_addr).cast::<u8>(),
                buf.cast(),
                16,
            );
            16
        } else {
            if len < 4 {
                return 0;
            }
            ptr::copy_nonoverlapping(
                ptr::addr_of!((*(local as *const sockaddr_in)).sin_addr).cast::<u8>(),
                buf.cast(),
                4,
            );
            4
        }
    }
}

// ───── callback setters ─────
macro_rules! def_cb {
    ($fn_name:ident, $field:ident, $ty:ty) => {
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $fn_name(ctx: *mut us_quic_socket_context_t, cb: $ty) {
            unsafe { (*ctx).$field = cb }
        }
    };
}
def_cb!(us_quic_socket_context_on_open, on_open, on_open_cb);
def_cb!(
    us_quic_socket_context_on_hsk_done,
    on_hsk_done,
    on_hsk_done_cb
);
def_cb!(us_quic_socket_context_on_goaway, on_goaway, on_open_cb);
def_cb!(us_quic_socket_context_on_close, on_close, on_open_cb);
def_cb!(
    us_quic_socket_context_on_stream_open,
    on_stream_open,
    on_stream_open_cb
);
def_cb!(
    us_quic_socket_context_on_stream_headers,
    on_stream_headers,
    on_stream_hdr_cb
);
def_cb!(
    us_quic_socket_context_on_stream_data,
    on_stream_data,
    on_stream_data_cb
);
def_cb!(
    us_quic_socket_context_on_stream_writable,
    on_stream_writable,
    on_stream_hdr_cb
);
def_cb!(
    us_quic_socket_context_on_stream_close,
    on_stream_close,
    on_stream_hdr_cb
);

// ═══════════════════════════════════════════════════════════════════════════
// Stream I/O
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_write(
    s: *mut us_quic_stream_t,
    data: *const c_char,
    len: c_uint,
) -> c_int {
    unsafe {
        if (*s).stream.is_null() {
            return -1;
        }
        let w = lsquic_stream_write((*s).stream, data.cast(), len as usize);
        if w >= 0 && (w as c_uint) < len {
            lsquic_stream_wantwrite((*s).stream, 1);
        }
        // lsquic_stream_write only buffers; flush() schedules the buffered bytes
        // for the next process_conns without forcing a packet per call.
        if w > 0 {
            lsquic_stream_flush((*s).stream);
            (*(*s).ctx).pending_write_bytes += w as c_uint;
        }
        w as c_int
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_want_read(s: *mut us_quic_stream_t, want: c_int) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_wantread((*s).stream, want);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_want_write(s: *mut us_quic_stream_t, want: c_int) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_wantwrite((*s).stream, want);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_send_informational(
    s: *mut us_quic_stream_t,
    status3: *const c_char,
) -> c_int {
    unsafe {
        if (*s).stream.is_null() {
            return -1;
        }
        let mut buf = [0 as c_char; 10];
        ptr::copy_nonoverlapping(b":status".as_ptr().cast(), buf.as_mut_ptr(), 7);
        ptr::copy_nonoverlapping(status3, buf.as_mut_ptr().add(7), 3);
        let mut xh: lsxpack_header = zeroed();
        xh.buf = buf.as_mut_ptr();
        xh.name_offset = 0;
        xh.name_len = 7;
        xh.val_offset = 7;
        xh.val_len = 3;
        let lh = lsquic_http_headers {
            count: 1,
            headers: &mut xh,
        };
        lsquic_stream_send_headers((*s).stream, &lh, 0)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_send_headers(
    s: *mut us_quic_stream_t,
    headers: *const us_quic_header_t,
    count: c_uint,
    end_stream: c_int,
) -> c_int {
    unsafe {
        if (*s).stream.is_null() {
            return -1;
        }
        // lsxpack_header addresses name+value as offsets into a single buffer,
        // so each pair has to be contiguous. Flatten caller's arbitrary pointers.
        let mut total: usize = 0;
        for i in 0..count as usize {
            let h = headers.add(i);
            total += (*h).name_len as usize + (*h).value_len as usize;
        }

        let mut stackbuf = MaybeUninit::<[c_char; 1024]>::uninit();
        let (buf, buf_heap): (*mut c_char, bool) = if total <= 1024 {
            (stackbuf.as_mut_ptr().cast(), false)
        } else {
            (libc::malloc(total) as *mut c_char, true)
        };
        let mut stackh = [const { MaybeUninit::<lsxpack_header>::zeroed() }; 32];
        let (xh, xh_heap): (*mut lsxpack_header, bool) = if count <= 32 {
            (stackh.as_mut_ptr().cast(), false)
        } else {
            (
                libc::calloc(count as usize, size_of::<lsxpack_header>()).cast(),
                true,
            )
        };
        if buf.is_null() || xh.is_null() {
            if buf_heap {
                libc::free(buf.cast());
            }
            if xh_heap {
                libc::free(xh.cast());
            }
            return -1;
        }

        let mut off: usize = 0;
        for i in 0..count as usize {
            let h = headers.add(i);
            let nl = (*h).name_len as usize;
            let vl = (*h).value_len as usize;
            ptr::copy_nonoverlapping((*h).name, buf.add(off), nl);
            ptr::copy_nonoverlapping((*h).value, buf.add(off + nl), vl);
            let x = xh.add(i);
            *x = zeroed();
            (*x).buf = buf;
            (*x).name_offset = off as i32;
            (*x).name_len = nl as u16;
            (*x).val_offset = (off + nl) as i32;
            (*x).val_len = vl as u16;
            if (*h).qpack_index >= 0 {
                (*x).qpack_index = (*h).qpack_index as u8;
                (*x).flags = LSXPACK_QPACK_IDX;
            }
            off += nl + vl;
        }

        let lh = lsquic_http_headers {
            count: count as c_int,
            headers: xh,
        };
        let r = lsquic_stream_send_headers((*s).stream, &lh, end_stream);
        if buf_heap {
            libc::free(buf.cast());
        }
        if xh_heap {
            libc::free(xh.cast());
        }
        if end_stream != 0 && r == 0 {
            lsquic_stream_shutdown((*s).stream, 1);
        }
        // Mark dirty so drainQuicIfNecessary picks up header-only responses.
        if r == 0 {
            (*(*s).ctx).pending_write_bytes += total as c_uint + 1;
        }
        r
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_shutdown(s: *mut us_quic_stream_t) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_shutdown((*s).stream, 1);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_flush(s: *mut us_quic_stream_t) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_flush((*s).stream);
            (*(*s).ctx).pending_write_bytes += 1;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_shutdown_read(s: *mut us_quic_stream_t) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_shutdown((*s).stream, 0);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_close(s: *mut us_quic_stream_t) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_close((*s).stream);
        }
    }
}

/// Abort the send half with RESET_STREAM(H3_REQUEST_CANCELLED) instead of FIN.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_reset(s: *mut us_quic_stream_t) {
    unsafe {
        if !(*s).stream.is_null() {
            lsquic_stream_maybe_reset((*s).stream, 0x10C, 1);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_has_unacked(s: *mut us_quic_stream_t) -> c_int {
    unsafe {
        if (*s).stream.is_null() {
            0
        } else {
            lsquic_stream_has_unacked_data((*s).stream)
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_ext(s: *mut us_quic_stream_t) -> *mut c_void {
    unsafe { ext_of(s) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_socket(s: *mut us_quic_stream_t) -> *mut us_quic_socket_t {
    unsafe {
        if (*s).stream.is_null() {
            return ptr::null_mut();
        }
        lsquic_conn_get_ctx(lsquic_stream_conn((*s).stream)).cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_context(
    s: *mut us_quic_stream_t,
) -> *mut us_quic_socket_context_t {
    unsafe { (*s).ctx }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_header_count(s: *mut us_quic_stream_t) -> c_uint {
    unsafe {
        if (*s).hset.is_null() {
            0
        } else {
            (*(*s).hset).count
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_stream_header(
    s: *mut us_quic_stream_t,
    i: c_uint,
) -> *const us_quic_header_t {
    unsafe {
        if !(*s).hset.is_null() && i < (*(*s).hset).count {
            (*(*s).hset).headers.add(i as usize)
        } else {
            ptr::null()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_ext(s: *mut us_quic_socket_t) -> *mut c_void {
    unsafe { ext_of(s) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context(
    s: *mut us_quic_socket_t,
) -> *mut us_quic_socket_context_t {
    unsafe { (*s).ctx }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_remote_address(
    s: *mut us_quic_socket_t,
    buf: *mut c_char,
    len: *mut c_int,
    port: *mut c_int,
    is_ipv6: *mut c_int,
) {
    unsafe {
        *len = 0;
        *port = 0;
        *is_ipv6 = 0;
        let mut local: *const sockaddr = ptr::null();
        let mut peer: *const sockaddr = ptr::null();
        if lsquic_conn_get_sockaddr((*s).conn, &mut local, &mut peer) != 0 {
            return;
        }
        if sa_family(peer) == AF_INET6 {
            let a = peer as *const sockaddr_in6;
            *port = u16::from_be((*a).sin6_port) as c_int;
            let addr = ptr::addr_of!((*a).sin6_addr).cast::<u8>();
            // IN6_IS_ADDR_V4MAPPED: first 80 bits zero, next 16 bits 0xffff.
            let mut bytes = [0u8; 12];
            ptr::copy_nonoverlapping(addr, bytes.as_mut_ptr(), 12);
            let is_v4m = bytes == [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
            if is_v4m {
                *len = 4;
                ptr::copy_nonoverlapping(addr.add(12), buf.cast(), 4);
            } else {
                *is_ipv6 = 1;
                *len = 16;
                ptr::copy_nonoverlapping(addr, buf.cast(), 16);
            }
        } else {
            let a = peer as *const sockaddr_in;
            *port = u16::from_be((*a).sin_port) as c_int;
            *len = 4;
            ptr::copy_nonoverlapping(ptr::addr_of!((*a).sin_addr).cast::<u8>(), buf.cast(), 4);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_close(s: *mut us_quic_socket_t) {
    unsafe {
        if !(*s).conn.is_null() {
            lsquic_conn_close((*s).conn);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Client
//
// lsquic only installs its own SSL_CTX_set_custom_verify when ea_get_ssl_ctx
// returns NULL. We always provide one, so cert verification is whatever WE put
// on it — a custom_verify that consults per-connection reject_unauthorized.
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" fn us_quic_client_verify(
    ssl: *mut SSL,
    _out_alert: *mut u8,
) -> ssl_verify_result_t {
    // SAFETY: called during the TLS handshake with a live SSL.
    unsafe {
        let conn = lsquic_ssl_to_conn(ssl);
        if conn.is_null() {
            return ssl_verify_invalid;
        }
        let qs = lsquic_conn_get_ctx(conn) as *mut us_quic_socket_t;
        if qs.is_null() {
            return ssl_verify_invalid;
        }
        if (*qs).reject_unauthorized == 0 {
            return ssl_verify_ok;
        }
        // custom_verify bypasses BoringSSL's built-in chain check; run
        // X509_verify_cert ourselves, then match leaf against SNI hostname.
        let chain = SSL_get_peer_full_cert_chain(ssl);
        if chain.is_null() || sk_num(chain.cast()) == 0 {
            return ssl_verify_invalid;
        }
        let leaf = sk_value(chain.cast(), 0) as *mut X509;
        let store = SSL_CTX_get_cert_store(SSL_get_SSL_CTX(ssl));
        let vctx = X509_STORE_CTX_new();
        if vctx.is_null() {
            return ssl_verify_invalid;
        }
        let mut ok = false;
        if X509_STORE_CTX_init(vctx, store, leaf, chain) == 1 {
            X509_STORE_CTX_set_default(vctx, b"ssl_server\0".as_ptr().cast());
            ok = X509_verify_cert(vctx) == 1;
        }
        X509_STORE_CTX_free(vctx);
        if !ok {
            return ssl_verify_invalid;
        }
        if !(*qs).hostname.is_null() && *(*qs).hostname != 0 {
            let host = (*qs).hostname;
            let mut addr = [0u8; 16];
            let is_ip = inet_pton(AF_INET, host, addr.as_mut_ptr().cast()) == 1
                || inet_pton(AF_INET6, host, addr.as_mut_ptr().cast()) == 1;
            let matched = if is_ip {
                X509_check_ip_asc(leaf, host, 0)
            } else {
                X509_check_host(
                    leaf,
                    host,
                    libc::strlen(host),
                    X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS,
                    ptr::null_mut(),
                )
            };
            if matched != 1 {
                return ssl_verify_invalid;
            }
        }
        ssl_verify_ok
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_create_quic_client_context(
    loop_: *mut us_loop_t,
    ext_size: c_uint,
    conn_ext_size: c_uint,
    stream_ext_size: c_uint,
) -> *mut us_quic_socket_context_t {
    unsafe {
        let ssl = SSL_CTX_new(TLS_method());
        if ssl.is_null() {
            return ptr::null_mut();
        }
        SSL_CTX_set_min_proto_version(ssl, TLS1_3_VERSION);
        SSL_CTX_set_max_proto_version(ssl, TLS1_3_VERSION);
        // Same root store the H1/H2 client uses (bundled Mozilla roots + platform CAs).
        SSL_CTX_set_cert_store(ssl, us_get_default_ca_store());
        SSL_CTX_set_custom_verify(ssl, SSL_VERIFY_PEER, Some(us_quic_client_verify));

        let ctx = libc::calloc(1, size_of::<us_quic_socket_context_t>() + ext_size as usize)
            as *mut us_quic_socket_context_t;
        if ctx.is_null() {
            SSL_CTX_free(ssl);
            return ptr::null_mut();
        }
        (*ctx).loop_ = loop_;
        (*ctx).ssl_ctx = ssl;
        (*ctx).is_client = 1;
        (*ctx).conn_ext_size = conn_ext_size;
        (*ctx).stream_ext_size = stream_ext_size;

        lsquic_engine_init_settings(ptr::addr_of_mut!((*ctx).settings), LSENG_HTTP);
        (*ctx).settings.es_versions = 1u32 << LSQVER_I001;
        (*ctx).settings.es_ecn = 0;
        (*ctx).settings.es_max_header_list_size = 64 * 1024;
        (*ctx).settings.es_ext_http_prio = 0;

        let mut api: lsquic_engine_api = zeroed();
        api.ea_settings = ptr::addr_of!((*ctx).settings);
        api.ea_stream_if = &US_QUIC_STREAM_IF;
        api.ea_stream_if_ctx = ctx.cast();
        api.ea_packets_out = Some(us_quic_packets_out);
        api.ea_packets_out_ctx = ctx.cast();
        api.ea_get_ssl_ctx = Some(us_quic_get_ssl_ctx);
        api.ea_hsi_if = &US_QUIC_HSET_IF;
        api.ea_hsi_ctx = ctx.cast();

        (*ctx).engine = lsquic_engine_new(LSENG_HTTP, &api);
        if (*ctx).engine.is_null() {
            SSL_CTX_free(ssl);
            libc::free(ctx.cast());
            return ptr::null_mut();
        }

        (*ctx).next = loop_quic_head(loop_);
        (*loop_).data.quic_head = ctx.cast::<us_quic_socket_context_s>();
        ctx
    }
}

unsafe fn us_quic_resolve(host: *const c_char, port: c_int, out: *mut sockaddr_storage) -> c_int {
    unsafe {
        ptr::write_bytes(out, 0, 1);
        let v4 = out as *mut sockaddr_in;
        let v6 = out as *mut sockaddr_in6;
        if inet_pton(AF_INET, host, ptr::addr_of_mut!((*v4).sin_addr).cast()) == 1 {
            (*v4).sin_family = AF_INET as _;
            (*v4).sin_port = (port as u16).to_be();
            return 0;
        }
        if inet_pton(AF_INET6, host, ptr::addr_of_mut!((*v6).sin6_addr).cast()) == 1 {
            (*v6).sin6_family = AF_INET6 as _;
            (*v6).sin6_port = (port as u16).to_be();
            return 0;
        }
        -1
    }
}

/// One UDP endpoint for all client connections on this loop. lsquic demuxes
/// incoming datagrams by connection ID, so a single ephemeral port can serve
/// every outbound conn.
unsafe fn us_quic_client_endpoint(
    ctx: *mut us_quic_socket_context_t,
) -> *mut us_quic_listen_socket_t {
    unsafe {
        if !(*ctx).client_udp.is_null() {
            return (*ctx).client_udp;
        }
        let ls =
            libc::calloc(1, size_of::<us_quic_listen_socket_t>()) as *mut us_quic_listen_socket_t;
        if ls.is_null() {
            return ptr::null_mut();
        }
        (*ls).ctx = ctx;
        let mut err: c_int = 0;
        (*ls).udp = us_create_udp_socket(
            (*ctx).loop_,
            Some(us_quic_udp_on_data),
            Some(us_quic_udp_on_drain),
            Some(us_quic_udp_on_close),
            None,
            b"::\0".as_ptr().cast(),
            0,
            0,
            &mut err,
            ls.cast(),
        );
        if (*ls).udp.is_null() {
            err = 0;
            (*ls).udp = us_create_udp_socket(
                (*ctx).loop_,
                Some(us_quic_udp_on_data),
                Some(us_quic_udp_on_drain),
                Some(us_quic_udp_on_close),
                None,
                b"0.0.0.0\0".as_ptr().cast(),
                0,
                0,
                &mut err,
                ls.cast(),
            );
        }
        if (*ls).udp.is_null() {
            libc::free(ls.cast());
            return ptr::null_mut();
        }
        us_quic_set_dontfrag((*ls).udp);
        let mut sl = size_of::<sockaddr_storage>() as socklen_t;
        getsockname(
            us_poll_fd((*ls).udp.cast::<us_poll_t>()),
            ptr::addr_of_mut!((*ls).local).cast(),
            &mut sl,
        );
        (*ls).next = (*ctx).listeners;
        (*ctx).listeners = ls;
        (*ctx).client_udp = ls;
        ls
    }
}

unsafe fn us_quic_connect_addr(
    ctx: *mut us_quic_socket_context_t,
    mut peer: *const sockaddr,
    sni: *const c_char,
    reject_unauthorized: c_int,
) -> *mut us_quic_socket_t {
    unsafe {
        let ls = us_quic_client_endpoint(ctx);
        if ls.is_null() {
            return ptr::null_mut();
        }
        // lsquic's path comparison needs sa_local and peer to be the same family.
        let mut mapped: sockaddr_storage = zeroed();
        if (*ls).local.ss_family as c_int == AF_INET6 && sa_family(peer) == AF_INET {
            let m = ptr::addr_of_mut!(mapped) as *mut sockaddr_in6;
            let p4 = peer as *const sockaddr_in;
            (*m).sin6_family = AF_INET6 as _;
            (*m).sin6_port = (*p4).sin_port;
            let s6 = ptr::addr_of_mut!((*m).sin6_addr).cast::<u8>();
            *s6.add(10) = 0xff;
            *s6.add(11) = 0xff;
            ptr::copy_nonoverlapping(ptr::addr_of!((*p4).sin_addr).cast::<u8>(), s6.add(12), 4);
            peer = ptr::addr_of!(mapped).cast();
        } else if (*ls).local.ss_family as c_int != sa_family(peer) {
            return ptr::null_mut();
        }

        let conn = lsquic_engine_connect(
            (*ctx).engine,
            N_LSQVER,
            ptr::addr_of!((*ls).local).cast(),
            peer,
            ls.cast(),
            ptr::null_mut(),
            sni,
            0,
            ptr::null(),
            0,
            ptr::null(),
            0,
        );
        if conn.is_null() {
            return ptr::null_mut();
        }
        let qs = lsquic_conn_get_ctx(conn) as *mut us_quic_socket_t;
        if !qs.is_null() {
            (*qs).reject_unauthorized = reject_unauthorized;
            if !sni.is_null() {
                (*qs).hostname = libc::strdup(sni);
                if (*qs).hostname.is_null() {
                    lsquic_conn_close(conn);
                    return ptr::null_mut();
                }
            }
        }
        // Don't us_quic_process here — caller hasn't filled conn ext yet.
        // pending_write_bytes++ ensures loop_pre sends the Initial next tick.
        (*ctx).pending_write_bytes += 1;
        qs
    }
}

/// Walk the resolved address list and connect to the first reachable entry.
/// Probe each with a throwaway UDP connect() so ENETUNREACH on an AAAA lets
/// us fall through to A.
unsafe fn us_quic_connect_result(
    ctx: *mut us_quic_socket_context_t,
    res: *mut addrinfo_result,
    port: c_int,
    sni: *const c_char,
    reject_unauthorized: c_int,
) -> *mut us_quic_socket_t {
    unsafe {
        let mut ai: *mut addrinfo = ptr::addr_of_mut!((*(*res).entries).info);
        while !ai.is_null() {
            let mut peer: sockaddr_storage = zeroed();
            ptr::copy_nonoverlapping(
                (*ai).ai_addr.cast::<u8>(),
                ptr::addr_of_mut!(peer).cast::<u8>(),
                (*ai).ai_addrlen as usize,
            );
            let peer_sa = ptr::addr_of_mut!(peer) as *mut sockaddr;
            if peer.ss_family as c_int == AF_INET {
                (*(peer_sa as *mut sockaddr_in)).sin_port = (port as u16).to_be();
            } else {
                (*(peer_sa as *mut sockaddr_in6)).sin6_port = (port as u16).to_be();
            }

            let mut perr: c_int = 0;
            let probe = bsd_create_socket(peer.ss_family as c_int, SOCK_DGRAM, 0, &mut perr);
            if probe != LIBUS_SOCKET_ERROR {
                #[cfg(windows)]
                let r = {
                    // Winsock datagram connect() doesn't do a route lookup;
                    // SIO_ROUTING_INTERFACE_QUERY fails when there is no route.
                    const SIO_ROUTING_INTERFACE_QUERY: u32 = 0xC8000014;
                    let mut local: sockaddr_storage = zeroed();
                    let mut got: u32 = 0;
                    WSAIoctl(
                        probe,
                        SIO_ROUTING_INTERFACE_QUERY,
                        peer_sa.cast(),
                        sa_len(peer_sa) as u32,
                        ptr::addr_of_mut!(local).cast(),
                        size_of::<sockaddr_storage>() as u32,
                        &mut got,
                        ptr::null_mut(),
                        ptr::null_mut(),
                    )
                };
                #[cfg(not(windows))]
                let r = connect(probe, peer_sa, sa_len(peer_sa));
                bsd_close_socket(probe);
                if r != 0 {
                    ai = (*ai).ai_next;
                    continue;
                }
            }

            let qs = us_quic_connect_addr(ctx, peer_sa, sni, reject_unauthorized);
            if !qs.is_null() {
                return qs;
            }
            ai = (*ai).ai_next;
        }
        ptr::null_mut()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_context_connect(
    ctx: *mut us_quic_socket_context_t,
    host: *const c_char,
    port: c_int,
    sni: *const c_char,
    reject_unauthorized: c_int,
    out_qs: *mut *mut us_quic_socket_t,
    out_pending: *mut *mut us_quic_pending_connect_s,
    user: *mut c_void,
) -> c_int {
    unsafe {
        *out_qs = ptr::null_mut();
        *out_pending = ptr::null_mut();

        let mut peer_ss: sockaddr_storage = zeroed();
        if us_quic_resolve(host, port, &mut peer_ss) == 0 {
            *out_qs =
                us_quic_connect_addr(ctx, ptr::addr_of!(peer_ss).cast(), sni, reject_unauthorized);
            return if (*out_qs).is_null() { -1 } else { 1 };
        }

        let mut ai_req: *mut addrinfo_request = ptr::null_mut();
        let cached = Bun__addrinfo_get((*ctx).loop_, host, port as u16, &mut ai_req) == 0;
        if cached {
            let res = Bun__addrinfo_getRequestResult(ai_req);
            if (*res).error != 0 || (*res).entries.is_null() {
                Bun__addrinfo_freeRequest(ai_req, 1);
                return -1;
            }
            *out_qs = us_quic_connect_result(ctx, res, port, sni, reject_unauthorized);
            Bun__addrinfo_freeRequest(ai_req, (*out_qs).is_null() as c_int);
            return if (*out_qs).is_null() { -1 } else { 1 };
        }

        let pc = libc::calloc(1, size_of::<us_quic_pending_connect_s>())
            as *mut us_quic_pending_connect_s;
        if pc.is_null() {
            Bun__addrinfo_freeRequest(ai_req, 1);
            return -1;
        }
        (*pc).ctx = ctx;
        (*pc).sni = if sni.is_null() {
            ptr::null_mut()
        } else {
            libc::strdup(sni)
        };
        if !sni.is_null() && (*pc).sni.is_null() {
            Bun__addrinfo_freeRequest(ai_req, 1);
            libc::free(pc.cast());
            return -1;
        }
        (*pc).port = port;
        (*pc).reject_unauthorized = reject_unauthorized;
        (*pc).ai_req = ai_req;
        (*pc).user = user;
        *out_pending = pc;
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_pending_connect_user(
    pc: *mut us_quic_pending_connect_s,
) -> *mut c_void {
    unsafe { (*pc).user }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_pending_connect_addrinfo(
    pc: *mut us_quic_pending_connect_s,
) -> *mut addrinfo_request {
    unsafe { (*pc).ai_req }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_pending_connect_resolved(
    pc: *mut us_quic_pending_connect_s,
) -> *mut us_quic_socket_t {
    unsafe {
        let mut qs: *mut us_quic_socket_t = ptr::null_mut();
        let res = Bun__addrinfo_getRequestResult((*pc).ai_req);
        if (*res).error == 0 && !(*res).entries.is_null() {
            qs = us_quic_connect_result(
                (*pc).ctx,
                res,
                (*pc).port,
                (*pc).sni,
                (*pc).reject_unauthorized,
            );
        }
        Bun__addrinfo_freeRequest((*pc).ai_req, qs.is_null() as c_int);
        libc::free((*pc).sni.cast());
        libc::free(pc.cast());
        qs
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_pending_connect_cancel(pc: *mut us_quic_pending_connect_s) {
    unsafe {
        Bun__addrinfo_freeRequest((*pc).ai_req, 1);
        libc::free((*pc).sni.cast());
        libc::free(pc.cast());
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_make_stream(s: *mut us_quic_socket_t) {
    unsafe {
        if (*s).conn.is_null() {
            return;
        }
        lsquic_conn_make_stream((*s).conn);
        (*(*s).ctx).pending_write_bytes += 1;
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_streams_avail(s: *mut us_quic_socket_t) -> c_uint {
    // lsquic_conn_n_avail_streams doesn't check LSCONN_PEER_GOING_AWAY, so a
    // conn past GOAWAY still reports credit. Return 0 so caller opens a fresh conn.
    unsafe {
        if (*s).conn.is_null() || (*s).going_away != 0 {
            return 0;
        }
        lsquic_conn_n_avail_streams((*s).conn)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_quic_socket_status(
    s: *mut us_quic_socket_t,
    buf: *mut c_char,
    len: c_uint,
) -> c_int {
    unsafe {
        if (*s).conn.is_null() {
            return -1;
        }
        lsquic_conn_status((*s).conn, buf, len as usize)
    }
}
