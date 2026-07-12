//! BoringSSL FFI edge for `tls/{context,state,sni}.rs`. Hand-declared externs
//! (same linkage model as `bun_boringssl_sys`: no build.rs, symbols resolve
//! against Bun's linked BoringSSL objects + root_certs.cpp). W17 may swap the
//! extern block for pre-generated bssl-sys bindings behind these helpers.

use core::ffi::{CStr, c_char, c_int, c_long, c_uint, c_void};
use core::ptr;
use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicI64, Ordering};
use std::sync::Once;

use crate::tls::SSL;
use crate::tls::context::SslCtx;

// ── Opaque foreign types ─────────────────────────────────────────────────────

macro_rules! opaque {
    ($($name:ident),+ $(,)?) => {
        $(#[repr(C)] pub struct $name { _opaque: [u8; 0] })+
    };
}
opaque!(
    BIO,
    X509,
    X509_STORE,
    X509_STORE_CTX,
    EVP_PKEY,
    DH,
    SSL_SESSION,
    SSL_CIPHER,
    PKCS12,
    CRYPTO_EX_DATA,
    OPENSSL_STACK,
    SSL_METHOD,
    BIO_METHOD,
);

/// `struct sha256_state_st` — public stable layout (vendor sha2.h:95-100).
#[repr(C)]
pub struct SHA256_CTX {
    h: [u32; 8],
    nl: u32,
    nh: u32,
    data: [u8; 64],
    num: c_uint,
    md_len: c_uint,
}

pub type PemPasswordCb =
    unsafe extern "C" fn(*mut c_char, c_int, c_int, *mut c_void) -> c_int;
pub type CryptoExFree = unsafe extern "C" fn(
    *mut c_void,
    *mut c_void,
    *mut CRYPTO_EX_DATA,
    c_int,
    c_long,
    *mut c_void,
);
type VerifyCb = unsafe extern "C" fn(c_int, *mut X509_STORE_CTX) -> c_int;
type NewSessionCb = unsafe extern "C" fn(*mut SSL, *mut SSL_SESSION) -> c_int;
type KeylogCb = unsafe extern "C" fn(*const SSL, *const c_char);

// ── Constants (values verified against vendor/boringssl/include) ─────────────

pub const SSL_VERIFY_NONE: c_int = 0;
pub const SSL_VERIFY_PEER: c_int = 1;
pub const SSL_VERIFY_FAIL_IF_NO_PEER_CERT: c_int = 2;
pub const SSL_FILETYPE_PEM: c_int = 1;
pub const SSL_FILETYPE_ASN1: c_int = 2;
pub const TLS1_2_VERSION: u16 = 0x0303;
pub const TLS1_3_VERSION: u16 = 0x0304;
const SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER: u32 = 0x2;
/// 0 in BoringSSL (release-buffers is always-on); kept for verbatim porting.
const SSL_MODE_RELEASE_BUFFERS: u32 = 0;
/// CLIENT | SERVER | NO_INTERNAL(0x300) | NO_AUTO_CLEAR(0x80).
const SSL_SESS_CACHE_MODE: c_int = 0x1 | 0x2 | 0x300 | 0x80;
const ERR_LIB_PEM: c_int = 9;
const PEM_R_NO_START_LINE: c_int = 110;
const SSL_R_NO_CIPHER_MATCH: c_int = 177;
const NID_AUTH_PSK: c_int = 956;
pub const X509_V_OK: c_long = 0;
pub const X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT: c_long = 2;

// ── Extern surface ───────────────────────────────────────────────────────────

unsafe extern "C" {
    fn TLS_method() -> *const SSL_METHOD;
    fn SSL_CTX_new(method: *const SSL_METHOD) -> *mut SslCtx;
    fn SSL_CTX_free(ctx: *mut SslCtx);
    fn SSL_CTX_up_ref(ctx: *mut SslCtx) -> c_int;
    fn SSL_CTX_set_read_ahead(ctx: *mut SslCtx, yes: c_int) -> c_int;
    fn SSL_CTX_set_mode(ctx: *mut SslCtx, mode: u32) -> u32;
    fn SSL_CTX_set_min_proto_version(ctx: *mut SslCtx, version: u16) -> c_int;
    fn SSL_CTX_set_max_proto_version(ctx: *mut SslCtx, version: u16) -> c_int;
    fn SSL_CTX_set_options(ctx: *mut SslCtx, options: u32) -> u32;
    fn SSL_CTX_set_default_passwd_cb(ctx: *mut SslCtx, cb: Option<PemPasswordCb>);
    fn SSL_CTX_set_default_passwd_cb_userdata(ctx: *mut SslCtx, data: *mut c_void);
    fn SSL_CTX_get_default_passwd_cb(ctx: *const SslCtx) -> Option<PemPasswordCb>;
    fn SSL_CTX_get_default_passwd_cb_userdata(ctx: *const SslCtx) -> *mut c_void;
    fn SSL_CTX_use_certificate_chain_file(ctx: *mut SslCtx, file: *const c_char) -> c_int;
    fn SSL_CTX_use_PrivateKey_file(ctx: *mut SslCtx, file: *const c_char, ty: c_int) -> c_int;
    fn SSL_CTX_use_certificate(ctx: *mut SslCtx, x: *mut X509) -> c_int;
    fn SSL_CTX_use_PrivateKey(ctx: *mut SslCtx, pkey: *mut EVP_PKEY) -> c_int;
    fn SSL_CTX_clear_chain_certs(ctx: *mut SslCtx) -> c_int;
    fn SSL_CTX_add0_chain_cert(ctx: *mut SslCtx, x: *mut X509) -> c_int;
    fn SSL_CTX_add_client_CA(ctx: *mut SslCtx, x: *mut X509) -> c_int;
    fn SSL_CTX_set_client_CA_list(ctx: *mut SslCtx, list: *mut OPENSSL_STACK);
    fn SSL_load_client_CA_file(file: *const c_char) -> *mut OPENSSL_STACK;
    fn SSL_CTX_load_verify_locations(
        ctx: *mut SslCtx,
        ca_file: *const c_char,
        ca_dir: *const c_char,
    ) -> c_int;
    fn SSL_CTX_set_verify(ctx: *mut SslCtx, mode: c_int, cb: Option<VerifyCb>);
    fn SSL_CTX_get_verify_mode(ctx: *const SslCtx) -> c_int;
    fn SSL_CTX_get_cert_store(ctx: *const SslCtx) -> *mut X509_STORE;
    fn SSL_CTX_set_cert_store(ctx: *mut SslCtx, store: *mut X509_STORE);
    fn SSL_CTX_set_cipher_list(ctx: *mut SslCtx, s: *const c_char) -> c_int;
    fn SSL_CTX_set_tmp_dh(ctx: *mut SslCtx, dh: *const DH) -> c_int;
    fn SSL_CTX_set_session_cache_mode(ctx: *mut SslCtx, mode: c_int) -> c_int;
    fn SSL_CTX_sess_set_new_cb(ctx: *mut SslCtx, cb: Option<NewSessionCb>);
    fn SSL_CTX_set_keylog_callback(ctx: *mut SslCtx, cb: Option<KeylogCb>);
    fn SSL_CTX_get_ex_new_index(
        argl: c_long,
        argp: *mut c_void,
        unused: *mut c_void,
        dup_unused: *mut c_void,
        free_func: Option<CryptoExFree>,
    ) -> c_int;
    fn SSL_CTX_set_ex_data(ctx: *mut SslCtx, idx: c_int, data: *mut c_void) -> c_int;
    fn SSL_CTX_get_ex_data(ctx: *const SslCtx, idx: c_int) -> *mut c_void;
    fn SSL_get_ex_new_index(
        argl: c_long,
        argp: *mut c_void,
        unused: *mut c_void,
        dup_unused: *mut c_void,
        free_func: Option<CryptoExFree>,
    ) -> c_int;
    fn SSL_set_ex_data(ssl: *mut SSL, idx: c_int, data: *mut c_void) -> c_int;
    fn SSL_get_ex_data(ssl: *const SSL, idx: c_int) -> *mut c_void;
    fn SSL_get_SSL_CTX(ssl: *const SSL) -> *mut SslCtx;
    fn SSL_get_peer_certificate(ssl: *const SSL) -> *mut X509;
    fn SSL_get_verify_result(ssl: *const SSL) -> c_long;
    fn SSL_get_current_cipher(ssl: *const SSL) -> *const SSL_CIPHER;
    fn SSL_CIPHER_get_auth_nid(cipher: *const SSL_CIPHER) -> c_int;
    fn SSL_get_session(ssl: *const SSL) -> *mut SSL_SESSION;
    fn SSL_SESSION_get_protocol_version(session: *const SSL_SESSION) -> u16;
    fn SSL_session_reused(ssl: *const SSL) -> c_int;
    fn i2d_SSL_SESSION(session: *const SSL_SESSION, pp: *mut *mut u8) -> c_int;
    fn X509_verify_cert_error_string(err: c_long) -> *const c_char;
    fn X509_free(x: *mut X509);
    fn X509_STORE_add_cert(store: *mut X509_STORE, x: *mut X509) -> c_int;
    fn X509_STORE_free(store: *mut X509_STORE);
    fn X509_STORE_get0_objects(store: *mut X509_STORE) -> *const OPENSSL_STACK;
    fn OPENSSL_sk_num(sk: *const OPENSSL_STACK) -> usize;
    fn OPENSSL_sk_value(sk: *const OPENSSL_STACK, i: usize) -> *mut c_void;
    fn OPENSSL_sk_free(sk: *mut OPENSSL_STACK);
    fn BIO_new_mem_buf(buf: *const c_void, len: c_int) -> *mut BIO;
    fn BIO_new(method: *const BIO_METHOD) -> *mut BIO;
    fn BIO_s_mem() -> *const BIO_METHOD;
    fn BIO_free(bio: *mut BIO) -> c_int;
    fn BIO_get_mem_data(bio: *mut BIO, contents: *mut *mut c_char) -> c_long;
    fn PEM_read_bio_X509(
        bio: *mut BIO,
        out: *mut *mut X509,
        cb: Option<PemPasswordCb>,
        u: *mut c_void,
    ) -> *mut X509;
    fn PEM_read_bio_X509_AUX(
        bio: *mut BIO,
        out: *mut *mut X509,
        cb: Option<PemPasswordCb>,
        u: *mut c_void,
    ) -> *mut X509;
    fn PEM_read_bio_PrivateKey(
        bio: *mut BIO,
        out: *mut *mut EVP_PKEY,
        cb: Option<PemPasswordCb>,
        u: *mut c_void,
    ) -> *mut EVP_PKEY;
    fn PEM_read_DHparams(
        file: *mut libc::FILE,
        out: *mut *mut DH,
        cb: Option<PemPasswordCb>,
        u: *mut c_void,
    ) -> *mut DH;
    fn PEM_write_bio_PrivateKey(
        bio: *mut BIO,
        pkey: *const EVP_PKEY,
        enc: *const c_void,
        kstr: *const u8,
        klen: c_int,
        cb: Option<PemPasswordCb>,
        u: *mut c_void,
    ) -> c_int;
    fn PEM_write_bio_X509(bio: *mut BIO, x: *mut X509) -> c_int;
    fn d2i_PrivateKey_bio(bio: *mut BIO, out: *mut *mut EVP_PKEY) -> *mut EVP_PKEY;
    fn d2i_PKCS12_bio(bio: *mut BIO, out: *mut *mut PKCS12) -> *mut PKCS12;
    fn PKCS12_parse(
        p12: *mut PKCS12,
        password: *const c_char,
        out_pkey: *mut *mut EVP_PKEY,
        out_cert: *mut *mut X509,
        out_ca_certs: *mut *mut OPENSSL_STACK,
    ) -> c_int;
    fn PKCS12_free(p12: *mut PKCS12);
    fn EVP_PKEY_free(pkey: *mut EVP_PKEY);
    fn DH_free(dh: *mut DH);
    fn ERR_clear_error();
    fn ERR_peek_error() -> u32;
    fn ERR_peek_last_error() -> u32;
    fn ERR_error_string_n(packed_error: u32, buf: *mut c_char, len: usize) -> *mut c_char;
    fn SHA256_Init(ctx: *mut SHA256_CTX) -> c_int;
    fn SHA256_Update(ctx: *mut SHA256_CTX, data: *const c_void, len: usize) -> c_int;
    fn SHA256_Final(out: *mut u8, ctx: *mut SHA256_CTX) -> c_int;
    // root_certs.cpp (surviving C++ — tls-semantics.md A.6).
    fn us_get_default_ca_store() -> *mut X509_STORE;
    fn us_get_shared_default_ca_store() -> *mut X509_STORE;
    fn us_get_default_ciphers() -> *const c_char;
    // SSLContextCache.rs tombstone hook (tls-semantics.md A.2).
    fn bun_ssl_ctx_cache_on_free(
        parent: *mut c_void,
        ptr: *mut c_void,
        ad: *mut CRYPTO_EX_DATA,
        index: c_int,
        argl: c_long,
        argp: *mut c_void,
    );
}

// ── Pointer/CStr utilities ───────────────────────────────────────────────────

/// Contract: `p` is null or a NUL-terminated string valid for `'a`.
#[inline]
pub fn cstr_opt<'a>(p: *const c_char) -> Option<&'a CStr> {
    if p.is_null() {
        return None;
    }
    // SAFETY: caller contract — non-null p is NUL-terminated and lives for 'a.
    Some(unsafe { CStr::from_ptr(p) })
}

/// Contract: `arr` is null or points at `n` readable `*const c_char` slots.
#[inline]
pub fn ptr_array<'a>(arr: *const *const c_char, n: usize) -> &'a [*const c_char] {
    if arr.is_null() || n == 0 {
        return &[];
    }
    // SAFETY: caller contract — arr points at n readable pointer slots.
    unsafe { core::slice::from_raw_parts(arr, n) }
}

/// libc-heap copy of `s` (freed with `libc_free`) — the strdup'd passphrase.
pub fn strdup_raw(s: &CStr) -> *mut c_void {
    let n = s.to_bytes_with_nul().len();
    // SAFETY: allocation of n bytes; copy of exactly n bytes on success.
    unsafe {
        let p = libc::malloc(n);
        if !p.is_null() {
            ptr::copy_nonoverlapping(s.as_ptr().cast::<u8>(), p.cast::<u8>(), n);
        }
        p
    }
}

pub fn libc_free(p: *mut c_void) {
    // SAFETY: p is null or a live libc allocation owned by the caller.
    unsafe { libc::free(p) }
}

// ── Error-queue helpers ──────────────────────────────────────────────────────

pub fn err_clear_error() {
    // SAFETY: no preconditions (per-thread queue).
    unsafe { ERR_clear_error() }
}

pub fn err_peek_error() -> u32 {
    // SAFETY: no preconditions.
    unsafe { ERR_peek_error() }
}

pub fn err_peek_last_error() -> u32 {
    // SAFETY: no preconditions.
    unsafe { ERR_peek_last_error() }
}

/// `ERR_GET_LIB` (static-inline in BoringSSL — reimplemented, err.h:52).
#[inline]
pub fn err_get_lib(packed: u32) -> c_int {
    ((packed >> 24) & 0xff) as c_int
}

/// `ERR_GET_REASON` (static-inline in BoringSSL — reimplemented, err.h:59).
#[inline]
pub fn err_get_reason(packed: u32) -> c_int {
    (packed & 0xfff) as c_int
}

/// `ERR_error_string_n(err, buf, buf.len())`; output is NUL-terminated.
pub fn err_error_string(packed: u32, buf: &mut [u8]) {
    if buf.is_empty() {
        return;
    }
    // SAFETY: buf is writable for buf.len() bytes.
    unsafe { ERR_error_string_n(packed, buf.as_mut_ptr().cast::<c_char>(), buf.len()) };
}

// ── SHA-256 (digest cache key) ───────────────────────────────────────────────

pub struct Sha256(SHA256_CTX);

impl Sha256 {
    pub fn init() -> Self {
        // SAFETY: SHA256_Init writes the full ctx; never reads uninit bytes.
        unsafe {
            let mut ctx = core::mem::MaybeUninit::<SHA256_CTX>::uninit();
            SHA256_Init(ctx.as_mut_ptr());
            Self(ctx.assume_init())
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        // SAFETY: ctx initialized in init(); data is a readable slice.
        unsafe { SHA256_Update(&raw mut self.0, data.as_ptr().cast::<c_void>(), data.len()) };
    }

    pub fn finish(&mut self) -> [u8; 32] {
        let mut out = [0u8; 32];
        // SAFETY: ctx initialized; out has 32 writable bytes.
        unsafe { SHA256_Final(out.as_mut_ptr(), &raw mut self.0) };
        out
    }
}

// ── stat for the digest cache key (tls-semantics.md A.2) ────────────────────

/// `[mtime_sec, mtime_nsec, size]`; `None` on stat failure (digest feeds
/// zeros — ctx construction then fails on the same path, entry never caches).
#[cfg(unix)]
pub fn stat_for_digest(path: &CStr) -> Option<[i64; 3]> {
    let mut st = core::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: valid NUL-terminated path; stat(2) fills the out buffer.
    if unsafe { libc::stat(path.as_ptr(), st.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: stat returned 0, so the buffer is fully initialized.
    let st = unsafe { st.assume_init() };
    Some([st.st_mtime as i64, st.st_mtime_nsec as i64, st.st_size as i64])
}

#[cfg(windows)]
pub fn stat_for_digest(path: &CStr) -> Option<[i64; 3]> {
    // Follow symlinks like libuv's uv_fs_stat (no FILE_FLAG_OPEN_REPARSE_POINT)
    // so in-place cert rotation behind a link invalidates the digest.
    #[repr(C)]
    struct FILETIME {
        lo: u32,
        hi: u32,
    }
    #[repr(C)]
    struct BY_HANDLE_FILE_INFORMATION {
        attrs: u32,
        creation: FILETIME,
        access: FILETIME,
        write: FILETIME,
        volume_serial: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    unsafe extern "system" {
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            security: *mut c_void,
            disposition: u32,
            flags: u32,
            template: *mut c_void,
        ) -> *mut c_void;
        fn GetFileInformationByHandle(
            h: *mut c_void,
            info: *mut BY_HANDLE_FILE_INFORMATION,
        ) -> c_int;
        fn CloseHandle(h: *mut c_void) -> c_int;
    }
    const FILE_SHARE_ALL: u32 = 0x1 | 0x2 | 0x4;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

    let bytes = path.to_bytes();
    let mut wbuf = vec![0u16; bytes.len() + 1];
    let n = bun_core::strings::convert_utf8_to_utf16_in_buffer(&mut wbuf, bytes).len();
    for u in &mut wbuf[..n] {
        if *u == u16::from(b'/') {
            *u = u16::from(b'\\');
        }
    }
    wbuf[n] = 0;
    // SAFETY: wbuf is NUL-terminated at [n]; access=0 is metadata-query-only.
    let h = unsafe {
        CreateFileW(
            wbuf.as_ptr(),
            0,
            FILE_SHARE_ALL,
            ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            ptr::null_mut(),
        )
    };
    if h.addr() == usize::MAX {
        return None;
    }
    let mut info = core::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
    // SAFETY: h is a valid open handle; the call fills the out buffer.
    let ok = unsafe { GetFileInformationByHandle(h, info.as_mut_ptr()) };
    // SAFETY: h is a valid open handle from CreateFileW above.
    unsafe { CloseHandle(h) };
    if ok == 0 {
        return None;
    }
    // SAFETY: GetFileInformationByHandle succeeded — buffer initialized.
    let info = unsafe { info.assume_init() };
    let ticks = (u64::from(info.write.hi) << 32) | u64::from(info.write.lo);
    let size = (u64::from(info.size_high) << 32) | u64::from(info.size_low);
    Some([
        (ticks / 10_000_000) as i64,
        (ticks % 10_000_000) as i64 * 100,
        size as i64,
    ])
}

// ── ex_data registry (openssl.c:140-395) ─────────────────────────────────────

pub struct ExIndices {
    /// SSL_CTX: packed reneg policy; free_func decrements the live counter.
    pub ctx: c_int,
    /// SSL_CTX: per-domain SNI userdata (uWS HttpRouter*).
    pub sni_user: c_int,
    /// SSL_CTX: SSLContextCache tombstone back-pointer.
    pub ctx_cache: c_int,
    /// SSL_CTX: marker — verification store holds user-provided CAs.
    pub ctx_user_ca: c_int,
    /// SSL: per-connection reneg counter (lazy Box<RenegState>).
    pub reneg_state: c_int,
    /// SSL: async-SNI suspension state (Box<SniSuspension>).
    pub sni_pending: c_int,
    /// SSL: accepting listener backref (never the shared CTX — UAF).
    pub listener: c_int,
    /// SSL: parked session/keylog opt-in marker.
    pub is_socket: c_int,
    /// SSL: parked serialized sessions (Box<PendingList>).
    pub pending_session: c_int,
    /// SSL: parked keylog lines (Box<PendingList>).
    pub pending_keylog: c_int,
}

/// pthread_once-shaped storage (the deleted openssl.c's `us_ex_idx_once` +
/// plain int statics): written exactly once inside `EX_ONCE`, read only
/// after `call_once` returns — the `Once` provides the happens-before.
struct ExCell(UnsafeCell<ExIndices>);
// SAFETY: single write inside `Once::call_once`; all reads are ordered after
// it by `call_once`'s synchronization.
unsafe impl Sync for ExCell {}

static EX_ONCE: Once = Once::new();
static EX_INDICES: ExCell = ExCell(UnsafeCell::new(ExIndices {
    ctx: -1,
    sni_user: -1,
    ctx_cache: -1,
    ctx_user_ca: -1,
    reneg_state: -1,
    sni_pending: -1,
    listener: -1,
    is_socket: -1,
    pending_session: -1,
    pending_keylog: -1,
}));
static SSL_CTX_LIVE: AtomicI64 = AtomicI64::new(0);

unsafe extern "C" fn ctx_ex_free(
    _parent: *mut c_void,
    _ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    SSL_CTX_LIVE.fetch_sub(1, Ordering::SeqCst);
}

unsafe extern "C" fn reneg_state_free(
    _parent: *mut c_void,
    ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    if !ptr.is_null() {
        // SAFETY: slot only ever holds a heap RenegState from reneg_state_ptr.
        unsafe { bun_core::heap::destroy(ptr.cast::<RenegState>()) };
    }
}

unsafe extern "C" fn sni_pending_free(
    _parent: *mut c_void,
    ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    if !ptr.is_null() {
        // SAFETY: slot only ever holds a heap SniSuspension from sni_set.
        let boxed = unsafe { bun_core::heap::take(ptr.cast::<SniSuspension>()) };
        if let SniSuspension::Resolved(ctx) = *boxed {
            ssl_ctx_free(ctx);
        }
    }
}

unsafe extern "C" fn pending_list_free(
    _parent: *mut c_void,
    ptr: *mut c_void,
    _ad: *mut CRYPTO_EX_DATA,
    _index: c_int,
    _argl: c_long,
    _argp: *mut c_void,
) {
    if !ptr.is_null() {
        // SAFETY: slot only ever holds a heap PendingList from pending_push.
        unsafe { bun_core::heap::destroy(ptr.cast::<PendingList>()) };
    }
}

/// One-time registration at first SSL_CTX/SSL touch (`Once` = the C's
/// pthread_once rule: SSL_CTX creation runs from both the JS and HTTP-client
/// threads).
pub fn ex_indices() -> &'static ExIndices {
    EX_ONCE.call_once(|| {
        let null = ptr::null_mut();
        // SAFETY: registration-only FFI; free_funcs match each slot's
        // payload. Sole write to the cell — no reader exists until
        // `call_once` returns.
        unsafe {
            *EX_INDICES.0.get() = ExIndices {
                ctx: SSL_CTX_get_ex_new_index(0, null, null, null, Some(ctx_ex_free)),
                sni_user: SSL_CTX_get_ex_new_index(0, null, null, null, None),
                ctx_cache: SSL_CTX_get_ex_new_index(
                    0,
                    null,
                    null,
                    null,
                    Some(bun_ssl_ctx_cache_on_free),
                ),
                ctx_user_ca: SSL_CTX_get_ex_new_index(0, null, null, null, None),
                reneg_state: SSL_get_ex_new_index(0, null, null, null, Some(reneg_state_free)),
                sni_pending: SSL_get_ex_new_index(0, null, null, null, Some(sni_pending_free)),
                listener: SSL_get_ex_new_index(0, null, null, null, None),
                is_socket: SSL_get_ex_new_index(0, null, null, null, None),
                pending_session: SSL_get_ex_new_index(0, null, null, null, Some(pending_list_free)),
                pending_keylog: SSL_get_ex_new_index(0, null, null, null, Some(pending_list_free)),
            };
        }
    });
    // SAFETY: `call_once` returned, so the single write above happened-before
    // this read and no write can ever run again.
    unsafe { &*EX_INDICES.0.get() }
}

pub fn ssl_ctx_live_count() -> i64 {
    SSL_CTX_LIVE.load(Ordering::SeqCst)
}

/// Contract for all raw-pointer helpers below: pointers are live objects (or
/// null where the wrapped C API is null-tolerant).
pub fn ssl_set_ex_data(ssl: *mut SSL, idx: c_int, data: *mut c_void) {
    // SAFETY: live SSL per contract.
    unsafe { SSL_set_ex_data(ssl, idx, data) };
}

pub fn ssl_get_ex_data(ssl: *const SSL, idx: c_int) -> *mut c_void {
    // SAFETY: live SSL per contract.
    unsafe { SSL_get_ex_data(ssl, idx) }
}

/// Current CTX (SNI may have swapped it mid-handshake); BORROWED — never unref.
pub fn ssl_get_ctx(ssl: *const SSL) -> *mut SslCtx {
    // SAFETY: live SSL per contract.
    unsafe { SSL_get_SSL_CTX(ssl) }
}

pub fn ctx_set_ex_data(ctx: *mut SslCtx, idx: c_int, data: *mut c_void) {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_set_ex_data(ctx, idx, data) };
}

pub fn ctx_get_ex_data(ctx: *const SslCtx, idx: c_int) -> *mut c_void {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_get_ex_data(ctx, idx) }
}

// ── Reneg policy/state (openssl.c:187-189, 446-461) ─────────────────────────

pub struct RenegState {
    pub window_start_ms: u64,
    pub count: u32,
}

/// Per-connection counter, alloc'd lazily on first renegotiation attempt.
pub fn reneg_state_ptr(ssl: *mut SSL) -> *mut RenegState {
    let idx = ex_indices().reneg_state;
    let existing = ssl_get_ex_data(ssl, idx);
    if !existing.is_null() {
        return existing.cast::<RenegState>();
    }
    let fresh = bun_core::heap::into_raw(Box::new(RenegState {
        window_start_ms: 0,
        count: 0,
    }));
    ssl_set_ex_data(ssl, idx, fresh.cast::<c_void>());
    fresh
}

fn reneg_pack(limit: u32, window: u32) -> *mut c_void {
    ptr::without_provenance_mut(((limit as usize) << 32) | window as usize)
}

pub fn set_reneg_policy(ctx: *mut SslCtx, limit: u32, window: u32) {
    ctx_set_ex_data(ctx, ex_indices().ctx, reneg_pack(limit, window));
}

/// `(limit, window)`; defaults 3/600 (Node CLIENT_RENEG_LIMIT/WINDOW).
pub fn reneg_policy(ctx: *const SslCtx) -> (u32, u32) {
    let packed = ctx_get_ex_data(ctx, ex_indices().ctx).addr();
    if packed == 0 {
        (3, 600)
    } else {
        ((packed >> 32) as u32, packed as u32)
    }
}

// ── Async-SNI suspension (openssl.c:191-208) ─────────────────────────────────

pub enum SniSuspension {
    /// State 1: waiting for the JS resolution.
    Waiting,
    /// State 2: resolved; carries ONE owned ctx ref (null = static-tree fallback).
    Resolved(*mut SslCtx),
    /// State 3: resolver errored — drop the connection without a TLS alert.
    Error,
}

pub fn sni_set(ssl: *mut SSL, state: SniSuspension) {
    let idx = ex_indices().sni_pending;
    sni_clear(ssl);
    ssl_set_ex_data(ssl, idx, bun_core::heap::into_raw(Box::new(state)).cast::<c_void>());
}

/// Take (and clear) the suspension state; the caller owns any carried ctx ref.
pub fn sni_take(ssl: *mut SSL) -> Option<SniSuspension> {
    let idx = ex_indices().sni_pending;
    let p = ssl_get_ex_data(ssl, idx);
    if p.is_null() {
        return None;
    }
    ssl_set_ex_data(ssl, idx, ptr::null_mut());
    // SAFETY: slot only ever holds a heap SniSuspension from sni_set.
    Some(*unsafe { bun_core::heap::take(p.cast::<SniSuspension>()) })
}

pub fn sni_is_waiting(ssl: *const SSL) -> bool {
    let p = ssl_get_ex_data(ssl.cast_mut(), ex_indices().sni_pending);
    // SAFETY: slot only ever holds Box<SniSuspension> from sni_set.
    !p.is_null() && matches!(unsafe { &*p.cast::<SniSuspension>() }, SniSuspension::Waiting)
}

fn sni_clear(ssl: *mut SSL) {
    if let Some(SniSuspension::Resolved(ctx)) = sni_take(ssl) {
        ssl_ctx_free(ctx);
    }
}

// ── Pending session/keylog park-then-flush queues (openssl.c:226-439) ───────

struct PendingList(Vec<Box<[u8]>>);

fn pending_push(ssl: *mut SSL, idx: c_int, entry: Box<[u8]>) {
    let p = ssl_get_ex_data(ssl, idx);
    if p.is_null() {
        let list = bun_core::heap::into_raw(Box::new(PendingList(vec![entry])));
        ssl_set_ex_data(ssl, idx, list.cast::<c_void>());
    } else {
        // SAFETY: slot only ever holds Box<PendingList> from this fn.
        unsafe { &mut *p.cast::<PendingList>() }.0.push(entry);
    }
}

fn pending_take(ssl: *mut SSL, idx: c_int) -> Vec<Box<[u8]>> {
    let p = ssl_get_ex_data(ssl, idx);
    if p.is_null() {
        return Vec::new();
    }
    ssl_set_ex_data(ssl, idx, ptr::null_mut());
    // SAFETY: slot only ever holds a heap PendingList from pending_push.
    unsafe { bun_core::heap::take(p.cast::<PendingList>()) }.0
}

fn pending_pop(ssl: *mut SSL, idx: c_int, out: &mut [u8]) -> usize {
    let p = ssl_get_ex_data(ssl, idx);
    if p.is_null() {
        return 0;
    }
    // SAFETY: slot only ever holds Box<PendingList> from pending_push.
    let list = unsafe { &mut *p.cast::<PendingList>() };
    if list.0.is_empty() {
        return 0;
    }
    let entry = list.0.remove(0);
    if entry.len() > out.len() {
        // Parking sites cap entries; callers pass buffers at least that
        // large, so this is unreachable — drop rather than overflow.
        return 0;
    }
    out[..entry.len()].copy_from_slice(&entry);
    entry.len()
}

/// Drain ALL parked sessions in arrival order (W11 dispatches at its flush
/// points — before data, before ZERO_RETURN close, buffer cycle, loop end).
pub fn drain_pending_sessions(ssl: *mut SSL) -> Vec<Box<[u8]>> {
    pending_take(ssl, ex_indices().pending_session)
}

pub fn drain_pending_keylog(ssl: *mut SSL) -> Vec<Box<[u8]>> {
    pending_take(ssl, ex_indices().pending_keylog)
}

/// SSLWrapper drain (`us_ssl_pop_pending_session` parity): oldest entry into
/// `out`, returns byte length, 0 when empty.
pub fn pop_pending_session(ssl: *mut SSL, out: &mut [u8]) -> usize {
    pending_pop(ssl, ex_indices().pending_session, out)
}

pub fn pop_pending_keylog(ssl: *mut SSL, out: &mut [u8]) -> usize {
    pending_pop(ssl, ex_indices().pending_keylog, out)
}

/// `us_ssl_enable_pending_events` — opt a non-us_socket SSL (SSLWrapper) into
/// the parked queues.
pub fn enable_pending_events(ssl: *mut SSL) {
    ssl_set_ex_data(ssl, ex_indices().is_socket, ptr::without_provenance_mut(1));
}

pub fn is_socket_marked(ssl: *const SSL) -> bool {
    !ssl_get_ex_data(ssl.cast_mut(), ex_indices().is_socket).is_null()
}

/// New-session callback: fires from inside SSL_read/SSL_do_handshake — only
/// serialize + park (running JS here is a UAF). Returns 0: caller keeps
/// ownership of `session` (we stored a serialized copy).
unsafe extern "C" fn new_session_cb(ssl: *mut SSL, session: *mut SSL_SESSION) -> c_int {
    if !is_socket_marked(ssl) {
        return 0;
    }
    // SAFETY: i2d double-call pattern; session is live for the callback.
    let len = unsafe { i2d_SSL_SESSION(session, ptr::null_mut()) };
    if len <= 0 || len as usize > crate::tls::context::US_SSL_PENDING_SESSION_MAX {
        return 0;
    }
    let mut buf = vec![0u8; len as usize].into_boxed_slice();
    let mut p = buf.as_mut_ptr();
    // SAFETY: buf has exactly `len` writable bytes as sized above.
    let written = unsafe { i2d_SSL_SESSION(session, &raw mut p) };
    if written <= 0 {
        return 0;
    }
    debug_assert_eq!(written, len);
    pending_push(ssl, ex_indices().pending_session, buf);
    0
}

/// Keylog callback: parks `line + '\n'` (Node appends the newline before
/// emitting 'keylog').
unsafe extern "C" fn keylog_cb(ssl: *const SSL, line: *const c_char) {
    if !is_socket_marked(ssl) {
        return;
    }
    let Some(line) = cstr_opt(line) else { return };
    let bytes = line.to_bytes();
    if bytes.is_empty() || bytes.len() > crate::tls::context::US_SSL_PENDING_KEYLOG_LINE_MAX {
        return;
    }
    let mut entry = Vec::with_capacity(bytes.len() + 1);
    entry.extend_from_slice(bytes);
    entry.push(b'\n');
    pending_push(
        ssl.cast_mut(),
        ex_indices().pending_keylog,
        entry.into_boxed_slice(),
    );
}

// ── Verify plumbing (openssl.c:865-870, 1413-1440) ──────────────────────────

/// Always continue: the verdict is carried in verify_error and the
/// fail-closed decision is made by the consumer (tls-semantics.md §2.4).
unsafe extern "C" fn verify_cb(_preverify_ok: c_int, _ctx: *mut X509_STORE_CTX) -> c_int {
    1
}

/// `us_internal_verify_peer_certificate`: default `def` when no peer cert,
/// with the PSK-cipher / TLS1.3-resumption exemptions returning X509_V_OK.
pub fn verify_peer_certificate(ssl: *const SSL, def: c_long) -> c_long {
    if ssl.is_null() {
        return def;
    }
    // SAFETY: live SSL per contract; peer cert ref released immediately.
    unsafe {
        let peer_cert = SSL_get_peer_certificate(ssl);
        if !peer_cert.is_null() {
            X509_free(peer_cert);
            return SSL_get_verify_result(ssl);
        }
        let cipher = SSL_get_current_cipher(ssl);
        let sess = SSL_get_session(ssl);
        if (!cipher.is_null() && SSL_CIPHER_get_auth_nid(cipher) == NID_AUTH_PSK)
            || (!sess.is_null()
                && SSL_SESSION_get_protocol_version(sess) == TLS1_3_VERSION
                && SSL_session_reused(ssl) != 0)
        {
            return X509_V_OK;
        }
    }
    def
}

/// `X509_verify_cert_error_string` — static table string, never freed.
pub fn verify_error_string(err: c_long) -> *const c_char {
    // SAFETY: pure lookup into a static table.
    unsafe { X509_verify_cert_error_string(err) }
}

// ── SSL_CTX lifecycle + option application ──────────────────────────────────

pub fn ssl_ctx_up_ref(ctx: *mut SslCtx) {
    if !ctx.is_null() {
        // SAFETY: live SSL_CTX per contract.
        unsafe { SSL_CTX_up_ref(ctx) };
    }
}

pub fn ssl_ctx_free(ctx: *mut SslCtx) {
    if !ctx.is_null() {
        // SAFETY: releases one owned ref per contract.
        unsafe { SSL_CTX_free(ctx) };
    }
}

/// `SSL_CTX_new(TLS_method())` + live counter + required modes
/// (read_ahead(1) + ACCEPT_MOVING_WRITE_BUFFER — load-bearing for the BIO
/// design, tls-semantics.md §8.2). Returns null on allocation failure.
pub fn ssl_ctx_new_base() -> *mut SslCtx {
    // SAFETY: creation-only FFI.
    unsafe {
        let ctx = SSL_CTX_new(TLS_method());
        if ctx.is_null() {
            return ctx;
        }
        SSL_CTX_LIVE.fetch_add(1, Ordering::SeqCst);
        // Register the live-count free_func slot first so every exit balances.
        SSL_CTX_set_ex_data(ctx, ex_indices().ctx, ptr::null_mut());
        SSL_CTX_set_read_ahead(ctx, 1);
        SSL_CTX_set_mode(ctx, SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER);
        ctx
    }
}

pub fn ctx_set_min_proto_version(ctx: *mut SslCtx, version: u16) {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_set_min_proto_version(ctx, version) };
}

