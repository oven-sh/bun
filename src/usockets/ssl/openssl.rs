//! Port of `packages/bun-usockets/src/crypto/openssl.c`.
//!
//! Per-socket SSL model: `SSL_CTX` is owned externally (SecureContext /
//! listener). Each TLS socket's `s->ssl` IS the BoringSSL `SSL*`; the 6 state
//! bits live in `us_socket_t`'s packed `ssl_bits`. The loop dispatch path is
//! `loop.c readable → s->ssl ? us_internal_ssl_on_data : us_dispatch_data` and
//! `us_internal_ssl_on_data` decrypts then re-enters `us_dispatch_data` with
//! plaintext. Same shape for open/writable/close/end.

#![allow(dead_code, unused_imports, static_mut_refs, unused_unsafe)]

use core::ffi::{c_char, c_int, c_long, c_uchar, c_uint, c_void};
use core::mem::size_of;
use core::ptr;
use core::sync::atomic::{AtomicI64, Ordering};
use std::sync::Once;

use bun_boringssl_sys::{
    BIO, BIO_METHOD, BIO_free, BIO_new, BIO_new_mem_buf, BIO_s_mem, CRYPTO_EX_DATA,
    ERR_clear_error, ERR_error_string_n, ERR_peek_error, ERR_peek_last_error, SSL, SSL_CTX,
    SSL_CTX_free, SSL_CTX_get_ex_data, SSL_CTX_get_verify_mode, SSL_CTX_new,
    SSL_CTX_set_cipher_list, SSL_CTX_set_ex_data, SSL_CTX_up_ref, SSL_ERROR_SSL, SSL_ERROR_SYSCALL,
    SSL_ERROR_WANT_READ, SSL_ERROR_WANT_RENEGOTIATE, SSL_ERROR_WANT_WRITE, SSL_ERROR_ZERO_RETURN,
    SSL_RECEIVED_SHUTDOWN, SSL_TLSEXT_ERR_NOACK, SSL_TLSEXT_ERR_OK,
    SSL_VERIFY_FAIL_IF_NO_PEER_CERT, SSL_VERIFY_NONE, SSL_VERIFY_PEER, SSL_do_handshake, SSL_free,
    SSL_get_SSL_CTX, SSL_get_error, SSL_get_ex_data, SSL_get_servername, SSL_get_shutdown,
    SSL_get_wbio, SSL_is_init_finished, SSL_new, SSL_read, SSL_renegotiate, SSL_set_accept_state,
    SSL_set_bio, SSL_set_connect_state, SSL_set_ex_data, SSL_set_renegotiate_mode,
    SSL_set_tlsext_host_name, SSL_set_verify, SSL_set0_verify_cert_store, SSL_shutdown,
    SSL_verify_cb, SSL_write, X509, X509_STORE, X509_STORE_CTX, X509_free,
    ssl_renegotiate_explicit, ssl_renegotiate_never,
};

use crate::eventing::{us_internal_poll_type, us_loop_t, us_poll_t};
use crate::ssl::sni_tree::{sni_add, sni_find, sni_free, sni_new, sni_remove};
use crate::types::{
    Bun__outOfMemory, CREATE_BUN_SOCKET_ERROR_INVALID_CA, CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE,
    CREATE_BUN_SOCKET_ERROR_INVALID_CIPHERS, CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE,
    LIBUS_RECV_BUFFER_LENGTH, LIBUS_RECV_BUFFER_PADDING, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN,
    LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN, POLL_TYPE_KIND_MASK, POLL_TYPE_SEMI_SOCKET,
    POLL_TYPE_SOCKET_SHUT_DOWN, us_bun_socket_context_options_t, us_bun_verify_error_t, us_calloc,
    us_dispatch_close, us_dispatch_data, us_dispatch_handshake, us_dispatch_keylog,
    us_dispatch_open, us_dispatch_session, us_dispatch_ssl_raw_tap, us_dispatch_writable, us_free,
    us_listen_socket_t, us_malloc, us_on_server_name_cb, us_realloc, us_socket_group_t,
    us_socket_t,
};

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/// Capacity of the parked fatal-error reason (`ERR_error_string_n` output).
const US_SSL_FATAL_ERROR_REASON_MAX: usize = 256;
/// Upper bound for a serialized `SSL_SESSION` (`i2d`).
const US_SSL_PENDING_SESSION_MAX: c_int = 65536;
/// Upper bound for a single NSS keylog line.
const US_SSL_PENDING_KEYLOG_LINE_MAX: usize = 4096;

const HANDSHAKE_PENDING: u8 = 0;
const HANDSHAKE_COMPLETED: u8 = 1;
const HANDSHAKE_RENEGOTIATION_PENDING: u8 = 2;

const DEFAULT_CIPHER_LIST: &[u8] = b"ECDHE-RSA-AES128-GCM-SHA256:\
ECDHE-ECDSA-AES128-GCM-SHA256:\
ECDHE-RSA-AES256-GCM-SHA384:\
ECDHE-ECDSA-AES256-GCM-SHA384:\
ECDHE-RSA-AES128-SHA256:\
ECDHE-RSA-AES256-SHA384:\
HIGH:\
!aNULL:\
!eNULL:\
!EXPORT:\
!DES:\
!RC4:\
!MD5:\
!PSK:\
!SRP:\
!CAMELLIA\0";

// ── BoringSSL constants not exported from bun_boringssl_sys ────────────────
const SSL_SENT_SHUTDOWN: c_int = 1;
const SSL_ERROR_PENDING_CERTIFICATE: c_int = 12;
const SSL_FILETYPE_PEM: c_int = 1;
const SSL_FILETYPE_ASN1: c_int = 2;
const SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER: u32 = 0x00000002;
const SSL_MODE_RELEASE_BUFFERS: u32 = 0;
const SSL_SESS_CACHE_CLIENT: c_int = 0x0001;
const SSL_SESS_CACHE_SERVER: c_int = 0x0002;
const SSL_SESS_CACHE_NO_AUTO_CLEAR: c_int = 0x0080;
const SSL_SESS_CACHE_NO_INTERNAL: c_int = 0x0100 | 0x0200;
const SSL_R_BAD_SSL_FILETYPE: c_int = 117;
const SSL_R_NO_CIPHER_MATCH: c_int = 177;
const TLS1_2_VERSION: u16 = 0x0303;
const TLS1_3_VERSION: u16 = 0x0304;
const TLSEXT_TYPE_server_name: u16 = 0;
const TLSEXT_NAMETYPE_host_name: c_int = 0;
const BIO_CTRL_FLUSH: c_int = 11;
const BIO_TYPE_MEM: c_int = 1 | 0x0400;
const NID_auth_psk: c_int = 956;

// err.h library codes (enum, 1-based)
const ERR_LIB_BUF: c_int = 7;
const ERR_LIB_PEM: c_int = 9;
const ERR_LIB_ASN1: c_int = 12;
const ERR_LIB_SSL: c_int = 16;
const PEM_R_NO_START_LINE: c_int = 110;

// X509_V_* verification errors
const X509_V_OK: c_long = 0;
const X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT: c_long = 2;
const X509_V_ERR_UNABLE_TO_GET_CRL: c_long = 3;
const X509_V_ERR_UNABLE_TO_DECRYPT_CERT_SIGNATURE: c_long = 4;
const X509_V_ERR_UNABLE_TO_DECRYPT_CRL_SIGNATURE: c_long = 5;
const X509_V_ERR_UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY: c_long = 6;
const X509_V_ERR_CERT_SIGNATURE_FAILURE: c_long = 7;
const X509_V_ERR_CRL_SIGNATURE_FAILURE: c_long = 8;
const X509_V_ERR_CERT_NOT_YET_VALID: c_long = 9;
const X509_V_ERR_CERT_HAS_EXPIRED: c_long = 10;
const X509_V_ERR_CRL_NOT_YET_VALID: c_long = 11;
const X509_V_ERR_CRL_HAS_EXPIRED: c_long = 12;
const X509_V_ERR_ERROR_IN_CERT_NOT_BEFORE_FIELD: c_long = 13;
const X509_V_ERR_ERROR_IN_CERT_NOT_AFTER_FIELD: c_long = 14;
const X509_V_ERR_ERROR_IN_CRL_LAST_UPDATE_FIELD: c_long = 15;
const X509_V_ERR_ERROR_IN_CRL_NEXT_UPDATE_FIELD: c_long = 16;
const X509_V_ERR_OUT_OF_MEM: c_long = 17;
const X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT: c_long = 18;
const X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN: c_long = 19;
const X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY: c_long = 20;
const X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE: c_long = 21;
const X509_V_ERR_CERT_CHAIN_TOO_LONG: c_long = 22;
const X509_V_ERR_CERT_REVOKED: c_long = 23;
const X509_V_ERR_INVALID_CA: c_long = 24;
const X509_V_ERR_PATH_LENGTH_EXCEEDED: c_long = 25;
const X509_V_ERR_INVALID_PURPOSE: c_long = 26;
const X509_V_ERR_CERT_UNTRUSTED: c_long = 27;
const X509_V_ERR_CERT_REJECTED: c_long = 28;
const X509_V_ERR_HOSTNAME_MISMATCH: c_long = 62;

type ssl_select_cert_result_t = c_int;
const ssl_select_cert_success: ssl_select_cert_result_t = 1;
const ssl_select_cert_retry: ssl_select_cert_result_t = 0;
const ssl_select_cert_error: ssl_select_cert_result_t = -1;

// ═══════════════════════════════════════════════════════════════════════════
// Opaque BoringSSL types not in bun_boringssl_sys
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
pub struct SSL_SESSION {
    _p: [u8; 0],
}
#[repr(C)]
pub struct SSL_CIPHER {
    _p: [u8; 0],
}
pub use bun_boringssl_sys::SSL_METHOD;
#[repr(C)]
pub struct EVP_PKEY {
    _p: [u8; 0],
}
#[repr(C)]
pub struct DH {
    _p: [u8; 0],
}
#[repr(C)]
pub struct PKCS12 {
    _p: [u8; 0],
}
#[repr(C)]
pub struct stack_st {
    _p: [u8; 0],
}

/// `struct ssl_early_callback_ctx` (`SSL_CLIENT_HELLO`).
#[repr(C)]
pub struct SSL_CLIENT_HELLO {
    pub ssl: *mut SSL,
    pub client_hello: *const u8,
    pub client_hello_len: usize,
    pub version: u16,
    pub random: *const u8,
    pub random_len: usize,
    pub session_id: *const u8,
    pub session_id_len: usize,
    pub dtls_cookie: *const u8,
    pub dtls_cookie_len: usize,
    pub cipher_suites: *const u8,
    pub cipher_suites_len: usize,
    pub compression_methods: *const u8,
    pub compression_methods_len: usize,
    pub extensions: *const u8,
    pub extensions_len: usize,
}

type CRYPTO_EX_free =
    unsafe extern "C" fn(*mut c_void, *mut c_void, *mut CRYPTO_EX_DATA, c_int, c_long, *mut c_void);
type pem_password_cb = unsafe extern "C" fn(*mut c_char, c_int, c_int, *mut c_void) -> c_int;