pub fn ctx_set_max_proto_version(ctx: *mut SslCtx, version: u16) {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_set_max_proto_version(ctx, version) };
}

pub fn ctx_set_release_buffers_mode(ctx: *mut SslCtx) {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_set_mode(ctx, SSL_MODE_RELEASE_BUFFERS) };
}

pub fn ctx_set_secure_options(ctx: *mut SslCtx, options: u32) {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_set_options(ctx, options) };
}

pub fn ctx_get_verify_mode(ctx: *const SslCtx) -> c_int {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_get_verify_mode(ctx) }
}

pub fn ctx_set_verify(ctx: *mut SslCtx, mode: c_int) {
    // SAFETY: live SSL_CTX; verify_cb is 'static.
    unsafe { SSL_CTX_set_verify(ctx, mode, Some(verify_cb)) };
}

/// `int passphrase_cb(char*, int, int, void*)` — copies the strdup'd
/// passphrase; fails when longer than the buffer (openssl.c:473-479).
unsafe extern "C" fn passphrase_cb(
    buf: *mut c_char,
    size: c_int,
    _rwflag: c_int,
    u: *mut c_void,
) -> c_int {
    let Some(pass) = cstr_opt(u.cast_const().cast::<c_char>()) else {
        return -1;
    };
    let bytes = pass.to_bytes();
    if size < 0 || bytes.len() > size as usize {
        return -1;
    }
    // SAFETY: buf has `size` writable bytes; bytes.len() <= size.
    unsafe { ptr::copy_nonoverlapping(bytes.as_ptr(), buf.cast::<u8>(), bytes.len()) };
    bytes.len() as c_int
}

/// strdup the passphrase into the CTX passwd_cb userdata slot; dropped via
/// [`ctx_drop_passphrase`] as soon as key loading completes (or build fails).
pub fn ctx_set_passphrase(ctx: *mut SslCtx, passphrase: &CStr) {
    let copy = strdup_raw(passphrase);
    // SAFETY: live SSL_CTX; copy is owned by the slot until dropped.
    unsafe {
        SSL_CTX_set_default_passwd_cb_userdata(ctx, copy);
        SSL_CTX_set_default_passwd_cb(ctx, Some(passphrase_cb));
    }
}

pub fn ctx_drop_passphrase(ctx: *mut SslCtx) {
    // SAFETY: live SSL_CTX; slot holds our strdup or null.
    unsafe {
        let password = SSL_CTX_get_default_passwd_cb_userdata(ctx);
        if !password.is_null() {
            libc::free(password);
            SSL_CTX_set_default_passwd_cb_userdata(ctx, ptr::null_mut());
        }
    }
}

pub fn ctx_use_certificate_chain_file(ctx: *mut SslCtx, file: &CStr) -> bool {
    // SAFETY: live SSL_CTX; NUL-terminated path.
    unsafe { SSL_CTX_use_certificate_chain_file(ctx, file.as_ptr()) == 1 }
}