// ═══════════════════════════════════════════════════════════════════════════
// BoringSSL externs not already in bun_boringssl_sys
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn TLS_method() -> *const SSL_METHOD;
    fn OPENSSL_init_ssl(opts: u64, settings: *const c_void) -> c_int;
    fn ERR_put_error(
        library: c_int,
        unused: c_int,
        reason: c_int,
        file: *const c_char,
        line: c_uint,
    );

    fn SSL_CTX_get_ex_new_index(
        argl: c_long,
        argp: *mut c_void,
        unused: *mut c_void,
        dup_unused: *mut c_void,
        free_func: Option<CRYPTO_EX_free>,
    ) -> c_int;
    fn SSL_get_ex_new_index(
        argl: c_long,
        argp: *mut c_void,
        unused: *mut c_void,
        dup_unused: *mut c_void,
        free_func: Option<CRYPTO_EX_free>,
    ) -> c_int;

    fn SSL_CTX_set_read_ahead(ctx: *mut SSL_CTX, yes: c_int);
    fn SSL_CTX_set_mode(ctx: *mut SSL_CTX, mode: u32) -> u32;
    fn SSL_CTX_set_min_proto_version(ctx: *mut SSL_CTX, version: u16) -> c_int;
    fn SSL_CTX_set_max_proto_version(ctx: *mut SSL_CTX, version: u16) -> c_int;
    fn SSL_CTX_set_options(ctx: *mut SSL_CTX, options: u32) -> u32;
    fn SSL_CTX_set_verify(ctx: *mut SSL_CTX, mode: c_int, cb: SSL_verify_cb);
    fn SSL_CTX_set_cert_store(ctx: *mut SSL_CTX, store: *mut X509_STORE);
    fn SSL_CTX_get_cert_store(ctx: *const SSL_CTX) -> *mut X509_STORE;
    fn SSL_CTX_set_tmp_dh(ctx: *mut SSL_CTX, dh: *const DH) -> c_long;
    fn SSL_CTX_use_certificate(ctx: *mut SSL_CTX, x: *mut X509) -> c_int;
    fn SSL_CTX_use_PrivateKey(ctx: *mut SSL_CTX, pkey: *mut EVP_PKEY) -> c_int;
    fn SSL_CTX_use_PrivateKey_file(ctx: *mut SSL_CTX, file: *const c_char, ty: c_int) -> c_int;
    fn SSL_CTX_use_certificate_chain_file(ctx: *mut SSL_CTX, file: *const c_char) -> c_int;
    fn SSL_CTX_add0_chain_cert(ctx: *mut SSL_CTX, x: *mut X509) -> c_int;
    fn SSL_CTX_clear_chain_certs(ctx: *mut SSL_CTX) -> c_int;
    fn SSL_CTX_add_client_CA(ctx: *mut SSL_CTX, x: *mut X509) -> c_int;
    fn SSL_CTX_set_client_CA_list(ctx: *mut SSL_CTX, list: *mut stack_st);
    fn SSL_CTX_load_verify_locations(
        ctx: *mut SSL_CTX,
        ca_file: *const c_char,
        ca_path: *const c_char,
    ) -> c_int;
    fn SSL_CTX_set_default_passwd_cb(ctx: *mut SSL_CTX, cb: Option<pem_password_cb>);
    fn SSL_CTX_set_default_passwd_cb_userdata(ctx: *mut SSL_CTX, data: *mut c_void);
    fn SSL_CTX_get_default_passwd_cb(ctx: *const SSL_CTX) -> Option<pem_password_cb>;
    fn SSL_CTX_get_default_passwd_cb_userdata(ctx: *const SSL_CTX) -> *mut c_void;
    fn SSL_CTX_set_session_cache_mode(ctx: *mut SSL_CTX, mode: c_int) -> c_int;
    fn SSL_CTX_sess_set_new_cb(
        ctx: *mut SSL_CTX,
        cb: Option<unsafe extern "C" fn(*mut SSL, *mut SSL_SESSION) -> c_int>,
    );
    fn SSL_CTX_set_keylog_callback(
        ctx: *mut SSL_CTX,
        cb: Option<unsafe extern "C" fn(*const SSL, *const c_char)>,
    );
    fn SSL_CTX_set_tlsext_servername_callback(
        ctx: *mut SSL_CTX,
        cb: Option<unsafe extern "C" fn(*mut SSL, *mut c_int, *mut c_void) -> c_int>,
    ) -> c_int;
    fn SSL_CTX_set_select_certificate_cb(
        ctx: *mut SSL_CTX,
        cb: Option<unsafe extern "C" fn(*const SSL_CLIENT_HELLO) -> ssl_select_cert_result_t>,
    );
    fn SSL_load_client_CA_file(file: *const c_char) -> *mut stack_st;

    fn SSL_in_init(ssl: *const SSL) -> c_int;
    fn SSL_get_quiet_shutdown(ssl: *const SSL) -> c_int;
    fn SSL_get_verify_result(ssl: *const SSL) -> c_long;
    fn SSL_get_peer_certificate(ssl: *const SSL) -> *mut X509;
    fn SSL_get_current_cipher(ssl: *const SSL) -> *const SSL_CIPHER;
    fn SSL_get_session(ssl: *const SSL) -> *mut SSL_SESSION;
    fn SSL_session_reused(ssl: *const SSL) -> c_int;
    fn SSL_set_SSL_CTX(ssl: *mut SSL, ctx: *mut SSL_CTX) -> *mut SSL_CTX;
    fn SSL_early_callback_ctx_extension_get(
        hello: *const SSL_CLIENT_HELLO,
        ty: u16,
        out_data: *mut *const u8,
        out_len: *mut usize,
    ) -> c_int;
    fn SSL_CIPHER_get_auth_nid(cipher: *const SSL_CIPHER) -> c_int;
    fn SSL_SESSION_get_protocol_version(sess: *const SSL_SESSION) -> u16;
    fn i2d_SSL_SESSION(sess: *mut SSL_SESSION, out: *mut *mut u8) -> c_int;

    fn BIO_meth_new(ty: c_int, name: *const c_char) -> *mut BIO_METHOD;
    fn BIO_meth_free(method: *mut BIO_METHOD);
    fn BIO_meth_set_create(
        method: *mut BIO_METHOD,
        create: Option<unsafe extern "C" fn(*mut BIO) -> c_int>,
    ) -> c_int;
    fn BIO_meth_set_write(
        method: *mut BIO_METHOD,
        write: Option<unsafe extern "C" fn(*mut BIO, *const c_char, c_int) -> c_int>,
    ) -> c_int;
    fn BIO_meth_set_read(
        method: *mut BIO_METHOD,
        read: Option<unsafe extern "C" fn(*mut BIO, *mut c_char, c_int) -> c_int>,
    ) -> c_int;
    fn BIO_meth_set_ctrl(
        method: *mut BIO_METHOD,
        ctrl: Option<unsafe extern "C" fn(*mut BIO, c_int, c_long, *mut c_void) -> c_long>,
    ) -> c_int;
    fn BIO_set_init(bio: *mut BIO, init: c_int);
    fn BIO_set_data(bio: *mut BIO, data: *mut c_void);
    fn BIO_get_data(bio: *const BIO) -> *mut c_void;
    fn BIO_clear_retry_flags(bio: *mut BIO);
    fn BIO_set_retry_read(bio: *mut BIO);
    fn BIO_set_retry_write(bio: *mut BIO);
    fn BIO_up_ref(bio: *mut BIO) -> c_int;
    fn BIO_get_mem_data(bio: *mut BIO, contents: *mut *mut c_char) -> c_long;

    fn PEM_read_bio_PrivateKey(
        bio: *mut BIO,
        out: *mut *mut EVP_PKEY,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut EVP_PKEY;
    fn PEM_read_bio_X509(
        bio: *mut BIO,
        out: *mut *mut X509,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut X509;
    fn PEM_read_bio_X509_AUX(
        bio: *mut BIO,
        out: *mut *mut X509,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut X509;
    fn PEM_read_DHparams(
        fp: *mut libc::FILE,
        out: *mut *mut DH,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut DH;
    fn PEM_write_bio_PrivateKey(
        bio: *mut BIO,
        pkey: *mut EVP_PKEY,
        enc: *const c_void,
        kstr: *mut u8,
        klen: c_int,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> c_int;
    fn PEM_write_bio_X509(bio: *mut BIO, x: *mut X509) -> c_int;
    fn d2i_PrivateKey_bio(bio: *mut BIO, out: *mut *mut EVP_PKEY) -> *mut EVP_PKEY;
    fn d2i_PKCS12_bio(bio: *mut BIO, out: *mut *mut PKCS12) -> *mut PKCS12;
    fn PKCS12_parse(
        p12: *const PKCS12,
        pass: *const c_char,
        out_pkey: *mut *mut EVP_PKEY,
        out_cert: *mut *mut X509,
        out_ca: *mut *mut stack_st,
    ) -> c_int;
    fn PKCS12_free(p12: *mut PKCS12);
    fn EVP_PKEY_free(pkey: *mut EVP_PKEY);
    fn DH_free(dh: *mut DH);

    fn X509_STORE_add_cert(store: *mut X509_STORE, x: *mut X509) -> c_int;
    fn X509_STORE_free(store: *mut X509_STORE);
    fn X509_STORE_get0_objects(store: *mut X509_STORE) -> *mut stack_st;
    fn X509_verify_cert_error_string(err: c_long) -> *const c_char;

    fn sk_num(sk: *const c_void) -> usize;
    fn sk_value(sk: *const c_void, i: usize) -> *mut c_void;
    fn sk_pop_free_ex(
        sk: *mut stack_st,
        call_free: Option<
            unsafe extern "C" fn(Option<unsafe extern "C" fn(*mut c_void)>, *mut c_void),
        >,
        free_func: Option<unsafe extern "C" fn(*mut c_void)>,
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-TU externs (socket.rs / context.rs / root_certs.cpp / Rust runtime)
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn us_socket_is_closed(s: *mut us_socket_t) -> c_int;
    fn us_socket_kind(s: *mut us_socket_t) -> c_uchar;
    fn us_socket_close(s: *mut us_socket_t, code: c_int, reason: *mut c_void) -> *mut us_socket_t;
    fn us_socket_resume(s: *mut us_socket_t);
    fn us_socket_raw_write(s: *mut us_socket_t, data: *const c_char, length: c_int) -> c_int;
    fn us_socket_adopt(
        s: *mut us_socket_t,
        group: *mut us_socket_group_t,
        kind: c_uchar,
        old_ext_size: c_int,
        ext_size: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_socket_raw_shutdown(s: *mut us_socket_t);
    fn us_internal_socket_close_raw(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;

    fn us_get_default_ca_store() -> *mut X509_STORE;
    fn us_get_shared_default_ca_store() -> *mut X509_STORE;

    /// Defined in `src/runtime/api/bun/SSLContextCache.rs`.
    fn bun_ssl_ctx_cache_on_free(
        parent: *mut c_void,
        ptr: *mut c_void,
        ad: *mut CRYPTO_EX_DATA,
        index: c_int,
        argl: c_long,
        argp: *mut c_void,
    );

    /// Defined in `src/uws_sys/SocketKind.rs`.
    static BUN_SOCKET_KIND_BUN_SOCKET_TLS: c_uchar;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal structs
// ═══════════════════════════════════════════════════════════════════════════

/// Per-loop shared SSL state (stored at `loop->data.ssl_data`).
#[repr(C)]
struct loop_ssl_data {
    ssl_read_input: *mut c_char,
    ssl_read_output: *mut c_char,
    ssl_read_input_length: c_uint,
    ssl_read_input_offset: c_uint,

    ssl_socket: *mut us_socket_t,
    shared_rbio: *mut BIO,
    shared_wbio: *mut BIO,
    shared_biom: *mut BIO_METHOD,
    /// Parked OpenSSL error string for the socket being closed right now.
    ssl_last_fatal_error: [c_char; US_SSL_FATAL_ERROR_REASON_MAX],
    ssl_last_fatal_error_owner: *mut c_void,

    /// Ciphertext write batching — lazily allocated, reused across writes.
    ssl_write_batch: *mut c_char,
    ssl_write_batch_len: c_uint,
    ssl_write_batch_cap: c_uint,
    ssl_write_batching: c_int,

    /// Single spill slot for ciphertext a partial batch flush could not deliver.
    ssl_spill_owner: *mut us_socket_t,
    ssl_spill: *mut c_char,
    ssl_spill_len: c_uint,
    ssl_spill_off: c_uint,
}

/// SNI tree leaf — stored as the `void*` user in `sni_tree`.
#[repr(C)]
struct sni_node_t {
    ctx: *mut SSL_CTX,
    user: *mut c_void,
}

/// Async SNICallback suspension state, hung off the `SSL` via ex_data.
#[repr(C)]
struct us_ssl_sni_pending_t {
    /// 0 = none, 1 = waiting for JS resolution, 2 = resolved, 3 = error.
    state: c_int,
    resolved_ctx: *mut SSL_CTX,
}

#[repr(C)]
struct us_ssl_reneg_state_t {
    window_start_ms: u64,
    count: u32,
}

/// Header for the flexible-array pending-session/keylog list nodes.
/// Data follows immediately after this header in the same allocation.
#[repr(C)]
struct us_ssl_pending_session_t {
    next: *mut us_ssl_pending_session_t,
    length: u32,
    // `unsigned char data[]` follows
}

#[inline(always)]
unsafe fn pending_data(p: *mut us_ssl_pending_session_t) -> *mut u8 {
    // SAFETY: `p` was allocated with trailing `length` bytes after the header.
    unsafe { p.cast::<u8>().add(size_of::<us_ssl_pending_session_t>()) }
}

// ═══════════════════════════════════════════════════════════════════════════
// File-scope mutable statics
// ═══════════════════════════════════════════════════════════════════════════

static ssl_ctx_live: AtomicI64 = AtomicI64::new(0);

static mut us_ctx_ex_idx: c_int = -1;
static mut us_sni_ex_idx: c_int = -1;
static mut us_ctx_cache_ex_idx: c_int = -1;
static mut us_ctx_user_ca_ex_idx: c_int = -1;
static mut us_ssl_reneg_state_idx: c_int = -1;
static mut us_ssl_sni_pending_idx: c_int = -1;
static mut us_ssl_listener_ex_idx: c_int = -1;
static mut us_ssl_is_socket_ex_idx: c_int = -1;
static mut us_ssl_pending_session_idx: c_int = -1;
static mut us_ssl_pending_keylog_idx: c_int = -1;

static us_ex_idx_once: Once = Once::new();

// ═══════════════════════════════════════════════════════════════════════════
// Small inline helpers
// ═══════════════════════════════════════════════════════════════════════════

#[inline(always)]
const fn ERR_GET_LIB(packed: u32) -> c_int {
    ((packed >> 24) & 0xff) as c_int
}
#[inline(always)]
const fn ERR_GET_REASON(packed: u32) -> c_int {
    (packed & 0xfff) as c_int
}
#[inline(always)]
unsafe fn OPENSSL_PUT_ERROR_SSL(reason: c_int) {
    // SAFETY: BoringSSL copies the file/line metadata; static str is valid.
    unsafe { ERR_put_error(ERR_LIB_SSL, 0, reason, c"openssl.rs".as_ptr(), line!()) };
}

#[inline(always)]
fn US_RENEG_PACK(limit: u32, window: u32) -> *mut c_void {
    (((limit as u64) << 32) | window as u64) as usize as *mut c_void
}
#[inline(always)]
fn US_RENEG_LIMIT(p: *mut c_void) -> u32 {
    ((p as usize as u64) >> 32) as u32
}
#[inline(always)]
fn US_RENEG_WINDOW(p: *mut c_void) -> u32 {
    (p as usize as u64) as u32
}

/// `s_ssl(s)` — the socket's `SSL*` (same pointer as `(*s).ssl`).
#[inline(always)]
unsafe fn s_ssl(s: *mut us_socket_t) -> *mut SSL {
    // SAFETY: caller guarantees `s` is live.
    unsafe { (*s).ssl }
}
#[inline(always)]
unsafe fn group_loop(s: *mut us_socket_t) -> *mut us_loop_t {
    // SAFETY: caller guarantees `s` is live and linked to a group.
    unsafe { (*(*s).group).loop_ }
}
#[inline(always)]
unsafe fn loop_lsd(loop_: *mut us_loop_t) -> *mut loop_ssl_data {
    // SAFETY: `loop_` is a live loop; `ssl_data` is an opaque `void*`.
    unsafe { (*loop_).data.ssl_data.cast::<loop_ssl_data>() }
}
#[inline(always)]
unsafe fn poll_of(s: *mut us_socket_t) -> *mut us_poll_t {
    s.cast()
}

/// True once a re-entrant `us_socket_close` has run inside a dispatch.
#[inline(always)]
unsafe fn ssl_gone(s: *mut us_socket_t) -> bool {
    // SAFETY: `s` is live (its storage is not freed until post-close sweep).
    unsafe { us_socket_is_closed(s) != 0 || (*s).ssl.is_null() }
}

// Trampoline for `sk_X509_pop_free(stack, X509_free)` (inline in C).
unsafe extern "C" fn call_free_func(
    free_func: Option<unsafe extern "C" fn(*mut c_void)>,
    ptr: *mut c_void,
) {
    if let Some(f) = free_func {
        // SAFETY: `ptr` is an element being drained from the stack.
        unsafe { f(ptr) }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bookkeeping / ex_data plumbing
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub extern "C" fn us_ssl_ctx_live_count() -> c_long {
    ssl_ctx_live.load(Ordering::SeqCst) as c_long
}

unsafe extern "C" fn us_ssl_sni_pending_free(
    _parent: *mut c_void,
    ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    let st = ptr.cast::<us_ssl_sni_pending_t>();
    if st.is_null() {
        return;
    }
    // SAFETY: `st` was `us_calloc`'d and owned by the SSL ex_data slot.
    unsafe {
        if !(*st).resolved_ctx.is_null() {
            SSL_CTX_free((*st).resolved_ctx);
        }
        us_free(st.cast());
    }
}

unsafe extern "C" fn us_ctx_ex_free(
    _parent: *mut c_void,
    _ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    ssl_ctx_live.fetch_sub(1, Ordering::SeqCst);
}

unsafe extern "C" fn us_ssl_reneg_state_free(
    _parent: *mut c_void,
    ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    // SAFETY: `ptr` is null or a `us_calloc`'d `us_ssl_reneg_state_t`.
    unsafe { us_free(ptr) };
}

unsafe extern "C" fn us_ssl_pending_session_free(
    _parent: *mut c_void,
    ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    let mut pending = ptr.cast::<us_ssl_pending_session_t>();
    // SAFETY: each node was `malloc`'d by the new-session/keylog callback.
    unsafe {
        while !pending.is_null() {
            let next = (*pending).next;
            libc::free(pending.cast());
            pending = next;
        }
    }
}

/// NSS key-log lines are parked on the `SSL` and delivered once the read
/// unwinds. Stored bytes already carry the trailing newline Node appends.
unsafe extern "C" fn us_ssl_keylog_cb(cssl: *const SSL, line: *const c_char) {
    let ssl = cssl as *mut SSL;
    // SAFETY: `ssl` is a live SSL being handshaken; `line` is NUL-terminated.
    unsafe {
        if SSL_get_ex_data(ssl, us_ssl_is_socket_ex_idx).is_null() {
            return;
        }
        let line_len = libc::strlen(line);
        if line_len == 0 || line_len > US_SSL_PENDING_KEYLOG_LINE_MAX {
            return;
        }
        let pending = libc::malloc(size_of::<us_ssl_pending_session_t>() + line_len + 1)
            .cast::<us_ssl_pending_session_t>();
        if pending.is_null() {
            return;
        }
        let data = pending_data(pending);
        ptr::copy_nonoverlapping(line.cast::<u8>(), data, line_len);
        *data.add(line_len) = b'\n';
        (*pending).length = (line_len + 1) as u32;
        (*pending).next = ptr::null_mut();
        let mut head =
            SSL_get_ex_data(ssl, us_ssl_pending_keylog_idx).cast::<us_ssl_pending_session_t>();
        if head.is_null() {
            SSL_set_ex_data(ssl, us_ssl_pending_keylog_idx, pending.cast());
        } else {
            while !(*head).next.is_null() {
                head = (*head).next;
            }
            (*head).next = pending;
        }
    }
}

unsafe fn ssl_flush_pending_keylog(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket; dispatch may close it mid-loop.
    unsafe {
        if (*s).ssl.is_null() || us_socket_is_closed(s) != 0 {
            return;
        }
        let mut pending =
            SSL_get_ex_data((*s).ssl, us_ssl_pending_keylog_idx).cast::<us_ssl_pending_session_t>();
        if pending.is_null() {
            return;
        }
        SSL_set_ex_data((*s).ssl, us_ssl_pending_keylog_idx, ptr::null_mut());
        while !pending.is_null() {
            let next = (*pending).next;
            if us_socket_is_closed(s) == 0 && !(*s).ssl.is_null() {
                us_dispatch_keylog(s, pending_data(pending), (*pending).length as c_int);
            }
            libc::free(pending.cast());
            pending = next;
        }
    }
}

/// Park a new resumable session serialized with `i2d_SSL_SESSION`. Runs from
/// inside `SSL_read`/`SSL_do_handshake`, so it must not re-enter JS.
unsafe extern "C" fn us_ssl_new_session_cb(ssl: *mut SSL, session: *mut SSL_SESSION) -> c_int {
    // SAFETY: `ssl` and `session` are live BoringSSL objects.
    unsafe {
        if SSL_get_ex_data(ssl, us_ssl_is_socket_ex_idx).is_null() {
            return 0;
        }
        let length = i2d_SSL_SESSION(session, ptr::null_mut());
        if length <= 0 || length > US_SSL_PENDING_SESSION_MAX {
            return 0;
        }
        let pending = libc::malloc(size_of::<us_ssl_pending_session_t>() + length as usize)
            .cast::<us_ssl_pending_session_t>();
        if pending.is_null() {
            return 0;
        }
        let mut out = pending_data(pending);
        (*pending).length = i2d_SSL_SESSION(session, &mut out) as u32;
        (*pending).next = ptr::null_mut();
        // Append: each NewSessionTicket gets its own 'session' event in arrival order.
        let mut head =
            SSL_get_ex_data(ssl, us_ssl_pending_session_idx).cast::<us_ssl_pending_session_t>();
        if head.is_null() {
            SSL_set_ex_data(ssl, us_ssl_pending_session_idx, pending.cast());
        } else {
            while !(*head).next.is_null() {
                head = (*head).next;
            }
            (*head).next = pending;
        }
    }
    // 0: we serialized a copy; the caller keeps ownership of `session`.
    0
}

/// Deliver a parked session. JS may close the socket — callers must check
/// `ssl_gone(s)` afterwards.
unsafe fn ssl_flush_pending_session(s: *mut us_socket_t) {
    // SAFETY: `s` is a live socket; dispatch may close it mid-loop.
    unsafe {
        if (*s).ssl.is_null() || us_socket_is_closed(s) != 0 {
            return;
        }
        let mut pending = SSL_get_ex_data((*s).ssl, us_ssl_pending_session_idx)
            .cast::<us_ssl_pending_session_t>();
        if pending.is_null() {
            return;
        }
        SSL_set_ex_data((*s).ssl, us_ssl_pending_session_idx, ptr::null_mut());
        while !pending.is_null() {
            let next = (*pending).next;
            if us_socket_is_closed(s) == 0 && !(*s).ssl.is_null() {
                us_dispatch_session(s, pending_data(pending), (*pending).length as c_int);
            }
            libc::free(pending.cast());
            pending = next;
        }
    }
}

fn us_ex_idx_init() {
    // SAFETY: BoringSSL's ex_new_index functions are thread-safe; `Once`
    // guarantees single initialization of the static mut indices.
    unsafe {
        us_ctx_ex_idx = SSL_CTX_get_ex_new_index(
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            Some(us_ctx_ex_free),
        );
        us_sni_ex_idx =
            SSL_CTX_get_ex_new_index(0, ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), None);
        us_ctx_cache_ex_idx = SSL_CTX_get_ex_new_index(
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            Some(bun_ssl_ctx_cache_on_free),
        );
        us_ctx_user_ca_ex_idx =
            SSL_CTX_get_ex_new_index(0, ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), None);
        us_ssl_reneg_state_idx = SSL_get_ex_new_index(
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            Some(us_ssl_reneg_state_free),
        );
        us_ssl_sni_pending_idx = SSL_get_ex_new_index(
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            Some(us_ssl_sni_pending_free),
        );
        us_ssl_listener_ex_idx =
            SSL_get_ex_new_index(0, ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), None);
        us_ssl_is_socket_ex_idx =
            SSL_get_ex_new_index(0, ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), None);
        us_ssl_pending_session_idx = SSL_get_ex_new_index(
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            Some(us_ssl_pending_session_free),
        );
        us_ssl_pending_keylog_idx = SSL_get_ex_new_index(
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            Some(us_ssl_pending_session_free),
        );
    }
}

#[inline]
fn us_ex_idx_ensure() {
    us_ex_idx_once.call_once(us_ex_idx_init);
}

#[inline]
fn us_ssl_ctx_ex_idx() -> c_int {
    us_ex_idx_ensure();
    // SAFETY: written once under `Once`, read-only afterwards.
    unsafe { us_ctx_ex_idx }
}

/// Opt this `SSL` into the parked session/keylog queues (TLS-over-duplex /
/// named-pipe owners). The wrapper drains via `us_ssl_pop_pending_*`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_enable_pending_events(ssl: *mut SSL) {
    us_ex_idx_ensure();
    // SAFETY: `ssl` is a live SSL; `1` is a non-deref'd marker.
    unsafe { SSL_set_ex_data(ssl, us_ssl_is_socket_ex_idx, 1 as *mut c_void) };
}

unsafe fn us_ssl_pop_pending(ssl: *mut SSL, idx: c_int, out: *mut u8, out_cap: c_int) -> c_int {
    if idx < 0 {
        return 0;
    }
    // SAFETY: `ssl` is live; ex_data slot holds the list head we parked.
    unsafe {
        let pending = SSL_get_ex_data(ssl, idx).cast::<us_ssl_pending_session_t>();
        if pending.is_null() {
            return 0;
        }
        SSL_set_ex_data(ssl, idx, (*pending).next.cast());
        let mut len = (*pending).length as c_int;
        if len > out_cap {
            // Parking sites cap entries; callers pass buffers at least that
            // large, so this is unreachable. Drop rather than overflow.
            len = 0;
        } else {
            ptr::copy_nonoverlapping(pending_data(pending), out, len as usize);
        }
        libc::free(pending.cast());
        len
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_pop_pending_session(
    ssl: *mut SSL,
    out: *mut u8,
    out_cap: c_int,
) -> c_int {
    // SAFETY: delegated.
    unsafe { us_ssl_pop_pending(ssl, us_ssl_pending_session_idx, out, out_cap) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_pop_pending_keylog(
    ssl: *mut SSL,
    out: *mut u8,
    out_cap: c_int,
) -> c_int {
    // SAFETY: delegated.
    unsafe { us_ssl_pop_pending(ssl, us_ssl_pending_keylog_idx, out, out_cap) }
}

#[unsafe(no_mangle)]
pub extern "C" fn us_ssl_ctx_cache_ex_idx() -> c_int {
    us_ex_idx_ensure();
    // SAFETY: written once under `Once`.
    unsafe { us_ctx_cache_ex_idx }
}

#[inline]
unsafe fn us_reneg_policy(ssl: *mut SSL, limit: &mut u32, window: &mut u32) {
    // SAFETY: `ssl` is live; ex_data slot holds a packed integer, never deref'd.
    let packed = unsafe {
        if us_ctx_ex_idx >= 0 {
            SSL_CTX_get_ex_data(SSL_get_SSL_CTX(ssl), us_ctx_ex_idx)
        } else {
            ptr::null_mut()
        }
    };
    *limit = if !packed.is_null() {
        US_RENEG_LIMIT(packed)
    } else {
        3
    };
    *window = if !packed.is_null() {
        US_RENEG_WINDOW(packed)
    } else {
        600
    };
}

#[inline]
unsafe fn us_reneg_state(ssl: *mut SSL) -> *mut us_ssl_reneg_state_t {
    us_ex_idx_ensure();
    // SAFETY: `ssl` is live; lazily allocate the per-connection reneg counter.
    unsafe {
        let mut st = SSL_get_ex_data(ssl, us_ssl_reneg_state_idx).cast::<us_ssl_reneg_state_t>();
        if st.is_null() {
            st = us_calloc(1, size_of::<us_ssl_reneg_state_t>()).cast();
            SSL_set_ex_data(ssl, us_ssl_reneg_state_idx, st.cast());
        }
        st
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BIO plumbing — one shared mem-BIO pair per loop
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn passphrase_cb(
    buf: *mut c_char,
    size: c_int,
    _rwflag: c_int,
    u: *mut c_void,
) -> c_int {
    // SAFETY: `u` is the strdup'd passphrase set on the SSL_CTX; `buf` has `size` bytes.
    unsafe {
        let passphrase = u.cast::<c_char>();
        let passphrase_length = libc::strlen(passphrase);
        if passphrase_length > size as usize {
            return -1;
        }
        ptr::copy_nonoverlapping(passphrase, buf, passphrase_length);
        passphrase_length as c_int
    }
}

unsafe extern "C" fn BIO_s_custom_create(bio: *mut BIO) -> c_int {
    // SAFETY: `bio` is the freshly-allocated BIO being initialized.
    unsafe { BIO_set_init(bio, 1) };
    1
}

unsafe extern "C" fn BIO_s_custom_ctrl(
    _bio: *mut BIO,
    cmd: c_int,
    _num: c_long,
    _user: *mut c_void,
) -> c_long {
    match cmd {
        BIO_CTRL_FLUSH => 1,
        _ => 0,
    }
}

/// Save the per-loop BIO routing state around a JS callback that runs from
/// inside `SSL_do_handshake`/`SSL_read`. `out` must be a `void*[5]`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_loop_state_save(
    ssl_ptr: *mut c_void,
    out: *mut *mut c_void,
) {
    // SAFETY: `ssl_ptr` is an `SSL*`; its wbio's data is our `loop_ssl_data`.
    unsafe {
        let ssl = ssl_ptr.cast::<SSL>();
        let d = BIO_get_data(SSL_get_wbio(ssl)).cast::<loop_ssl_data>();
        *out.add(0) = d.cast();
        if d.is_null() {
            *out.add(1) = ptr::null_mut();
            *out.add(2) = ptr::null_mut();
            *out.add(3) = ptr::null_mut();
            *out.add(4) = ptr::null_mut();
        } else {
            *out.add(1) = (*d).ssl_socket.cast();
            *out.add(2) = (*d).ssl_read_input.cast();
            *out.add(3) = (*d).ssl_read_input_length as usize as *mut c_void;
            *out.add(4) = (*d).ssl_read_input_offset as usize as *mut c_void;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_loop_state_restore(saved: *mut *mut c_void) {
    // SAFETY: `saved` is the `void*[5]` filled by `_save` above.
    unsafe {
        let d = (*saved.add(0)).cast::<loop_ssl_data>();
        if d.is_null() {
            return;
        }
        (*d).ssl_socket = (*saved.add(1)).cast();
        (*d).ssl_read_input = (*saved.add(2)).cast();
        (*d).ssl_read_input_length = (*saved.add(3)) as usize as c_uint;
        (*d).ssl_read_input_offset = (*saved.add(4)) as usize as c_uint;
    }
}

unsafe extern "C" fn BIO_s_custom_write(
    bio: *mut BIO,
    data: *const c_char,
    length: c_int,
) -> c_int {
    // SAFETY: `bio`'s data slot is our per-loop `loop_ssl_data`.
    unsafe {
        let lsd = BIO_get_data(bio).cast::<loop_ssl_data>();

        // A callback marked this socket for deferred destruction: swallow the
        // flush (typically the fatal alert) so the SSL state machine completes
        // its error path instead of retrying.
        if !(*lsd).ssl_socket.is_null() && (*(*lsd).ssl_socket).ssl_pending_detach() {
            BIO_clear_retry_flags(bio);
            return length;
        }

        if (*lsd).ssl_write_batching != 0 {
            let needed = (*lsd).ssl_write_batch_len + length as c_uint;
            if needed > (*lsd).ssl_write_batch_cap {
                let mut new_cap = if (*lsd).ssl_write_batch_cap != 0 {
                    (*lsd).ssl_write_batch_cap
                } else {
                    65536
                };
                while new_cap < needed {
                    new_cap *= 2;
                }
                let grown = us_realloc((*lsd).ssl_write_batch.cast(), new_cap as usize);
                if grown.is_null() {
                    // Earlier sealed records already advanced SSL's sequence
                    // numbers; writing this one first would break wire order.
                    if !(*lsd).ssl_socket.is_null() {
                        (*(*lsd).ssl_socket).set_ssl_fatal_error(true);
                    }
                    BIO_clear_retry_flags(bio);
                    return length;
                }
                (*lsd).ssl_write_batch = grown.cast();
                (*lsd).ssl_write_batch_cap = new_cap;
            }
            ptr::copy_nonoverlapping(
                data,
                (*lsd)
                    .ssl_write_batch
                    .add((*lsd).ssl_write_batch_len as usize),
                length as usize,
            );
            (*lsd).ssl_write_batch_len = needed;
            BIO_clear_retry_flags(bio);
            return length;
        }

        let written = us_socket_raw_write((*lsd).ssl_socket, data, length);
        BIO_clear_retry_flags(bio);
        if written == 0 {
            BIO_set_retry_write(bio);
            return -1;
        }
        written
    }
}

/// Flush the ciphertext batch in one write. A partial write spills the
/// remainder into the loop's single spill slot. Returns 1 when the wire took
/// everything, 0 when a spill is now pending.
unsafe fn ssl_flush_write_batch(lsd: *mut loop_ssl_data, s: *mut us_socket_t) -> c_int {
    // SAFETY: `lsd` is the loop's ssl_data; `s` is its current socket.
    unsafe {
        let len = (*lsd).ssl_write_batch_len;
        if len == 0 {
            return 1;
        }
        (*lsd).ssl_write_batch_len = 0;
        let mut written = us_socket_raw_write(s, (*lsd).ssl_write_batch, len as c_int);
        if written < 0 {
            written = 0;
        }
        if (written as c_uint) < len {
            let remainder = len - written as c_uint;
            let spill = us_malloc(remainder as usize).cast::<c_char>();
            if spill.is_null() {
                // OOM with ciphertext in flight: SSL already advanced its
                // sequence numbers — the connection cannot stay coherent.
                (*s).set_ssl_fatal_error(true);
                return 0;
            }
            ptr::copy_nonoverlapping(
                (*lsd).ssl_write_batch.add(written as usize),
                spill,
                remainder as usize,
            );
            (*lsd).ssl_spill = spill;
            (*lsd).ssl_spill_len = remainder;
            (*lsd).ssl_spill_off = 0;
            (*lsd).ssl_spill_owner = s;
            return 0;
        }
        1
    }
}

/// Returns 1 when clear (or not ours), 0 while ciphertext is still pending.
unsafe fn ssl_drain_spill(lsd: *mut loop_ssl_data, s: *mut us_socket_t) -> c_int {
    // SAFETY: `lsd` is the loop's ssl_data; `s` is a live socket.
    unsafe {
        if (*lsd).ssl_spill_owner != s {
            return 1;
        }
        let pending = (*lsd).ssl_spill_len - (*lsd).ssl_spill_off;
        let mut written = us_socket_raw_write(
            s,
            (*lsd).ssl_spill.add((*lsd).ssl_spill_off as usize),
            pending as c_int,
        );
        if written < 0 {
            written = 0;
        }
        (*lsd).ssl_spill_off += written as c_uint;
        if (*lsd).ssl_spill_off == (*lsd).ssl_spill_len {
            us_free((*lsd).ssl_spill.cast());
            (*lsd).ssl_spill = ptr::null_mut();
            (*lsd).ssl_spill_len = 0;
            (*lsd).ssl_spill_off = 0;
            (*lsd).ssl_spill_owner = ptr::null_mut();
            return 1;
        }
        0
    }
}

/// Release the spill slot when its owner dies (close path).
unsafe fn ssl_release_spill(loop_: *mut us_loop_t, s: *mut us_socket_t) {
    // SAFETY: `loop_` is live; `s` may own the spill slot.
    unsafe {
        let lsd = loop_lsd(loop_);
        if !lsd.is_null() && (*lsd).ssl_spill_owner == s {
            // Give the kernel one last chance to take it.
            ssl_drain_spill(lsd, s);
        }
        if !lsd.is_null() && (*lsd).ssl_spill_owner == s {
            us_free((*lsd).ssl_spill.cast());
            (*lsd).ssl_spill = ptr::null_mut();
            (*lsd).ssl_spill_len = 0;
            (*lsd).ssl_spill_off = 0;
            (*lsd).ssl_spill_owner = ptr::null_mut();
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_socket_relocated(
    loop_: *mut us_loop_t,
    old_s: *mut us_socket_t,
    new_s: *mut us_socket_t,
) {
    // SAFETY: `loop_` is live; updates raw-pointer identity tracking.
    unsafe {
        let lsd = loop_lsd(loop_);
        if lsd.is_null() {
            return;
        }
        if (*lsd).ssl_spill_owner == old_s {
            (*lsd).ssl_spill_owner = new_s;
        }
        if (*lsd).ssl_last_fatal_error_owner == old_s.cast() {
            (*lsd).ssl_last_fatal_error_owner = new_s.cast();
        }
    }
}

unsafe extern "C" fn BIO_s_custom_read(
    bio: *mut BIO,
    dst: *mut c_char,
    mut length: c_int,
) -> c_int {
    // SAFETY: `bio`'s data slot is our per-loop `loop_ssl_data`.
    unsafe {
        let lsd = BIO_get_data(bio).cast::<loop_ssl_data>();

        BIO_clear_retry_flags(bio);
        if (*lsd).ssl_read_input_length == 0 {
            BIO_set_retry_read(bio);
            return -1;
        }
        if length as c_uint > (*lsd).ssl_read_input_length {
            length = (*lsd).ssl_read_input_length as c_int;
        }
        ptr::copy_nonoverlapping(
            (*lsd)
                .ssl_read_input
                .add((*lsd).ssl_read_input_offset as usize),
            dst,
            length as usize,
        );
        (*lsd).ssl_read_input_offset += length as c_uint;
        (*lsd).ssl_read_input_length -= length as c_uint;
        length
    }
}

unsafe fn ssl_set_loop_data(s: *mut us_socket_t) -> *mut loop_ssl_data {
    // SAFETY: `s` is live and linked; ssl_data was initialized for this loop.
    unsafe {
        let lsd = loop_lsd(group_loop(s));
        (*lsd).ssl_read_input_length = 0;
        (*lsd).ssl_read_input_offset = 0;
        (*lsd).ssl_socket = s;
        lsd
    }
}

/// The loop's shared TLS plaintext buffer. Split out so the fault injector can
/// fail this one allocation (only happens where the OS does not overcommit).
unsafe fn ssl_alloc_read_output() -> *mut c_char {
    #[cfg(socket_fault_injection)]
    {
        let mut injected: libc::ssize_t = 0;
        let mut unused: c_int = 0;
        if crate::fault_inject::us_fault_check(
            crate::fault_inject::US_FAULT_SSL_LOOP_BUFFER,
            -1,
            &mut injected,
            &mut unused,
        ) {
            return ptr::null_mut();
        }
    }
    // SAFETY: plain heap allocation; caller checks for null.
    unsafe { us_malloc(LIBUS_RECV_BUFFER_LENGTH + LIBUS_RECV_BUFFER_PADDING * 2).cast() }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_init_loop_ssl_data(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is a live loop; idempotent on `ssl_data` already set.
    unsafe {
        if !(*loop_).data.ssl_data.is_null() {
            return;
        }
        let lsd = us_calloc(1, size_of::<loop_ssl_data>()).cast::<loop_ssl_data>();
        if lsd.is_null() {
            Bun__outOfMemory();
        }
        (*lsd).ssl_read_output = ssl_alloc_read_output();
        if (*lsd).ssl_read_output.is_null() {
            Bun__outOfMemory();
        }

        OPENSSL_init_ssl(0, ptr::null());

        (*lsd).shared_biom = BIO_meth_new(BIO_TYPE_MEM, c"\xC2\xB5S BIO".as_ptr());
        if (*lsd).shared_biom.is_null() {
            Bun__outOfMemory();
        }
        BIO_meth_set_create((*lsd).shared_biom, Some(BIO_s_custom_create));
        BIO_meth_set_write((*lsd).shared_biom, Some(BIO_s_custom_write));
        BIO_meth_set_read((*lsd).shared_biom, Some(BIO_s_custom_read));
        BIO_meth_set_ctrl((*lsd).shared_biom, Some(BIO_s_custom_ctrl));

        (*lsd).shared_rbio = BIO_new((*lsd).shared_biom);
        (*lsd).shared_wbio = BIO_new((*lsd).shared_biom);
        if (*lsd).shared_rbio.is_null() || (*lsd).shared_wbio.is_null() {
            Bun__outOfMemory();
        }
        BIO_set_data((*lsd).shared_rbio, lsd.cast());
        BIO_set_data((*lsd).shared_wbio, lsd.cast());

        (*loop_).data.ssl_data = lsd.cast();
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_free_loop_ssl_data(loop_: *mut us_loop_t) {
    // SAFETY: `loop_` is live; `ssl_data` is either null or ours.
    unsafe {
        let lsd = loop_lsd(loop_);
        if lsd.is_null() {
            return;
        }
        us_free((*lsd).ssl_read_output.cast());
        us_free((*lsd).ssl_write_batch.cast());
        us_free((*lsd).ssl_spill.cast());
        BIO_free((*lsd).shared_rbio);
        BIO_free((*lsd).shared_wbio);
        BIO_meth_free((*lsd).shared_biom);
        us_free(lsd.cast());
        // The init guard reads this: leaving it dangling would reuse freed data.
        (*loop_).data.ssl_data = ptr::null_mut();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SSL_CTX construction
// ═══════════════════════════════════════════════════════════════════════════

unsafe fn us_ssl_ctx_use_privatekey_content(
    ctx: *mut SSL_CTX,
    content: *const c_char,
    ty: c_int,
) -> c_int {
    if content.is_null() {
        return 0;
    }
    let mut ret = 0;
    // SAFETY: `content` is NUL-terminated; BoringSSL fns only read within bounds.
    unsafe {
        let in_ = BIO_new_mem_buf(content.cast(), libc::strlen(content) as isize);
        if in_.is_null() {
            OPENSSL_PUT_ERROR_SSL(ERR_LIB_BUF);
            BIO_free(in_);
            return ret;
        }
        let pkey;
        let reason_code;
        if ty == SSL_FILETYPE_PEM {
            reason_code = ERR_LIB_PEM;
            pkey = PEM_read_bio_PrivateKey(
                in_,
                ptr::null_mut(),
                SSL_CTX_get_default_passwd_cb(ctx),
                SSL_CTX_get_default_passwd_cb_userdata(ctx),
            );
        } else if ty == SSL_FILETYPE_ASN1 {
            reason_code = ERR_LIB_ASN1;
            pkey = d2i_PrivateKey_bio(in_, ptr::null_mut());
        } else {
            OPENSSL_PUT_ERROR_SSL(SSL_R_BAD_SSL_FILETYPE);
            BIO_free(in_);
            return ret;
        }
        if pkey.is_null() {
            OPENSSL_PUT_ERROR_SSL(reason_code);
            BIO_free(in_);
            return ret;
        }
        ret = SSL_CTX_use_PrivateKey(ctx, pkey);
        EVP_PKEY_free(pkey);
        BIO_free(in_);
    }
    ret
}

unsafe fn add_ca_cert_to_ctx_store(
    ctx: *mut SSL_CTX,
    content: *const c_char,
    store: *mut X509_STORE,
) -> c_int {
    ERR_clear_error();
    let mut count = 0;
    if content.is_null() {
        return 0;
    }
    // SAFETY: `content` is NUL-terminated; BoringSSL owns `in_` and each `x`.
    unsafe {
        let in_ = BIO_new_mem_buf(content.cast(), libc::strlen(content) as isize);
        if in_.is_null() {
            OPENSSL_PUT_ERROR_SSL(ERR_LIB_BUF);
        } else {
            loop {
                let x = PEM_read_bio_X509(
                    in_,
                    ptr::null_mut(),
                    SSL_CTX_get_default_passwd_cb(ctx),
                    SSL_CTX_get_default_passwd_cb_userdata(ctx),
                );
                if x.is_null() {
                    break;
                }
                X509_STORE_add_cert(store, x);
                if SSL_CTX_add_client_CA(ctx, x) == 0 {
                    X509_free(x);
                    BIO_free(in_);
                    return 0;
                }
                count += 1;
                X509_free(x);
            }
        }
        BIO_free(in_);
        if count == 0 {
            // PEM loop ends with `PEM_R_NO_START_LINE` once no (more) blocks.
            // A PEM doc with zero certificates is ignored like Node does.
            let pem_err = ERR_peek_last_error();
            if (pem_err == 0
                || (ERR_GET_LIB(pem_err) == ERR_LIB_PEM
                    && ERR_GET_REASON(pem_err) == PEM_R_NO_START_LINE))
                && !libc::strstr(content, c"-----BEGIN ".as_ptr()).is_null()
            {
                ERR_clear_error();
                return 1;
            }
            return 0;
        }
    }
    ERR_clear_error();
    1
}

unsafe fn us_ssl_ctx_use_certificate_chain(ctx: *mut SSL_CTX, content: *const c_char) -> c_int {
    ERR_clear_error();
    if content.is_null() {
        return 0;
    }
    let mut ret = 0;
    let mut x: *mut X509 = ptr::null_mut();
    // SAFETY: `content` is NUL-terminated; chain certs are transferred via add0.
    unsafe {
        let in_ = BIO_new_mem_buf(content.cast(), libc::strlen(content) as isize);
        'end: {
            if in_.is_null() {
                OPENSSL_PUT_ERROR_SSL(ERR_LIB_BUF);
                break 'end;
            }
            x = PEM_read_bio_X509_AUX(
                in_,
                ptr::null_mut(),
                SSL_CTX_get_default_passwd_cb(ctx),
                SSL_CTX_get_default_passwd_cb_userdata(ctx),
            );
            if x.is_null() {
                OPENSSL_PUT_ERROR_SSL(ERR_LIB_PEM);
                break 'end;
            }
            ret = SSL_CTX_use_certificate(ctx, x);
            if ERR_peek_error() != 0 {
                ret = 0;
            }
            if ret != 0 {
                SSL_CTX_clear_chain_certs(ctx);
                loop {
                    let ca = PEM_read_bio_X509(
                        in_,
                        ptr::null_mut(),
                        SSL_CTX_get_default_passwd_cb(ctx),
                        SSL_CTX_get_default_passwd_cb_userdata(ctx),
                    );
                    if ca.is_null() {
                        break;
                    }
                    if SSL_CTX_add0_chain_cert(ctx, ca) == 0 {
                        X509_free(ca);
                        ret = 0;
                        break 'end;
                    }
                }
                let err = ERR_peek_last_error();
                if ERR_GET_LIB(err) == ERR_LIB_PEM && ERR_GET_REASON(err) == PEM_R_NO_START_LINE {
                    ERR_clear_error();
                } else {
                    ret = 0;
                }
            }
        }
        X509_free(x);
        BIO_free(in_);
    }
    ret
}

unsafe extern "C" fn us_verify_callback(_preverify_ok: c_int, _ctx: *mut X509_STORE_CTX) -> c_int {
    // Always continue; the decision is deferred to JS via `verify_error`.
    1
}

/// Drop the strdup'd passphrase once private-key load completes so the secret
/// never outlives ctx construction.
unsafe fn ssl_ctx_drop_passphrase(ctx: *mut SSL_CTX) {
    // SAFETY: `ctx` is live; userdata is either null or our strdup'd copy.
    unsafe {
        let password = SSL_CTX_get_default_passwd_cb_userdata(ctx);
        if !password.is_null() {
            us_free(password);
            SSL_CTX_set_default_passwd_cb_userdata(ctx, ptr::null_mut());
        }
    }
}

unsafe fn ssl_ctx_build_fail(ctx: *mut SSL_CTX) {
    // SAFETY: ex_data slot already set, so free_func decrements `ssl_ctx_live`.
    unsafe {
        ssl_ctx_drop_passphrase(ctx);
        SSL_CTX_free(ctx);
    }
}

/// Platform-neutral `strdup` via libc malloc (Windows libc exposes `_strdup`).
unsafe fn c_strdup(s: *const c_char) -> *mut c_char {
    // SAFETY: `s` is NUL-terminated; allocate `len+1` and copy.
    unsafe {
        let len = libc::strlen(s);
        let out = libc::malloc(len + 1).cast::<c_char>();
        if !out.is_null() {
            ptr::copy_nonoverlapping(s, out, len + 1);
        }
        out
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_ctx_build_raw(
    options: us_bun_socket_context_options_t,
    err: *mut c_int,
) -> *mut SSL_CTX {
    // SAFETY: `options` fields are either null or valid NUL-terminated strings
    // / arrays owned by the caller for the duration of this call.
    unsafe {
        ERR_clear_error();

        let ssl_context = SSL_CTX_new(TLS_method().cast());
        ssl_ctx_live.fetch_add(1, Ordering::SeqCst);
        // Register the live-count free_func first so every exit balances.
        SSL_CTX_set_ex_data(ssl_context, us_ssl_ctx_ex_idx(), ptr::null_mut());

        // Default options the BIO logic relies on.
        SSL_CTX_set_read_ahead(ssl_context, 1);
        SSL_CTX_set_mode(ssl_context, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
        SSL_CTX_set_min_proto_version(
            ssl_context,
            if options.ssl_min_version != 0 {
                options.ssl_min_version as u16
            } else {
                TLS1_2_VERSION
            },
        );
        if options.ssl_max_version != 0 {
            SSL_CTX_set_max_proto_version(ssl_context, options.ssl_max_version as u16);
        }
        if options.ssl_prefer_low_memory_usage != 0 {
            SSL_CTX_set_mode(ssl_context, SSL_MODE_RELEASE_BUFFERS);
        }

        if !options.passphrase.is_null() {
            SSL_CTX_set_default_passwd_cb_userdata(
                ssl_context,
                c_strdup(options.passphrase).cast(),
            );
            SSL_CTX_set_default_passwd_cb(ssl_context, Some(passphrase_cb));
        }

        // Multiple identities are loaded pair-wise so mixed RSA/EC pairs don't
        // mis-match under BoringSSL's legacy single-slot API.
        let interleave_identities = options.cert_file_name.is_null()
            && options.key_file_name.is_null()
            && !options.cert.is_null()
            && !options.key.is_null()
            && options.cert_count == options.key_count
            && options.cert_count > 1;
        if interleave_identities {
            for i in 0..options.cert_count as usize {
                if us_ssl_ctx_use_certificate_chain(ssl_context, *options.cert.add(i)) != 1
                    || us_ssl_ctx_use_privatekey_content(
                        ssl_context,
                        *options.key.add(i),
                        SSL_FILETYPE_PEM,
                    ) != 1
                {
                    ssl_ctx_build_fail(ssl_context);
                    return ptr::null_mut();
                }
            }
        } else {
            if !options.cert_file_name.is_null() {
                if SSL_CTX_use_certificate_chain_file(ssl_context, options.cert_file_name) != 1 {
                    ssl_ctx_build_fail(ssl_context);
                    return ptr::null_mut();
                }
            } else if !options.cert.is_null() && options.cert_count > 0 {
                for i in 0..options.cert_count as usize {
                    if us_ssl_ctx_use_certificate_chain(ssl_context, *options.cert.add(i)) != 1 {
                        ssl_ctx_build_fail(ssl_context);
                        return ptr::null_mut();
                    }
                }
            }

            if !options.key_file_name.is_null() {
                if SSL_CTX_use_PrivateKey_file(ssl_context, options.key_file_name, SSL_FILETYPE_PEM)
                    != 1
                {
                    ssl_ctx_build_fail(ssl_context);
                    return ptr::null_mut();
                }
            } else if !options.key.is_null() && options.key_count > 0 {
                for i in 0..options.key_count as usize {
                    if us_ssl_ctx_use_privatekey_content(
                        ssl_context,
                        *options.key.add(i),
                        SSL_FILETYPE_PEM,
                    ) != 1
                    {
                        ssl_ctx_build_fail(ssl_context);
                        return ptr::null_mut();
                    }
                }
            }
        }
        // passwd_cb is only consulted above; the secret is dead now.
        ssl_ctx_drop_passphrase(ssl_context);

        let verify_mode = if options.reject_unauthorized != 0 {
            SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT
        } else {
            SSL_VERIFY_PEER
        };

        if !options.ca_file_name.is_null() {
            let ca_list = SSL_load_client_CA_file(options.ca_file_name);
            if ca_list.is_null() {
                *err = CREATE_BUN_SOCKET_ERROR_LOAD_CA_FILE;
                ssl_ctx_build_fail(ssl_context);
                return ptr::null_mut();
            }
            SSL_CTX_set_client_CA_list(ssl_context, ca_list);
            us_ex_idx_ensure();
            SSL_CTX_set_ex_data(ssl_context, us_ctx_user_ca_ex_idx, 1 as *mut c_void);
            if SSL_CTX_load_verify_locations(ssl_context, options.ca_file_name, ptr::null()) != 1 {
                *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA_FILE;
                ssl_ctx_build_fail(ssl_context);
                return ptr::null_mut();
            }
            SSL_CTX_set_verify(ssl_context, verify_mode, Some(us_verify_callback));
        } else if !options.ca.is_null() && options.ca_count > 0 {
            us_ex_idx_ensure();
            SSL_CTX_set_ex_data(ssl_context, us_ctx_user_ca_ex_idx, 1 as *mut c_void);
            // User CAs only, into the CTX's own initially-empty store.
            let cert_store = SSL_CTX_get_cert_store(ssl_context);
            for i in 0..options.ca_count as usize {
                if add_ca_cert_to_ctx_store(ssl_context, *options.ca.add(i), cert_store) == 0 {
                    *err = CREATE_BUN_SOCKET_ERROR_INVALID_CA;
                    ssl_ctx_build_fail(ssl_context);
                    return ptr::null_mut();
                }
                ERR_clear_error();
                SSL_CTX_set_verify(ssl_context, verify_mode, Some(us_verify_callback));
            }
        } else if options.request_cert != 0 {
            // No per-config CAs: use the process-wide shared root store.
            SSL_CTX_set_cert_store(ssl_context, us_get_shared_default_ca_store());
            SSL_CTX_set_verify(ssl_context, verify_mode, Some(us_verify_callback));
        }

        if !options.dh_params_file_name.is_null() {
            let paramfile = libc::fopen(options.dh_params_file_name, c"r".as_ptr());
            let dh_2048;
            if !paramfile.is_null() {
                dh_2048 = PEM_read_DHparams(paramfile, ptr::null_mut(), None, ptr::null_mut());
                libc::fclose(paramfile);
            } else {
                ssl_ctx_build_fail(ssl_context);
                return ptr::null_mut();
            }
            if dh_2048.is_null() {
                ssl_ctx_build_fail(ssl_context);
                return ptr::null_mut();
            }
            let set_tmp_dh = SSL_CTX_set_tmp_dh(ssl_context, dh_2048);
            DH_free(dh_2048);
            if set_tmp_dh != 1 {
                ssl_ctx_build_fail(ssl_context);
                return ptr::null_mut();
            }
            if SSL_CTX_set_cipher_list(ssl_context, DEFAULT_CIPHER_LIST.as_ptr().cast()) == 0 {
                ssl_ctx_build_fail(ssl_context);
                return ptr::null_mut();
            }
        }

        if !options.ssl_ciphers.is_null() {
            if SSL_CTX_set_cipher_list(ssl_context, options.ssl_ciphers) == 0 {
                // Peek, don't consume: caller decomposes the queued reason.
                let ssl_err = ERR_peek_error();
                if !(libc::strlen(options.ssl_ciphers) == 0
                    && ERR_GET_REASON(ssl_err) == SSL_R_NO_CIPHER_MATCH)
                {
                    *err = CREATE_BUN_SOCKET_ERROR_INVALID_CIPHERS;
                    ssl_ctx_build_fail(ssl_context);
                    return ptr::null_mut();
                }
                ERR_clear_error();
            }
        }

        if options.secure_options != 0 {
            SSL_CTX_set_options(ssl_context, options.secure_options);
        }

        SSL_CTX_set_session_cache_mode(
            ssl_context,
            SSL_SESS_CACHE_CLIENT
                | SSL_SESS_CACHE_SERVER
                | SSL_SESS_CACHE_NO_INTERNAL
                | SSL_SESS_CACHE_NO_AUTO_CLEAR,
        );
        SSL_CTX_sess_set_new_cb(ssl_context, Some(us_ssl_new_session_cb));
        SSL_CTX_set_keylog_callback(ssl_context, Some(us_ssl_keylog_cb));
        ssl_context
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_ctx_add_ca_cert(
    ctx: *mut SSL_CTX,
    content: *const c_char,
) -> c_int {
    if ctx.is_null() || content.is_null() {
        return 0;
    }
    // SAFETY: `ctx` is live; shared-store clone-on-write matches Node's
    // `SecureContext::AddCACert`.
    unsafe {
        let mut store = SSL_CTX_get_cert_store(ctx);
        let shared = us_get_shared_default_ca_store();
        let store_is_shared = !store.is_null() && store == shared;
        X509_STORE_free(shared);
        let mut store_is_empty = false;
        if !store.is_null() && !store_is_shared {
            let objs = X509_STORE_get0_objects(store);
            store_is_empty = objs.is_null() || sk_num(objs.cast()) == 0;
        }
        if store_is_shared || store_is_empty {
            let own = us_get_default_ca_store();
            if own.is_null() {
                return 0;
            }
            SSL_CTX_set_cert_store(ctx, own);
            store = own;
        }
        if store.is_null() {
            return 0;
        }
        us_ex_idx_ensure();
        SSL_CTX_set_ex_data(ctx, us_ctx_user_ca_ex_idx, 1 as *mut c_void);
        add_ca_cert_to_ctx_store(ctx, content, store)
    }
}

unsafe fn pem_from_bio(bio: *mut BIO, out: *mut *mut c_char, out_len: *mut usize) -> c_int {
    // SAFETY: `bio` is a live mem-BIO; `out`/`out_len` are valid.
    unsafe {
        let mut mem: *mut c_char = ptr::null_mut();
        let n = BIO_get_mem_data(bio, &mut mem);
        if n <= 0 || mem.is_null() {
            return 0;
        }
        let copy = libc::malloc(n as usize + 1).cast::<c_char>();
        if copy.is_null() {
            return 0;
        }
        ptr::copy_nonoverlapping(mem, copy, n as usize);
        *copy.add(n as usize) = 0;
        *out = copy;
        *out_len = n as usize;
        1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_parse_pkcs12(
    data: *const c_char,
    len: usize,
    pass: *const c_char,
    out_key: *mut *mut c_char,
    out_key_len: *mut usize,
    out_cert: *mut *mut c_char,
    out_cert_len: *mut usize,
    out_ca: *mut *mut c_char,
    out_ca_len: *mut usize,
    err_reason: *mut *const c_char,
) -> c_int {
    // SAFETY: caller owns the out-strings via `free()`; every early-out
    // clears them. `data` is valid for `len` bytes.
    unsafe {
        *out_key = ptr::null_mut();
        *out_cert = ptr::null_mut();
        *out_ca = ptr::null_mut();
        *out_key_len = 0;
        *out_cert_len = 0;
        *out_ca_len = 0;
        *err_reason = ptr::null();
        let mut ok = 0;
        let mut pkey: *mut EVP_PKEY = ptr::null_mut();
        let mut cert: *mut X509 = ptr::null_mut();
        let mut extra: *mut stack_st = ptr::null_mut();
        let mut kb: *mut BIO = ptr::null_mut();
        let mut cb: *mut BIO = ptr::null_mut();
        let mut ab: *mut BIO = ptr::null_mut();

        if len > c_int::MAX as usize {
            *err_reason = c"parse".as_ptr();
            return 0;
        }
        let in_ = BIO_new_mem_buf(data.cast(), len as isize);
        if in_.is_null() {
            *err_reason = c"parse".as_ptr();
            return 0;
        }
        let p12 = d2i_PKCS12_bio(in_, ptr::null_mut());
        BIO_free(in_);
        if p12.is_null() {
            *err_reason = c"parse".as_ptr();
            ERR_clear_error();
            return 0;
        }
        'done: {
            if PKCS12_parse(
                p12,
                if pass.is_null() { c"".as_ptr() } else { pass },
                &mut pkey,
                &mut cert,
                &mut extra,
            ) == 0
            {
                *err_reason = c"mac".as_ptr();
                ERR_clear_error();
                break 'done;
            }
            if pkey.is_null() {
                *err_reason = c"key".as_ptr();
                break 'done;
            }
            if cert.is_null() {
                *err_reason = c"cert".as_ptr();
                break 'done;
            }
            kb = BIO_new(BIO_s_mem());
            cb = BIO_new(BIO_s_mem());
            if kb.is_null()
                || cb.is_null()
                || PEM_write_bio_PrivateKey(
                    kb,
                    pkey,
                    ptr::null(),
                    ptr::null_mut(),
                    0,
                    None,
                    ptr::null_mut(),
                ) == 0
                || PEM_write_bio_X509(cb, cert) == 0
                || pem_from_bio(kb, out_key, out_key_len) == 0
                || pem_from_bio(cb, out_cert, out_cert_len) == 0
            {
                *err_reason = c"parse".as_ptr();
                break 'done;
            }
            if !extra.is_null() && sk_num(extra.cast()) > 0 {
                ab = BIO_new(BIO_s_mem());
                if !ab.is_null() {
                    for i in 0..sk_num(extra.cast()) {
                        PEM_write_bio_X509(ab, sk_value(extra.cast(), i).cast());
                    }
                    pem_from_bio(ab, out_ca, out_ca_len);
                }
            }
            ok = 1;
        }
        if ok == 0 {
            libc::free((*out_key).cast());
            libc::free((*out_cert).cast());
            libc::free((*out_ca).cast());
            *out_key = ptr::null_mut();
            *out_cert = ptr::null_mut();
            *out_ca = ptr::null_mut();
        }
        if !kb.is_null() {
            BIO_free(kb);
        }
        if !cb.is_null() {
            BIO_free(cb);
        }
        if !ab.is_null() {
            BIO_free(ab);
        }
        if !pkey.is_null() {
            EVP_PKEY_free(pkey);
        }
        if !cert.is_null() {
            X509_free(cert);
        }
        if !extra.is_null() {
            sk_pop_free_ex(
                extra,
                Some(call_free_func),
                Some(core::mem::transmute::<
                    unsafe extern "C" fn(*mut X509),
                    unsafe extern "C" fn(*mut c_void),
                >(X509_free)),
            );
        }
        PKCS12_free(p12);
        ERR_clear_error();
        ok
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_ctx_from_options(
    options: us_bun_socket_context_options_t,
    err: *mut c_int,
) -> *mut SSL_CTX {
    // SAFETY: delegated.
    unsafe {
        let ctx = us_ssl_ctx_build_raw(options, err);
        if ctx.is_null() {
            return ptr::null_mut();
        }
        // Reneg policy packed into the same ex_data slot (the void* IS the value).
        if options.client_renegotiation_limit != 0 || options.client_renegotiation_window != 0 {
            SSL_CTX_set_ex_data(
                ctx,
                us_ssl_ctx_ex_idx(),
                US_RENEG_PACK(
                    options.client_renegotiation_limit,
                    options.client_renegotiation_window,
                ),
            );
        }
        ctx
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_ctx_up_ref(p: *mut SSL_CTX) {
    if !p.is_null() {
        // SAFETY: `p` is a live SSL_CTX.
        unsafe { SSL_CTX_up_ref(p) };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_ctx_unref(p: *mut SSL_CTX) {
    if !p.is_null() {
        // SAFETY: `p` is a live SSL_CTX.
        unsafe { SSL_CTX_free(p) };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-socket SSL attach/detach
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_attach(
    s: *mut us_socket_t,
    ctx: *mut SSL_CTX,
    is_client: c_int,
    sni: *const c_char,
    listener: *mut us_listen_socket_t,
) {
    // SAFETY: `s` is live and linked; `ctx` is a borrowed SSL_CTX; `listener`
    // may be null (client / adopt-TLS paths).
    unsafe {
        us_internal_init_loop_ssl_data(group_loop(s));
        let lsd = loop_lsd(group_loop(s));

        let ssl = SSL_new(ctx);
        // Only Bun.connect / node:tls sockets surface the 'session' event.
        if !ssl.is_null()
            && (us_socket_kind(s) == BUN_SOCKET_KIND_BUN_SOCKET_TLS
                || (!listener.is_null()
                    && (*listener).accept_kind == BUN_SOCKET_KIND_BUN_SOCKET_TLS))
        {
            us_ex_idx_ensure();
            SSL_set_ex_data(ssl, us_ssl_is_socket_ex_idx, 1 as *mut c_void);
        }
        SSL_set_bio(ssl, (*lsd).shared_rbio, (*lsd).shared_wbio);
        BIO_up_ref((*lsd).shared_rbio);
        BIO_up_ref((*lsd).shared_wbio);

        if is_client != 0 {
            SSL_set_renegotiate_mode(ssl, ssl_renegotiate_explicit);
            SSL_set_connect_state(ssl);
            if !sni.is_null() {
                SSL_set_tlsext_host_name(ssl, sni);
            }
            // A mode-neutral CTX may have verify_mode == NONE; clients must
            // still populate verify_error for the JS rejectUnauthorized check.
            if SSL_CTX_get_verify_mode(ctx) == SSL_VERIFY_NONE {
                SSL_set_verify(ssl, SSL_VERIFY_PEER, Some(us_verify_callback));
                us_ex_idx_ensure();
                if SSL_CTX_get_ex_data(ctx, us_ctx_user_ca_ex_idx).is_null() {
                    let roots = us_get_shared_default_ca_store();
                    if !roots.is_null() {
                        SSL_set0_verify_cert_store(ssl, roots);
                    }
                }
            }
        } else {
            SSL_set_accept_state(ssl);
            SSL_set_renegotiate_mode(ssl, ssl_renegotiate_never);
            us_ex_idx_ensure();
            SSL_set_ex_data(ssl, us_ssl_listener_ex_idx, listener.cast());
        }

        (*s).ssl = ssl;
        (*s).set_ssl_handshake_state(HANDSHAKE_PENDING);
        (*s).set_ssl_write_wants_read(false);
        (*s).set_ssl_read_wants_write(false);
        (*s).set_ssl_fatal_error(false);
        (*s).set_ssl_raw_tap(false);
        (*s).set_ssl_shutdown_after_spill(false);
        (*s).set_ssl_close_after_spill(false);
        (*s).set_ssl_in_use(false);
        (*s).set_ssl_pending_detach(false);
        (*s).ssl_pending_close_code = 0;
        (*s).set_ssl_is_server(is_client == 0);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_detach(s: *mut us_socket_t) {
    // SAFETY: `s` is live (its storage is not freed until post-close sweep).
    unsafe {
        ssl_release_spill(group_loop(s), s);
        if !(*s).ssl.is_null() {
            if (*s).ssl_in_use() {
                // BoringSSL is on the stack; defer to the driver's epilogue.
                (*s).set_ssl_pending_detach(true);
                return;
            }
            SSL_free(s_ssl(s));
            (*s).ssl = ptr::null_mut();
            let lsd = loop_lsd(group_loop(s));
            if !lsd.is_null() && (*lsd).ssl_last_fatal_error_owner == s.cast() {
                (*lsd).ssl_last_fatal_error[0] = 0;
                (*lsd).ssl_last_fatal_error_owner = ptr::null_mut();
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Verify error reporting
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub extern "C" fn us_X509_error_code(err: c_long) -> *const c_char {
    macro_rules! c {
        ($s:literal) => {
            concat!($s, "\0").as_ptr().cast()
        };
    }
    match err {
        X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT => c!("UNABLE_TO_GET_ISSUER_CERT"),
        X509_V_ERR_UNABLE_TO_GET_CRL => c!("UNABLE_TO_GET_CRL"),
        X509_V_ERR_UNABLE_TO_DECRYPT_CERT_SIGNATURE => c!("UNABLE_TO_DECRYPT_CERT_SIGNATURE"),
        X509_V_ERR_UNABLE_TO_DECRYPT_CRL_SIGNATURE => c!("UNABLE_TO_DECRYPT_CRL_SIGNATURE"),
        X509_V_ERR_UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY => c!("UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY"),
        X509_V_ERR_CERT_SIGNATURE_FAILURE => c!("CERT_SIGNATURE_FAILURE"),
        X509_V_ERR_CRL_SIGNATURE_FAILURE => c!("CRL_SIGNATURE_FAILURE"),
        X509_V_ERR_CERT_NOT_YET_VALID => c!("CERT_NOT_YET_VALID"),
        X509_V_ERR_CERT_HAS_EXPIRED => c!("CERT_HAS_EXPIRED"),
        X509_V_ERR_CRL_NOT_YET_VALID => c!("CRL_NOT_YET_VALID"),
        X509_V_ERR_CRL_HAS_EXPIRED => c!("CRL_HAS_EXPIRED"),
        X509_V_ERR_ERROR_IN_CERT_NOT_BEFORE_FIELD => c!("ERROR_IN_CERT_NOT_BEFORE_FIELD"),
        X509_V_ERR_ERROR_IN_CERT_NOT_AFTER_FIELD => c!("ERROR_IN_CERT_NOT_AFTER_FIELD"),
        X509_V_ERR_ERROR_IN_CRL_LAST_UPDATE_FIELD => c!("ERROR_IN_CRL_LAST_UPDATE_FIELD"),
        X509_V_ERR_ERROR_IN_CRL_NEXT_UPDATE_FIELD => c!("ERROR_IN_CRL_NEXT_UPDATE_FIELD"),
        X509_V_ERR_OUT_OF_MEM => c!("OUT_OF_MEM"),
        X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT => c!("DEPTH_ZERO_SELF_SIGNED_CERT"),
        X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN => c!("SELF_SIGNED_CERT_IN_CHAIN"),
        X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY => c!("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
        X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE => c!("UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
        X509_V_ERR_CERT_CHAIN_TOO_LONG => c!("CERT_CHAIN_TOO_LONG"),
        X509_V_ERR_CERT_REVOKED => c!("CERT_REVOKED"),
        X509_V_ERR_INVALID_CA => c!("INVALID_CA"),
        X509_V_ERR_PATH_LENGTH_EXCEEDED => c!("PATH_LENGTH_EXCEEDED"),
        X509_V_ERR_INVALID_PURPOSE => c!("INVALID_PURPOSE"),
        X509_V_ERR_CERT_UNTRUSTED => c!("CERT_UNTRUSTED"),
        X509_V_ERR_CERT_REJECTED => c!("CERT_REJECTED"),
        X509_V_ERR_HOSTNAME_MISMATCH => c!("HOSTNAME_MISMATCH"),
        _ => c!("UNSPECIFIED"),
    }
}

unsafe fn us_internal_verify_peer_certificate(ssl: *const SSL, def: c_long) -> c_long {
    if ssl.is_null() {
        return def;
    }
    // SAFETY: `ssl` is a live SSL; every BoringSSL getter is read-only.
    unsafe {
        let mut err = def;
        let peer_cert = SSL_get_peer_certificate(ssl);
        if !peer_cert.is_null() {
            X509_free(peer_cert);
            err = SSL_get_verify_result(ssl);
        } else {
            let curr_cipher = SSL_get_current_cipher(ssl);
            let sess = SSL_get_session(ssl);
            if (!curr_cipher.is_null() && SSL_CIPHER_get_auth_nid(curr_cipher) == NID_auth_psk)
                || (!sess.is_null()
                    && SSL_SESSION_get_protocol_version(sess) == TLS1_3_VERSION
                    && SSL_session_reused(ssl) != 0)
            {
                return X509_V_OK;
            }
        }
        err
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_ssl_socket_verify_error_from_ssl(
    ssl: *mut SSL,
) -> us_bun_verify_error_t {
    // SAFETY: `ssl` is live (or null, handled inside).
    unsafe {
        let x509_verify_error =
            us_internal_verify_peer_certificate(ssl, X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT);
        if x509_verify_error == X509_V_OK {
            return us_bun_verify_error_t::default();
        }
        let reason = X509_verify_cert_error_string(x509_verify_error);
        let code = us_X509_error_code(x509_verify_error);
        us_bun_verify_error_t {
            error_no: x509_verify_error as c_int,
            code,
            reason,
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_verify_error(
    s: *mut us_socket_t,
) -> us_bun_verify_error_t {
    // SAFETY: `s` is live.
    unsafe {
        if (*s).ssl.is_null()
            || s_ssl(s).is_null()
            || us_socket_is_closed(s) != 0
            || us_internal_ssl_is_shut_down(s) != 0
        {
            return us_bun_verify_error_t::default();
        }
        us_ssl_socket_verify_error_from_ssl(s_ssl(s))
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Handshake state machine
// ═══════════════════════════════════════════════════════════════════════════

/// Park the fatal OpenSSL reason behind a failed `SSL_*` call for the
/// handshake-failure dispatch. Only parks while the handshake is unfinished.
unsafe fn ssl_park_fatal_reason(s: *mut us_socket_t) {
    // SAFETY: `s` is live; `lsd` may be null early in loop lifetime.
    unsafe {
        let lsd = loop_lsd(group_loop(s));
        if !lsd.is_null() && (*s).ssl_handshake_state() != HANDSHAKE_COMPLETED {
            let ssl_queue_err = ERR_peek_last_error();
            if ssl_queue_err != 0 {
                ERR_error_string_n(
                    ssl_queue_err,
                    (*lsd).ssl_last_fatal_error.as_mut_ptr(),
                    US_SSL_FATAL_ERROR_REASON_MAX,
                );
                (*lsd).ssl_last_fatal_error_owner = s.cast();
            }
        }
        ERR_clear_error();
        (*s).set_ssl_fatal_error(true);
    }
}

/// If a fatal handshake reason was parked by `s`, dispatch it as EPROTO and
/// return 1; the per-loop scratch is copied to the stack and cleared first.
unsafe fn ssl_dispatch_parked_reason(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is live; `reason` is a stack buffer the dispatch consumes synchronously.
    unsafe {
        let lsd = loop_lsd(group_loop(s));
        if lsd.is_null()
            || (*lsd).ssl_last_fatal_error[0] == 0
            || (*lsd).ssl_last_fatal_error_owner != s.cast()
        {
            return 0;
        }
        let mut reason = [0 as c_char; US_SSL_FATAL_ERROR_REASON_MAX];
        reason.copy_from_slice(&(*lsd).ssl_last_fatal_error);
        (*lsd).ssl_last_fatal_error[0] = 0;
        (*lsd).ssl_last_fatal_error_owner = ptr::null_mut();
        let verify_error = us_bun_verify_error_t {
            error_no: -71,
            code: c"EPROTO".as_ptr(),
            reason: reason.as_ptr(),
        };
        us_dispatch_handshake(s, 0, verify_error);
        1
    }
}

/// The `on_handshake` callback may `us_socket_close(s)` — callers MUST check
/// `ssl_gone(s)` immediately after this returns.
unsafe fn ssl_trigger_handshake(s: *mut us_socket_t, success: c_int) {
    // SAFETY: `s` is live.
    unsafe {
        (*s).set_ssl_handshake_state(HANDSHAKE_COMPLETED);
        if success == 0 && ssl_dispatch_parked_reason(s) != 0 {
            return;
        }
        let verify_error = us_internal_ssl_verify_error(s);
        us_dispatch_handshake(s, success, verify_error);
    }
}

unsafe fn ssl_trigger_handshake_econnreset(s: *mut us_socket_t) {
    // SAFETY: `s` is live.
    unsafe {
        (*s).set_ssl_handshake_state(HANDSHAKE_COMPLETED);
        if ssl_dispatch_parked_reason(s) != 0 {
            return;
        }
        let verify_error = us_bun_verify_error_t {
            error_no: -46,
            code: c"ECONNRESET".as_ptr(),
            reason:
                c"Client network socket disconnected before secure TLS connection was established"
                    .as_ptr(),
        };
        us_dispatch_handshake(s, 0, verify_error);
    }
}

unsafe fn ssl_renegotiate(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is live and has an SSL.
    unsafe {
        let mut limit = 0u32;
        let mut window = 0u32;
        us_reneg_policy(s_ssl(s), &mut limit, &mut window);
        let st = us_reneg_state(s_ssl(s));
        (*s).set_ssl_handshake_state(HANDSHAKE_RENEGOTIATION_PENDING);
        if st.is_null() {
            ssl_trigger_handshake(s, 0);
            return 0;
        }
        // Wall-clock can step backwards; only treat the window as elapsed
        // when time moved forward (avoids underflowing the subtraction).
        let now_ms = (libc::time(ptr::null_mut()) as u64).wrapping_mul(1000);
        if (*st).count == 0
            || (window != 0
                && now_ms >= (*st).window_start_ms
                && now_ms - (*st).window_start_ms >= window as u64 * 1000)
        {
            (*st).window_start_ms = now_ms;
            (*st).count = 0;
        }
        if (*st).count >= limit {
            ssl_trigger_handshake(s, 0);
            return 0;
        }
        (*st).count += 1;
        if SSL_renegotiate(s_ssl(s)) == 0 {
            ssl_trigger_handshake(s, 0);
            return 0;
        }
        1
    }
}

/// Returns 1 if shutdown is complete (or impossible) and the TCP socket may be
/// closed; 0 if we sent close_notify but must wait for the peer's.
unsafe fn ssl_handle_shutdown(s: *mut us_socket_t, force_fast_shutdown: bool) -> c_int {
    // SAFETY: `s` is live.
    unsafe {
        if (*s).ssl.is_null()
            || us_internal_ssl_is_shut_down(s) != 0
            || (*s).ssl_fatal_error()
            || SSL_is_init_finished(s_ssl(s)) == 0
        {
            return 1;
        }
        let state = SSL_get_shutdown(s_ssl(s));
        let sent_shutdown = state & SSL_SENT_SHUTDOWN;
        let received_shutdown = state & SSL_RECEIVED_SHUTDOWN;
        if sent_shutdown == 0 || received_shutdown == 0 {
            ssl_set_loop_data(s);
            let mut ret = SSL_shutdown(s_ssl(s));
            if ret == 0 && force_fast_shutdown {
                ret = SSL_shutdown(s_ssl(s));
            }
            if ret < 0 {
                let err = SSL_get_error(s_ssl(s), ret);
                if err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL {
                    ERR_clear_error();
                    (*s).set_ssl_fatal_error(true);
                    return 1;
                }
                if err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE {
                    // No retry path: SSL_SENT_SHUTDOWN is already set so later
                    // events short-circuit. Returning 0 would leak the SSL.
                    return 1;
                }
                (*s).set_ssl_fatal_error(true);
                return 1;
            }
            return (ret == 1) as c_int;
        }
        1
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_close(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    // SAFETY: `s` is live; this is the SSL-aware close that may defer.
    unsafe {
        if !(*s).ssl.is_null() && (*s).ssl_in_use() {
            // A JS callback inside SSL_do_handshake/SSL_read destroyed this
            // socket; re-entering BoringSSL now would UAF. Defer.
            ssl_release_spill(group_loop(s), s);
            (*s).set_ssl_pending_detach(true);
            (*s).ssl_pending_close_code = code as u8;
            return s;
        }
        if code == LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN
            && reason.is_null()
            && !(*s).ssl_close_after_spill()
            && !(*s).ssl_fatal_error()
            && us_socket_is_closed(s) == 0
        {
            let lsd = loop_lsd(group_loop(s));
            if !lsd.is_null() && ssl_drain_spill(lsd, s) == 0 {
                (*s).set_ssl_close_after_spill(true);
                return s;
            }
        }
        ssl_release_spill(group_loop(s), s);
        // SEMI_SOCKET never connected — SSL was attached eagerly; no bytes
        // were exchanged. Skip handshake dispatch.
        if ssl_gone(s)
            || (us_internal_poll_type(poll_of(s)) & POLL_TYPE_KIND_MASK) == POLL_TYPE_SEMI_SOCKET
        {
            return us_internal_socket_close_raw(s, code, reason);
        }
        ssl_set_loop_data(s);
        ssl_update_handshake(s);
        if ssl_gone(s) {
            return s;
        }
        if (*s).ssl_handshake_state() != HANDSHAKE_COMPLETED {
            ssl_trigger_handshake_econnreset(s);
            if ssl_gone(s) {
                return s;
            }
        }
        if ssl_handle_shutdown(s, code != 0) != 0 {
            return us_internal_socket_close_raw(s, code, reason);
        }
        s
    }
}

#[inline(always)]
unsafe fn ssl_close(s: *mut us_socket_t, code: c_int, reason: *mut c_void) -> *mut us_socket_t {
    // SAFETY: internal shorthand for `us_internal_ssl_close`.
    unsafe { us_internal_ssl_close(s, code, reason) }
}

unsafe fn ssl_update_handshake(s: *mut us_socket_t) {
    // SAFETY: `s` is live; `ssl_in_use` guards BoringSSL re-entrancy.
    unsafe {
        ERR_clear_error();
        if (*s).ssl.is_null() || (*s).ssl_handshake_state() != HANDSHAKE_PENDING {
            return;
        }
        // SSL_read may have finished the handshake (TLS 1.3 server).
        if SSL_is_init_finished(s_ssl(s)) != 0 {
            ssl_trigger_handshake(s, 1);
            return;
        }
        if us_socket_is_closed(s) != 0
            || us_internal_ssl_is_shut_down(s) != 0
            || (!s_ssl(s).is_null() && (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN) != 0)
        {
            ssl_trigger_handshake(s, 0);
            return;
        }

        let ssl_was_in_use = (*s).ssl_in_use();
        (*s).set_ssl_in_use(true);
        let result = SSL_do_handshake(s_ssl(s));
        (*s).set_ssl_in_use(ssl_was_in_use);
        if !ssl_was_in_use && (*s).ssl_pending_detach() {
            (*s).set_ssl_pending_detach(false);
            us_socket_close(s, (*s).ssl_pending_close_code as c_int, ptr::null_mut());
            return;
        }

        if (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN) != 0 {
            ssl_close(s, 0, ptr::null_mut());
            return;
        }

        if result <= 0 {
            let err = SSL_get_error(s_ssl(s), result);
            if err == SSL_ERROR_PENDING_CERTIFICATE {
                (*s).set_ssl_handshake_state(HANDSHAKE_PENDING);
                return;
            }
            if err != SSL_ERROR_WANT_READ && err != SSL_ERROR_WANT_WRITE {
                if err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL {
                    ssl_park_fatal_reason(s);
                }
                ssl_trigger_handshake(s, 0);
                return;
            }
            (*s).set_ssl_handshake_state(HANDSHAKE_PENDING);
            (*s).set_ssl_write_wants_read(true);
            (*s).flags.set_last_write_failed(true);
            return;
        }

        ssl_trigger_handshake(s, 1);
        if ssl_gone(s) {
            return;
        }
        (*s).set_ssl_write_wants_read(true);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event hooks (called from loop.c / socket.c when `s->ssl != NULL`)
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_on_open(
    s: *mut us_socket_t,
    is_client: c_int,
    ip: *mut c_char,
    ip_length: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is live; dispatch may replace/close it.
    unsafe {
        ssl_set_loop_data(s);
        let result = us_dispatch_open(s, is_client, ip, ip_length);
        if result.is_null() || ssl_gone(result) {
            return result;
        }
        // Kick the handshake immediately — some peers stall waiting for ClientHello.
        ssl_set_loop_data(result);
        ssl_update_handshake(result);
        result
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_on_close(
    s: *mut us_socket_t,
    code: c_int,
    reason: *mut c_void,
) -> *mut us_socket_t {
    // SAFETY: `s` is live; free SSL after on_close so JS can inspect ALPN/cert.
    unsafe {
        ssl_set_loop_data(s);
        let ret = us_dispatch_close(s, code, reason);
        us_internal_ssl_detach(s);
        ret
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_on_end(s: *mut us_socket_t) -> *mut us_socket_t {
    // SAFETY: `s` is live; TCP FIN under TLS → send close_notify and raw-close now.
    unsafe {
        ssl_set_loop_data(s);
        let mut s = ssl_close(s, 0, ptr::null_mut());
        if !s.is_null() && us_socket_is_closed(s) == 0 {
            s = us_internal_socket_close_raw(
                s,
                LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN,
                ptr::null_mut(),
            );
        }
        s
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_on_writable(s: *mut us_socket_t) -> *mut us_socket_t {
    // SAFETY: `s` is live; every dispatch may close it.
    unsafe {
        ssl_set_loop_data(s);
        let lsd = loop_lsd(group_loop(s));
        // Spilled ciphertext goes out before anything else.
        if !lsd.is_null() && ssl_drain_spill(lsd, s) == 0 {
            return s;
        }
        if (*s).ssl_shutdown_after_spill() {
            (*s).set_ssl_shutdown_after_spill(false);
            us_internal_ssl_shutdown(s);
            if ssl_gone(s) {
                return s;
            }
        }
        if (*s).ssl_close_after_spill() {
            (*s).set_ssl_close_after_spill(false);
            return us_internal_ssl_close(
                s,
                LIBUS_SOCKET_CLOSE_CODE_FAST_SHUTDOWN,
                ptr::null_mut(),
            );
        }

        ssl_update_handshake(s);
        if ssl_gone(s) {
            return s;
        }

        let mut s = s;
        if (*s).ssl_read_wants_write() {
            (*s).set_ssl_read_wants_write(false);
            s = us_internal_ssl_on_data(s, c"".as_ptr() as *mut c_char, 0);
            if s.is_null() || ssl_gone(s) {
                return s;
            }
        }
        if us_internal_ssl_is_shut_down(s) != 0 {
            return s;
        }
        if (*s).ssl_handshake_state() == HANDSHAKE_COMPLETED {
            s = us_dispatch_writable(s);
        }
        s
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_on_data(
    s: *mut us_socket_t,
    data: *mut c_char,
    length: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is live; the shared read buffers are per-loop scratch.
    unsafe {
        ERR_clear_error();
        // Set the is-a-bun-socket marker lazily before the SSL_read that will
        // fire the session/keylog callbacks.
        if !(*s).ssl.is_null()
            && us_socket_kind(s) == BUN_SOCKET_KIND_BUN_SOCKET_TLS
            && SSL_get_ex_data((*s).ssl, us_ssl_is_socket_ex_idx).is_null()
        {
            us_ex_idx_ensure();
            SSL_set_ex_data((*s).ssl, us_ssl_is_socket_ex_idx, 1 as *mut c_void);
        }
        let mut s = s;
        // upgradeTLS raw half observes ciphertext before SSL_read consumes it.
        if (*s).ssl_raw_tap() && length > 0 {
            s = us_dispatch_ssl_raw_tap(s, data, length);
            if s.is_null() || us_socket_is_closed(s) != 0 || (*s).ssl.is_null() {
                return s;
            }
        }

        let lsd = ssl_set_loop_data(s);
        (*lsd).ssl_read_input = data;
        (*lsd).ssl_read_input_length = length as c_uint;

        if us_socket_is_closed(s) != 0 {
            return ptr::null_mut();
        }
        if (*s).ssl.is_null() || s_ssl(s).is_null() || (*s).ssl_fatal_error() {
            ssl_close(s, 0, ptr::null_mut());
            return ptr::null_mut();
        }

        let mut read: c_int = 0;
        'restart: loop {
            loop {
                let ssl_was_in_use = (*s).ssl_in_use();
                (*s).set_ssl_in_use(true);
                let just_read = SSL_read(
                    s_ssl(s),
                    (*lsd)
                        .ssl_read_output
                        .add(LIBUS_RECV_BUFFER_PADDING + read as usize)
                        .cast(),
                    LIBUS_RECV_BUFFER_LENGTH as c_int - read,
                );
                (*s).set_ssl_in_use(ssl_was_in_use);
                if !ssl_was_in_use && (*s).ssl_pending_detach() {
                    (*s).set_ssl_pending_detach(false);
                    return us_socket_close(
                        s,
                        (*s).ssl_pending_close_code as c_int,
                        ptr::null_mut(),
                    );
                }

                if just_read <= 0 {
                    let mut err = SSL_get_error(s_ssl(s), just_read);
                    if err != SSL_ERROR_WANT_READ
                        && err != SSL_ERROR_WANT_WRITE
                        && err != SSL_ERROR_PENDING_CERTIFICATE
                    {
                        if err == SSL_ERROR_WANT_RENEGOTIATE {
                            if ssl_renegotiate(s) != 0 {
                                continue;
                            }
                            if ssl_gone(s) {
                                return ptr::null_mut();
                            }
                            err = SSL_ERROR_SSL;
                        } else if err == SSL_ERROR_ZERO_RETURN {
                            // Remote close_notify: deliver parked session /
                            // keylog first, then data, then close.
                            ssl_flush_pending_session(s);
                            ssl_flush_pending_keylog(s);
                            if ssl_gone(s) {
                                return ptr::null_mut();
                            }
                            if read != 0 {
                                s = us_dispatch_data(
                                    s,
                                    (*lsd).ssl_read_output.add(LIBUS_RECV_BUFFER_PADDING),
                                    read,
                                );
                                if s.is_null() || ssl_gone(s) {
                                    return ptr::null_mut();
                                }
                            }
                            ssl_close(s, 0, ptr::null_mut());
                            return ptr::null_mut();
                        }

                        if err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL {
                            ssl_park_fatal_reason(s);
                        }
                        ssl_close(s, 0, ptr::null_mut());
                        (*lsd).ssl_last_fatal_error[0] = 0;
                        return ptr::null_mut();
                    } else {
                        if err == SSL_ERROR_WANT_WRITE {
                            (*s).set_ssl_read_wants_write(true);
                        }
                        // Unread ciphertext still in the BIO → broken framing.
                        if (*lsd).ssl_read_input_length != 0 {
                            return ssl_close(s, 0, ptr::null_mut());
                        }
                        if (*s).ssl_handshake_state() == HANDSHAKE_PENDING
                            && SSL_is_init_finished(s_ssl(s)) != 0
                        {
                            ssl_trigger_handshake(s, 1);
                            if ssl_gone(s) {
                                return ptr::null_mut();
                            }
                            (*lsd).ssl_socket = s;
                        }
                        if read == 0 {
                            break;
                        }
                        ssl_flush_pending_session(s);
                        ssl_flush_pending_keylog(s);
                        if ssl_gone(s) {
                            return ptr::null_mut();
                        }
                        s = us_dispatch_data(
                            s,
                            (*lsd).ssl_read_output.add(LIBUS_RECV_BUFFER_PADDING),
                            read,
                        );
                        if s.is_null() || ssl_gone(s) {
                            return ptr::null_mut();
                        }
                        break;
                    }
                } else if (*s).ssl_handshake_state() != HANDSHAKE_COMPLETED {
                    // SSL_read returned app data with the handshake done
                    // inside it. Fire on_handshake before delivering data.
                    let saved_input = (*lsd).ssl_read_input;
                    let saved_length = (*lsd).ssl_read_input_length;
                    let saved_offset = (*lsd).ssl_read_input_offset;
                    ssl_trigger_handshake(s, 1);
                    if ssl_gone(s) {
                        return ptr::null_mut();
                    }
                    (*lsd).ssl_read_input = saved_input;
                    (*lsd).ssl_read_input_length = saved_length;
                    (*lsd).ssl_read_input_offset = saved_offset;
                    (*lsd).ssl_socket = s;
                }

                read += just_read;

                if read == LIBUS_RECV_BUFFER_LENGTH as c_int {
                    let saved_input = (*lsd).ssl_read_input;
                    let saved_length = (*lsd).ssl_read_input_length;
                    let saved_offset = (*lsd).ssl_read_input_offset;
                    ssl_flush_pending_session(s);
                    ssl_flush_pending_keylog(s);
                    if ssl_gone(s) {
                        return ptr::null_mut();
                    }
                    s = us_dispatch_data(
                        s,
                        (*lsd).ssl_read_output.add(LIBUS_RECV_BUFFER_PADDING),
                        read,
                    );
                    if s.is_null() || ssl_gone(s) {
                        return ptr::null_mut();
                    }
                    (*lsd).ssl_read_input = saved_input;
                    (*lsd).ssl_read_input_length = saved_length;
                    (*lsd).ssl_read_input_offset = saved_offset;
                    (*lsd).ssl_socket = s;
                    read = 0;
                    continue 'restart;
                }
            }
            break;
        }

        if ssl_gone(s) {
            return ptr::null_mut();
        }
        if (*s).ssl_write_wants_read() && !(*s).ssl_read_wants_write() {
            (*s).set_ssl_write_wants_read(false);
            s = us_internal_ssl_on_writable(s);
            if s.is_null() || ssl_gone(s) {
                return ptr::null_mut();
            }
        }

        ssl_flush_pending_session(s);
        ssl_flush_pending_keylog(s);
        if ssl_gone(s) {
            return ptr::null_mut();
        }
        s
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_is_low_prio(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is live with an SSL.
    unsafe { SSL_in_init(s_ssl(s)) }
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket-level accessors / write / shutdown
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_is_shut_down(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is live; reads poll-type directly.
    unsafe {
        if us_internal_poll_type(poll_of(s)) == POLL_TYPE_SOCKET_SHUT_DOWN {
            return 1;
        }
        ((*s).ssl.is_null()
            || s_ssl(s).is_null()
            || (SSL_get_shutdown(s_ssl(s)) & SSL_SENT_SHUTDOWN) != 0
            || (*s).ssl_fatal_error()) as c_int
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_is_handshake_finished(s: *mut us_socket_t) -> c_int {
    // SAFETY: `s` is live.
    unsafe {
        if (*s).ssl.is_null() || s_ssl(s).is_null() {
            return 0;
        }
        SSL_is_init_finished(s_ssl(s))
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_handshake_callback_has_fired(
    s: *mut us_socket_t,
) -> c_int {
    // SAFETY: `s` is live.
    unsafe { (!(*s).ssl.is_null() && (*s).ssl_handshake_state() == HANDSHAKE_COMPLETED) as c_int }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_get_native_handle(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: `s` is live.
    unsafe {
        if (*s).ssl.is_null() {
            ptr::null_mut()
        } else {
            s_ssl(s).cast()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_write(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
) -> c_int {
    // SAFETY: `s` is live; `data` is valid for `length` bytes.
    unsafe {
        if us_socket_is_closed(s) != 0 || us_internal_ssl_is_shut_down(s) != 0 || length == 0 {
            return 0;
        }
        // SEMI_SOCKET: SSL_write would serialize ClientHello without SNI/ALPN.
        if (us_internal_poll_type(poll_of(s)) & POLL_TYPE_KIND_MASK) == POLL_TYPE_SEMI_SOCKET {
            return 0;
        }

        let lsd = loop_lsd(group_loop(s));
        if ssl_drain_spill(lsd, s) == 0 {
            return 0;
        }
        (*lsd).ssl_read_input_length = 0;
        (*lsd).ssl_socket = s;

        // Batch unless another socket's spill occupies the slot.
        let batching = (*lsd).ssl_spill_owner.is_null();
        (*lsd).ssl_write_batching = batching as c_int;

        let mut total: c_int = 0;
        let mut last_ssl_written: c_int = 1;
        while total < length {
            let mut chunk = length - total;
            if chunk > 16384 {
                chunk = 16384;
            }
            last_ssl_written = SSL_write(s_ssl(s), data.add(total as usize).cast(), chunk);
            if last_ssl_written <= 0 {
                break;
            }
            total += last_ssl_written;
            if (*s).ssl_fatal_error() {
                break;
            }
            if batching && (*lsd).ssl_write_batch_len >= 131072 {
                if ssl_flush_write_batch(lsd, s) == 0 {
                    break;
                }
                if (*s).ssl_fatal_error() {
                    break;
                }
            }
        }
        (*lsd).ssl_write_batching = 0;
        if batching {
            ssl_flush_write_batch(lsd, s);
        }
        if (*s).ssl_fatal_error() {
            return 0;
        }
        if total > 0 {
            return total;
        }
        if last_ssl_written <= 0 {
            let err = SSL_get_error(s_ssl(s), last_ssl_written);
            if err == SSL_ERROR_WANT_READ {
                (*s).set_ssl_write_wants_read(true);
            } else if err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL {
                ssl_park_fatal_reason(s);
            }
        }
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_shutdown(s: *mut us_socket_t) {
    // SAFETY: `s` is live.
    unsafe {
        if us_socket_is_closed(s) != 0 || us_internal_ssl_is_shut_down(s) != 0 {
            return;
        }
        // Spilled ciphertext was already reported as written; finish after drain.
        let lsd0 = loop_lsd(group_loop(s));
        if !lsd0.is_null() && (*lsd0).ssl_spill_owner == s {
            if ssl_drain_spill(lsd0, s) == 0 {
                (*s).set_ssl_shutdown_after_spill(true);
                return;
            }
        }

        // BoringSSL has no TLS half-close: once close_notify is sent, SSL_read
        // refuses further app data. Only send it when the peer's close_notify
        // already arrived; otherwise TCP half-close (FIN, keep reading).
        if SSL_in_init(s_ssl(s)) == 0 && (SSL_get_shutdown(s_ssl(s)) & SSL_RECEIVED_SHUTDOWN) == 0 {
            let fl = loop_lsd(group_loop(s));
            (*fl).ssl_read_input_length = 0;
            (*fl).ssl_socket = s;
            // Zero-length write flushes deferred TLS 1.3 NewSessionTickets.
            let zero_buf: c_char = 0;
            SSL_write(s_ssl(s), (&zero_buf as *const c_char).cast(), 0);
            us_internal_socket_raw_shutdown(s);
            return;
        }

        let lsd = loop_lsd(group_loop(s));
        (*lsd).ssl_read_input_length = 0;
        (*lsd).ssl_socket = s;
        let ret = SSL_shutdown(s_ssl(s));

        if SSL_in_init(s_ssl(s)) != 0 || SSL_get_quiet_shutdown(s_ssl(s)) != 0 {
            us_internal_socket_raw_shutdown(s);
            return;
        }
        if ret < 0 {
            let err = SSL_get_error(s_ssl(s), ret);
            if err == SSL_ERROR_SSL || err == SSL_ERROR_SYSCALL {
                ERR_clear_error();
                (*s).set_ssl_fatal_error(true);
            }
            us_internal_socket_raw_shutdown(s);
        }
    }
}

/// Resume a handshake suspended by an async SNICallback. Consumes `ctx`'s ref.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_sni_resolve(
    s: *mut us_socket_t,
    ctx: *mut SSL_CTX,
    error: c_int,
) {
    // SAFETY: `s` may be null/closed (late resolution). `ctx` ref is consumed.
    unsafe {
        if s.is_null() || us_socket_is_closed(s) != 0 || (*s).ssl.is_null() || s_ssl(s).is_null() {
            if !ctx.is_null() {
                SSL_CTX_free(ctx);
            }
            return;
        }
        if us_ssl_sni_pending_idx < 0 {
            if !ctx.is_null() {
                SSL_CTX_free(ctx);
            }
            return;
        }
        let pending =
            SSL_get_ex_data(s_ssl(s), us_ssl_sni_pending_idx).cast::<us_ssl_sni_pending_t>();
        if pending.is_null() || (*pending).state != 1 {
            if !ctx.is_null() {
                SSL_CTX_free(ctx);
            }
            return;
        }
        if error != 0 {
            (*pending).state = 3;
            if !ctx.is_null() {
                SSL_CTX_free(ctx);
            }
            // Drop without a TLS alert (Node's SNICallback-error behavior).
            (*s).set_ssl_pending_detach(true);
            (*s).ssl_pending_close_code = 0;
        } else {
            (*pending).state = 2;
            (*pending).resolved_ctx = ctx;
        }
        ssl_set_loop_data(s);
        ssl_update_handshake(s);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_handshake_abort(s: *mut us_socket_t) {
    // SAFETY: `s` is live.
    unsafe {
        (*s).set_ssl_fatal_error(true);
        ssl_close(s, 0, ptr::null_mut());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Adopt-TLS (STARTTLS / Bun.connect upgrade)
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_tls_feed(
    s: *mut us_socket_t,
    data: *const c_char,
    length: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is live; `data` is fed through the normal decrypt path.
    unsafe {
        if us_socket_is_closed(s) != 0 || (*s).ssl.is_null() || length <= 0 {
            return s;
        }
        us_internal_ssl_on_data(s, data as *mut c_char, length)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_adopt_tls(
    s: *mut us_socket_t,
    group: *mut us_socket_group_t,
    kind: c_uchar,
    ssl_ctx: *mut SSL_CTX,
    sni: *const c_char,
    is_client: c_int,
    old_ext_size: c_int,
    ext_size: c_int,
) -> *mut us_socket_t {
    // SAFETY: `s` is live; adoption reallocates the socket for the new ext.
    unsafe {
        if us_socket_is_closed(s) != 0 {
            return ptr::null_mut();
        }
        let new_s = us_socket_adopt(s, group, kind, old_ext_size, ext_size);
        if new_s.is_null() {
            return ptr::null_mut();
        }
        us_internal_ssl_attach(new_s, ssl_ctx, is_client, sni, ptr::null_mut());
        us_socket_resume(new_s);
        new_s
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_start_tls_handshake(s: *mut us_socket_t) {
    // SAFETY: `s` is live.
    unsafe {
        if (*s).ssl.is_null() || us_socket_is_closed(s) != 0 {
            return;
        }
        ssl_set_loop_data(s);
        ssl_update_handshake(s);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SNI on listen sockets
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" fn sni_node_destructor(user: *mut c_void) {
    let node = user.cast::<sni_node_t>();
    if node.is_null() {
        return;
    }
    // SAFETY: `node` was `us_malloc`'d and owns one SSL_CTX ref.
    unsafe {
        SSL_CTX_free((*node).ctx);
        us_free(node.cast());
    }
}

unsafe fn resolve_listener_ctx(
    ls: *mut us_listen_socket_t,
    hostname: *const c_char,
) -> *mut sni_node_t {
    // SAFETY: `ls` is live; `sni` is the opaque tree root.
    unsafe {
        if (*ls).sni.is_null() {
            return ptr::null_mut();
        }
        sni_find((*ls).sni, hostname).cast()
    }
}

/// Extract `host_name` from the ClientHello's server_name extension into `out`
/// (NUL-terminated). Returns bytes written, or 0 if absent/malformed.
unsafe fn us_client_hello_servername(
    hello: *const SSL_CLIENT_HELLO,
    out: *mut c_char,
    out_len: usize,
) -> usize {
    // SAFETY: `hello` is the early-callback payload; `out` has `out_len` bytes.
    unsafe {
        let mut ext: *const u8 = ptr::null();
        let mut ext_len: usize = 0;
        if SSL_early_callback_ctx_extension_get(
            hello,
            TLSEXT_TYPE_server_name,
            &mut ext,
            &mut ext_len,
        ) == 0
        {
            return 0;
        }
        // server_name extension: u16 list_len, then entries of (u8 type, u16 len, bytes).
        if ext_len < 5 {
            return 0;
        }
        let list_len = ((*ext.add(0) as usize) << 8) | *ext.add(1) as usize;
        if list_len + 2 != ext_len {
            return 0;
        }
        let mut p = ext.add(2);
        let mut remaining = list_len;
        while remaining >= 3 {
            let ty = *p;
            let name_len = ((*p.add(1) as usize) << 8) | *p.add(2) as usize;
            if name_len + 3 > remaining {
                return 0;
            }
            if ty as c_int == TLSEXT_NAMETYPE_host_name {
                if name_len == 0 || name_len >= out_len {
                    return 0;
                }
                ptr::copy_nonoverlapping(p.add(3), out.cast::<u8>(), name_len);
                *out.add(name_len) = 0;
                return name_len;
            }
            p = p.add(3 + name_len);
            remaining -= 3 + name_len;
        }
        0
    }
}

/// The async-capable certificate selector (`select_certificate_cb`). Suspends
/// the handshake when an SNICallback answers "pending".
unsafe extern "C" fn us_select_cert_cb(hello: *const SSL_CLIENT_HELLO) -> ssl_select_cert_result_t {
    // SAFETY: `hello` is live for the duration of this callback.
    unsafe {
        let ssl = (*hello).ssl;
        if ssl.is_null() || us_ssl_listener_ex_idx < 0 {
            return ssl_select_cert_success;
        }

        let mut pending: *mut us_ssl_sni_pending_t = if us_ssl_sni_pending_idx >= 0 {
            SSL_get_ex_data(ssl, us_ssl_sni_pending_idx).cast()
        } else {
            ptr::null_mut()
        };

        if !pending.is_null() && (*pending).state == 2 {
            (*pending).state = 0;
            if !(*pending).resolved_ctx.is_null() {
                SSL_set_SSL_CTX(ssl, (*pending).resolved_ctx);
                SSL_CTX_free((*pending).resolved_ctx);
                (*pending).resolved_ctx = ptr::null_mut();
                return ssl_select_cert_success;
            }
            // Async resolution selected nothing: fall through to the static tree.
            let resumed_ls =
                SSL_get_ex_data(ssl, us_ssl_listener_ex_idx).cast::<us_listen_socket_t>();
            if !resumed_ls.is_null() {
                let mut host = [0 as c_char; 256];
                if us_client_hello_servername(hello, host.as_mut_ptr(), host.len()) != 0 {
                    let node = resolve_listener_ctx(resumed_ls, host.as_ptr());
                    if !node.is_null() {
                        SSL_set_SSL_CTX(ssl, (*node).ctx);
                    }
                }
            }
            return ssl_select_cert_success;
        }
        if !pending.is_null() && (*pending).state == 3 {
            (*pending).state = 0;
            return ssl_select_cert_error;
        }
        if !pending.is_null() && (*pending).state == 1 {
            return ssl_select_cert_retry;
        }

        let ls = SSL_get_ex_data(ssl, us_ssl_listener_ex_idx).cast::<us_listen_socket_t>();
        if ls.is_null() || (*ls).on_server_name.is_none() {
            return ssl_select_cert_success;
        }

        let mut hostname = [0 as c_char; 256];
        if us_client_hello_servername(hello, hostname.as_mut_ptr(), hostname.len()) == 0 {
            return ssl_select_cert_success;
        }

        let cb_lsd = BIO_get_data(SSL_get_wbio(ssl)).cast::<loop_ssl_data>();
        let cb_socket = if cb_lsd.is_null() {
            ptr::null_mut()
        } else {
            (*cb_lsd).ssl_socket
        };

        let mut saved: [*mut c_void; 5] = [ptr::null_mut(); 5];
        us_internal_ssl_loop_state_save(ssl.cast(), saved.as_mut_ptr());
        let mut abort_handshake: c_int = 0;
        let dyn_ctx =
            ((*ls).on_server_name.unwrap())(ls, hostname.as_ptr(), &mut abort_handshake, cb_socket);
        us_internal_ssl_loop_state_restore(saved.as_mut_ptr());

        if abort_handshake == 1 {
            let lsd = BIO_get_data(SSL_get_wbio(ssl)).cast::<loop_ssl_data>();
            if !lsd.is_null() && !(*lsd).ssl_socket.is_null() {
                (*(*lsd).ssl_socket).set_ssl_pending_detach(true);
                (*(*lsd).ssl_socket).ssl_pending_close_code = 0;
            }
            return ssl_select_cert_error;
        }
        if abort_handshake == 2 {
            if us_ssl_sni_pending_idx >= 0 {
                if pending.is_null() {
                    pending = us_calloc(1, size_of::<us_ssl_sni_pending_t>()).cast();
                    SSL_set_ex_data(ssl, us_ssl_sni_pending_idx, pending.cast());
                }
                (*pending).state = 1;
            }
            return ssl_select_cert_retry;
        }
        if !dyn_ctx.is_null() {
            SSL_set_SSL_CTX(ssl, dyn_ctx);
            SSL_CTX_free(dyn_ctx);
            return ssl_select_cert_success;
        }

        let node = resolve_listener_ctx(ls, hostname.as_ptr());
        if !node.is_null() {
            SSL_set_SSL_CTX(ssl, (*node).ctx);
        }
        ssl_select_cert_success
    }
}

unsafe extern "C" fn sni_cb(ssl: *mut SSL, _al: *mut c_int, _arg: *mut c_void) -> c_int {
    // SAFETY: `ssl` is live; listener is read per-SSL (the CTX is shared).
    unsafe {
        if ssl.is_null() || us_ssl_listener_ex_idx < 0 {
            return SSL_TLSEXT_ERR_NOACK;
        }
        let ls = SSL_get_ex_data(ssl, us_ssl_listener_ex_idx).cast::<us_listen_socket_t>();
        if ls.is_null() {
            return SSL_TLSEXT_ERR_OK;
        }
        if (*ls).on_server_name.is_some() {
            // The early select-cert cb already handled dynamic + tree fallback.
            return SSL_TLSEXT_ERR_OK;
        }
        let hostname = SSL_get_servername(ssl, TLSEXT_NAMETYPE_host_name);
        if !hostname.is_null() && *hostname != 0 {
            let node = resolve_listener_ctx(ls, hostname);
            if !node.is_null() {
                SSL_set_SSL_CTX(ssl, (*node).ctx);
            }
        }
        SSL_TLSEXT_ERR_OK
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_add_server_name(
    ls: *mut us_listen_socket_t,
    hostname_pattern: *const c_char,
    ctx: *mut SSL_CTX,
    user: *mut c_void,
) -> c_int {
    // SAFETY: `ls` is live; tree leaf owns a +1 SSL_CTX ref.
    unsafe {
        let default_ctx = (*ls).ssl_ctx;
        if default_ctx.is_null() {
            return -1;
        }
        if (*ls).sni.is_null() {
            (*ls).sni = sni_new();
            SSL_CTX_set_tlsext_servername_callback(default_ctx, Some(sni_cb));
        }
        let node = us_malloc(size_of::<sni_node_t>()).cast::<sni_node_t>();
        (*node).ctx = ctx;
        (*node).user = user;
        SSL_CTX_up_ref(ctx);
        // Stash on the SSL_CTX too so per-socket lookup works regardless of
        // which ctx the SNI cb selected.
        us_ex_idx_ensure();
        SSL_CTX_set_ex_data(ctx, us_sni_ex_idx, user);

        if sni_add((*ls).sni, hostname_pattern, node.cast()) != 0 {
            sni_node_destructor(node.cast());
            return 1;
        }
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_remove_server_name(
    ls: *mut us_listen_socket_t,
    hostname_pattern: *const c_char,
) {
    // SAFETY: `ls` is live.
    unsafe {
        if (*ls).sni.is_null() {
            return;
        }
        let node = sni_remove((*ls).sni, hostname_pattern);
        sni_node_destructor(node);
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_find_server_name_userdata(
    ls: *mut us_listen_socket_t,
    hostname_pattern: *const c_char,
) -> *mut c_void {
    // SAFETY: `ls` is live.
    unsafe {
        if (*ls).sni.is_null() {
            return ptr::null_mut();
        }
        let node = sni_find((*ls).sni, hostname_pattern).cast::<sni_node_t>();
        if node.is_null() {
            ptr::null_mut()
        } else {
            (*node).user
        }
    }
}

/// Returns the `SSL_CTX` registered for `hostname_pattern`, or null. Owned —
/// the caller must release the reference.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_find_server_name_ctx(
    ls: *mut us_listen_socket_t,
    hostname_pattern: *const c_char,
) -> *mut SSL_CTX {
    // SAFETY: `ls` is live; an up-ref'd ctx is returned.
    unsafe {
        if (*ls).sni.is_null() {
            return ptr::null_mut();
        }
        let node = sni_find((*ls).sni, hostname_pattern).cast::<sni_node_t>();
        if node.is_null() || (*node).ctx.is_null() {
            return ptr::null_mut();
        }
        SSL_CTX_up_ref((*node).ctx);
        (*node).ctx
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_listen_socket_on_server_name(
    ls: *mut us_listen_socket_t,
    cb: us_on_server_name_cb,
) {
    // SAFETY: `ls` is live; the select-certificate cb supports async retry.
    unsafe {
        (*ls).on_server_name = cb;
        if !(*ls).ssl_ctx.is_null() {
            SSL_CTX_set_select_certificate_cb((*ls).ssl_ctx, Some(us_select_cert_cb));
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_socket_server_name_userdata(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: `s` is live.
    unsafe {
        if (*s).ssl.is_null() || s_ssl(s).is_null() || us_sni_ex_idx < 0 {
            return ptr::null_mut();
        }
        SSL_CTX_get_ex_data(SSL_get_SSL_CTX(s_ssl(s)), us_sni_ex_idx)
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_ssl_sni_userdata(s: *mut us_socket_t) -> *mut c_void {
    // SAFETY: delegated.
    unsafe { us_socket_server_name_userdata(s) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn us_internal_listen_socket_ssl_free(ls: *mut us_listen_socket_t) {
    // SAFETY: `ls` is live; wipe per-SSL back-refs so `sni_cb` sees null.
    unsafe {
        if us_ssl_listener_ex_idx >= 0 && !(*ls).accept_group.is_null() {
            let mut s = (*(*ls).accept_group).head_sockets;
            while !s.is_null() {
                if !(*s).ssl.is_null()
                    && SSL_get_ex_data((*s).ssl, us_ssl_listener_ex_idx) == ls.cast()
                {
                    SSL_set_ex_data((*s).ssl, us_ssl_listener_ex_idx, ptr::null_mut());
                }
                s = (*s).next;
            }
            // Mid-handshake sockets are parked in `loop->data.low_prio_head`
            // and unlinked from `head_sockets` — they run sni_cb next tick.
            let mut s = (*(*(*ls).accept_group).loop_).data.low_prio_head;
            while !s.is_null() {
                if (*s).group == (*ls).accept_group
                    && !(*s).ssl.is_null()
                    && SSL_get_ex_data((*s).ssl, us_ssl_listener_ex_idx) == ls.cast()
                {
                    SSL_set_ex_data((*s).ssl, us_ssl_listener_ex_idx, ptr::null_mut());
                }
                s = (*s).next;
            }
        }
        if !(*ls).ssl_ctx.is_null() {
            us_internal_ssl_ctx_unref((*ls).ssl_ctx);
            (*ls).ssl_ctx = ptr::null_mut();
        }
        if !(*ls).sni.is_null() {
            sni_free((*ls).sni, Some(sni_node_destructor));
            (*ls).sni = ptr::null_mut();
        }
    }
}