pub fn ctx_use_privatekey_file(ctx: *mut SslCtx, file: &CStr) -> bool {
    // SAFETY: live SSL_CTX; NUL-terminated path.
    unsafe { SSL_CTX_use_PrivateKey_file(ctx, file.as_ptr(), SSL_FILETYPE_PEM) == 1 }
}

/// `us_ssl_ctx_use_certificate_chain` (openssl.c:812-863): PEM_read_bio_
/// X509_AUX leaf + add0 chain certs; trailing NO_START_LINE tolerated.
pub fn ctx_use_certificate_chain_content(ctx: *mut SslCtx, content: &CStr) -> bool {
    err_clear_error();
    let bytes = content.to_bytes();
    if bytes.len() > c_int::MAX as usize {
        return false;
    }
    // SAFETY: mem BIO borrows `content` for the duration of this call only;
    // X509_free/BIO_free are null-tolerant.
    unsafe {
        let bio = BIO_new_mem_buf(content.as_ptr().cast::<c_void>(), bytes.len() as c_int);
        if bio.is_null() {
            return false;
        }
        let cb = SSL_CTX_get_default_passwd_cb(ctx);
        let u = SSL_CTX_get_default_passwd_cb_userdata(ctx);
        let x = PEM_read_bio_X509_AUX(bio, ptr::null_mut(), cb, u);
        let mut ret = false;
        if !x.is_null() {
            ret = SSL_CTX_use_certificate(ctx, x) == 1;
            if err_peek_error() != 0 {
                ret = false;
            }
            if ret {
                SSL_CTX_clear_chain_certs(ctx);
                loop {
                    let ca = PEM_read_bio_X509(bio, ptr::null_mut(), cb, u);
                    if ca.is_null() {
                        break;
                    }
                    if SSL_CTX_add0_chain_cert(ctx, ca) != 1 {
                        X509_free(ca);
                        ret = false;
                        break;
                    }
                }
                if ret {
                    let err = err_peek_last_error();
                    if err_get_lib(err) == ERR_LIB_PEM
                        && err_get_reason(err) == PEM_R_NO_START_LINE
                    {
                        err_clear_error();
                    } else {
                        ret = false;
                    }
                }
            }
        }
        X509_free(x);
        BIO_free(bio);
        ret
    }
}

/// `us_ssl_ctx_use_privatekey_content` (openssl.c:734-766), PEM or DER.
pub fn ctx_use_privatekey_content(ctx: *mut SslCtx, content: &CStr, pem: bool) -> bool {
    let bytes = content.to_bytes();
    if bytes.len() > c_int::MAX as usize {
        return false;
    }
    // SAFETY: mem BIO borrows `content` for the duration of this call only.
    unsafe {
        let bio = BIO_new_mem_buf(content.as_ptr().cast::<c_void>(), bytes.len() as c_int);
        if bio.is_null() {
            return false;
        }
        let pkey = if pem {
            let cb = SSL_CTX_get_default_passwd_cb(ctx);
            let u = SSL_CTX_get_default_passwd_cb_userdata(ctx);
            PEM_read_bio_PrivateKey(bio, ptr::null_mut(), cb, u)
        } else {
            d2i_PrivateKey_bio(bio, ptr::null_mut())
        };
        let mut ret = false;
        if !pkey.is_null() {
            ret = SSL_CTX_use_PrivateKey(ctx, pkey) == 1;
            EVP_PKEY_free(pkey);
        }
        BIO_free(bio);
        ret
    }
}

/// `add_ca_cert_to_ctx_store` (openssl.c:768-810): adds each PEM cert to the
/// store AND client-CA list; a PEM doc with zero certs but a `-----BEGIN `
/// block is tolerated Node-style; non-PEM is an error.
pub fn add_ca_cert_to_store(ctx: *mut SslCtx, content: &CStr, store: *mut X509_STORE) -> bool {
    err_clear_error();
    let bytes = content.to_bytes();
    if bytes.len() > c_int::MAX as usize {
        return false;
    }
    let mut count = 0usize;
    // SAFETY: mem BIO borrows `content` for the duration of this call only.
    unsafe {
        let bio = BIO_new_mem_buf(content.as_ptr().cast::<c_void>(), bytes.len() as c_int);
        if bio.is_null() {
            return false;
        }
        let cb = SSL_CTX_get_default_passwd_cb(ctx);
        let u = SSL_CTX_get_default_passwd_cb_userdata(ctx);
        loop {
            let x = PEM_read_bio_X509(bio, ptr::null_mut(), cb, u);
            if x.is_null() {
                break;
            }
            X509_STORE_add_cert(store, x);
            if SSL_CTX_add_client_CA(ctx, x) != 1 {
                X509_free(x);
                BIO_free(bio);
                return false;
            }
            count += 1;
            X509_free(x);
        }
        BIO_free(bio);
    }
    if count == 0 {
        let pem_err = err_peek_last_error();
        let tolerated = pem_err == 0
            || (err_get_lib(pem_err) == ERR_LIB_PEM
                && err_get_reason(pem_err) == PEM_R_NO_START_LINE);
        if tolerated && contains_begin_block(bytes) {
            err_clear_error();
            return true;
        }
        return false;
    }
    err_clear_error();
    true
}

fn contains_begin_block(content: &[u8]) -> bool {
    const NEEDLE: &[u8] = b"-----BEGIN ";
    content.windows(NEEDLE.len()).any(|w| w == NEEDLE)
}

/// ca_file_name branch (openssl.c:984-997): `SSL_load_client_CA_file` +
/// `SSL_CTX_set_client_CA_list`; false = LOAD_CA_FILE.
pub fn ctx_load_client_ca_file(ctx: *mut SslCtx, file: &CStr) -> bool {
    // SAFETY: live SSL_CTX; NUL-terminated path; list ownership transfers.
    unsafe {
        let list = SSL_load_client_CA_file(file.as_ptr());
        if list.is_null() {
            return false;
        }
        SSL_CTX_set_client_CA_list(ctx, list);
        true
    }
}

pub fn ctx_load_verify_locations(ctx: *mut SslCtx, file: &CStr) -> bool {
    // SAFETY: live SSL_CTX; NUL-terminated path.
    unsafe { SSL_CTX_load_verify_locations(ctx, file.as_ptr(), ptr::null()) == 1 }
}

pub fn ctx_get_cert_store(ctx: *const SslCtx) -> *mut X509_STORE {
    // SAFETY: live SSL_CTX per contract.
    unsafe { SSL_CTX_get_cert_store(ctx) }
}

/// Ownership of `store` transfers to the CTX.
pub fn ctx_set_cert_store(ctx: *mut SslCtx, store: *mut X509_STORE) {
    // SAFETY: live SSL_CTX; store ownership transfers.
    unsafe { SSL_CTX_set_cert_store(ctx, store) };
}

pub fn x509_store_free(store: *mut X509_STORE) {
    // SAFETY: releases one owned ref (null-tolerant).
    unsafe { X509_STORE_free(store) };
}

pub fn x509_store_is_empty(store: *mut X509_STORE) -> bool {
    // SAFETY: live store; get0 returns a borrowed stack.
    unsafe {
        let objs = X509_STORE_get0_objects(store);
        objs.is_null() || OPENSSL_sk_num(objs) == 0
    }
}

/// dh_params_file_name (openssl.c:1033-1052): fopen + PEM_read_DHparams +
/// SSL_CTX_set_tmp_dh; any failure = build failure with no error tag.
pub fn ctx_set_dh_params_from_file(ctx: *mut SslCtx, path: &CStr) -> bool {
    // SAFETY: NUL-terminated path; FILE closed before return; DH freed after
    // set_tmp_dh (which copies).
    unsafe {
        let file = libc::fopen(path.as_ptr(), c"r".as_ptr());
        if file.is_null() {
            return false;
        }
        let dh = PEM_read_DHparams(file, ptr::null_mut(), None, ptr::null_mut());
        libc::fclose(file);
        if dh.is_null() {
            return false;
        }
        let ok = SSL_CTX_set_tmp_dh(ctx, dh) == 1;
        DH_free(dh);
        ok
    }
}

pub fn ctx_set_cipher_list(ctx: *mut SslCtx, ciphers: &CStr) -> bool {
    // SAFETY: live SSL_CTX; NUL-terminated list.
    unsafe { SSL_CTX_set_cipher_list(ctx, ciphers.as_ptr()) == 1 }
}

/// Empty-string + NO_CIPHER_MATCH is the one tolerated cipher failure; the
/// error is PEEKED not consumed so the caller can decompose the reason.
pub fn cipher_failure_tolerated(ciphers: &CStr) -> bool {
    ciphers.to_bytes().is_empty() && err_get_reason(err_peek_error()) == SSL_R_NO_CIPHER_MATCH
}

/// Session-cache mode + new-session cb + keylog cb (openssl.c:1077-1086).
pub fn ctx_install_session_callbacks(ctx: *mut SslCtx) {
    // SAFETY: live SSL_CTX; callbacks are 'static.
    unsafe {
        SSL_CTX_set_session_cache_mode(ctx, SSL_SESS_CACHE_MODE);
        SSL_CTX_sess_set_new_cb(ctx, Some(new_session_cb));
        SSL_CTX_set_keylog_callback(ctx, Some(keylog_cb));
    }
}

// ── Root certs (surviving C++ providers) ─────────────────────────────────────

/// Fresh full default store (bundled + NODE_EXTRA_CA_CERTS + system CAs when
/// enabled); caller owns the returned ref.
pub fn default_ca_store() -> *mut X509_STORE {
    // SAFETY: root_certs.cpp API, no preconditions.
    unsafe { us_get_default_ca_store() }
}

/// Process-shared immutable store; UP-REF'D PER RETURN — caller must free.
pub fn shared_default_ca_store() -> *mut X509_STORE {
    // SAFETY: root_certs.cpp API, no preconditions.
    unsafe { us_get_shared_default_ca_store() }
}

/// `DEFAULT_CIPHER_LIST` — static string from root_certs.cpp.
pub fn default_ciphers() -> &'static CStr {
    // SAFETY: returns a pointer to a static string literal.
    unsafe { CStr::from_ptr(us_get_default_ciphers()) }
}

// ── PKCS#12 (openssl.c:1140-1232) ────────────────────────────────────────────

pub struct Pkcs12Pem {
    pub key: Vec<u8>,
    pub cert: Vec<u8>,
    pub ca: Option<Vec<u8>>,
}

fn pem_from_bio(bio: *mut BIO) -> Option<Vec<u8>> {
    // SAFETY: bio is a live mem BIO; BIO_get_mem_data borrows its buffer.
    unsafe {
        let mut mem: *mut c_char = ptr::null_mut();
        let n = BIO_get_mem_data(bio, &raw mut mem);
        if n <= 0 || mem.is_null() {
            return None;
        }
        Some(core::slice::from_raw_parts(mem.cast::<u8>(), n as usize).to_vec())
    }
}

/// `us_ssl_parse_pkcs12`: PKCS#12 blob (+pass) → PEM key/cert/ca. Error tags:
/// "parse" (not PKCS#12 / len > INT_MAX), "mac" (bad pass), "key", "cert".
pub fn parse_pkcs12(data: &[u8], pass: Option<&CStr>) -> Result<Pkcs12Pem, &'static str> {
    if data.len() > c_int::MAX as usize {
        // BIO_new_mem_buf takes an int; a negative len silently misparses.
        return Err("parse");
    }
    // SAFETY: mem BIOs borrow `data` only within this call; every OpenSSL
    // object created below is freed on all paths before return.
    unsafe {
        let bio = BIO_new_mem_buf(data.as_ptr().cast::<c_void>(), data.len() as c_int);
        if bio.is_null() {
            return Err("parse");
        }
        let p12 = d2i_PKCS12_bio(bio, ptr::null_mut());
        BIO_free(bio);
        if p12.is_null() {
            err_clear_error();
            return Err("parse");
        }
        let mut pkey: *mut EVP_PKEY = ptr::null_mut();
        let mut cert: *mut X509 = ptr::null_mut();
        let mut extra: *mut OPENSSL_STACK = ptr::null_mut();
        let pass_ptr = pass.map_or(c"".as_ptr(), CStr::as_ptr);
        let parsed =
            PKCS12_parse(p12, pass_ptr, &raw mut pkey, &raw mut cert, &raw mut extra) == 1;

        let cleanup = |tag: &'static str| -> &'static str {
            if !pkey.is_null() {
                EVP_PKEY_free(pkey);
            }
            if !cert.is_null() {
                X509_free(cert);
            }
            if !extra.is_null() {
                for i in 0..OPENSSL_sk_num(extra) {
                    X509_free(OPENSSL_sk_value(extra, i).cast::<X509>());
                }
                OPENSSL_sk_free(extra);
            }
            PKCS12_free(p12);
            err_clear_error();
            tag
        };

        if !parsed {
            return Err(cleanup("mac"));
        }
        if pkey.is_null() {
            return Err(cleanup("key"));
        }
        if cert.is_null() {
            return Err(cleanup("cert"));
        }

        let kb = BIO_new(BIO_s_mem());
        let cb = BIO_new(BIO_s_mem());
        let mut out: Result<Pkcs12Pem, &'static str> = Err("parse");
        if !kb.is_null()
            && !cb.is_null()
            && PEM_write_bio_PrivateKey(kb, pkey, ptr::null(), ptr::null(), 0, None, ptr::null_mut())
                == 1
            && PEM_write_bio_X509(cb, cert) == 1
        {
            if let (Some(key), Some(cert_pem)) = (pem_from_bio(kb), pem_from_bio(cb)) {
                let mut ca = None;
                if !extra.is_null() && OPENSSL_sk_num(extra) > 0 {
                    let ab = BIO_new(BIO_s_mem());
                    if !ab.is_null() {
                        for i in 0..OPENSSL_sk_num(extra) {
                            PEM_write_bio_X509(ab, OPENSSL_sk_value(extra, i).cast::<X509>());
                        }
                        ca = pem_from_bio(ab);
                        BIO_free(ab);
                    }
                }
                out = Ok(Pkcs12Pem {
                    key,
                    cert: cert_pem,
                    ca,
                });
            }
        }
        if !kb.is_null() {
            BIO_free(kb);
        }
        if !cb.is_null() {
            BIO_free(cb);
        }
        match out {
            Ok(pem) => {
                let _ = cleanup("");
                Ok(pem)
            }
            Err(tag) => Err(cleanup(tag)),
        }
    }
}
