//! Hand-rolled BoringSSL FFI surface.
//!
//! Ground truth: `src/boringssl_sys/boringssl.zig` (translate-c output) and
//! `vendor/boringssl/include/openssl/*.h`. This file exposes only the subset
//! of symbols Bun's Rust crates actually consume — it is **not** a full
//! bindgen dump. When the bindgen pipeline lands this module is replaced
//! wholesale.
//
// ported from: src/boringssl_sys/boringssl.zig

use core::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_void};

// ═══════════════════════════════════════════════════════════════════════════
// Opaque-type helper — thin sugar over the canonical
// `bun_opaque::opaque_ffi!` (see its crate doc for the `UnsafeCell<[u8;0]>` /
// `PhantomPinned` rationale). Local alias just bakes in `pub` so the 21
// `opaque!(/// doc \n Name)` call sites below stay one-arg.
// ═══════════════════════════════════════════════════════════════════════════

macro_rules! opaque {
    ($($(#[$m:meta])* $name:ident),+ $(,)?) => {
        ::bun_opaque::opaque_ffi!($($(#[$m])* pub $name),+);
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/// `#define EVP_MAX_MD_SIZE 64` — SHA-512 is the longest digest.
pub const EVP_MAX_MD_SIZE: c_int = 64;

/// `#define RIPEMD160_DIGEST_LENGTH 20`
pub const RIPEMD160_DIGEST_LENGTH: c_int = 20;

/// `#define NID_commonName 13`
pub const NID_commonName: c_int = 13;
/// `#define NID_subject_alt_name 85`
pub const NID_subject_alt_name: c_int = 85;

// GENERAL_NAME.type discriminants (`openssl/x509v3.h`).
pub const GEN_OTHERNAME: c_int = 0;
pub const GEN_EMAIL: c_int = 1;
pub const GEN_DNS: c_int = 2;
pub const GEN_X400: c_int = 3;
pub const GEN_DIRNAME: c_int = 4;
pub const GEN_EDIPARTY: c_int = 5;
pub const GEN_URI: c_int = 6;
pub const GEN_IPADD: c_int = 7;
pub const GEN_RID: c_int = 8;

// ═══════════════════════════════════════════════════════════════════════════
// ASN.1 string types
// ═══════════════════════════════════════════════════════════════════════════

/// `struct asn1_string_st` — backing store for every `ASN1_*STRING` typedef.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct asn1_string_st {
    pub length: c_int,
    pub r#type: c_int,
    pub data: *mut u8,
    pub flags: c_long,
}

pub type ASN1_STRING = asn1_string_st;
pub type ASN1_OCTET_STRING = asn1_string_st;
pub type ASN1_IA5STRING = asn1_string_st;

// ═══════════════════════════════════════════════════════════════════════════
// Opaque handles
// ═══════════════════════════════════════════════════════════════════════════

opaque!(
    /// `struct engine_st` (`typedef ... ENGINE`).
    ENGINE
);
opaque!(
    /// `struct env_md_st` (`typedef ... EVP_MD`).
    EVP_MD
);
opaque!(
    /// `struct ssl_st` (`typedef ... SSL`).
    SSL
);
opaque!(
    /// `struct ssl_ctx_st` (`typedef ... SSL_CTX`).
    SSL_CTX
);
opaque!(
    /// `struct crypto_buffer_pool_st` (`typedef ... CRYPTO_BUFFER_POOL`).
    CRYPTO_BUFFER_POOL
);
opaque!(
    /// `struct x509_st` (`typedef ... X509`).
    X509
);
opaque!(
    /// `struct X509_name_st` (`typedef ... X509_NAME`).
    X509_NAME
);
opaque!(
    /// `struct X509_name_entry_st` (`typedef ... X509_NAME_ENTRY`).
    X509_NAME_ENTRY
);
opaque!(
    /// `struct X509_extension_st` (`typedef ... X509_EXTENSION`).
    X509_EXTENSION
);
opaque!(
    /// `struct v3_ext_method` (`typedef ... X509V3_EXT_METHOD`).
    X509V3_EXT_METHOD
);
opaque!(
    /// `struct asn1_object_st` (`typedef ... ASN1_OBJECT`).
    ASN1_OBJECT
);
opaque!(
    /// `struct asn1_type_st` (`typedef ... ASN1_TYPE`).
    ASN1_TYPE
);
opaque!(
    /// `struct evp_pkey_ctx_st`.
    EVP_PKEY_CTX
);
opaque!(
    /// `struct evp_md_pctx_ops` (private vtable).
    evp_md_pctx_ops
);
opaque!(
    /// `STACK_OF(X509)` — opaque stack handle.
    struct_stack_st_X509
);
opaque!(
    /// `STACK_OF(GENERAL_NAME)` — opaque stack handle.
    struct_stack_st_GENERAL_NAME
);
opaque!(
    /// `struct crypto_ex_data_st` (`typedef ... CRYPTO_EX_DATA`).
    CRYPTO_EX_DATA
);

// ═══════════════════════════════════════════════════════════════════════════
// EVP digest context (by-value layout — stored inline by callers)
// ═══════════════════════════════════════════════════════════════════════════

/// `union { uint8_t opaque[EVP_MAX_MD_DATA_SIZE]; uint64_t alignment; }`
#[repr(C)]
#[derive(Copy, Clone)]
pub union env_md_ctx_md_data {
    pub data: [u8; 240],
    pub alignment: u64,
}

/// `struct env_md_ctx_st` — laid out to match
/// `vendor/boringssl/include/openssl/digest.h` so it can live by-value on the
/// Rust side (the Zig port stores it inline, not behind `EVP_MD_CTX_new`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct EVP_MD_CTX {
    pub md_data: env_md_ctx_md_data,
    pub digest: *const EVP_MD,
    pub pctx: *mut EVP_PKEY_CTX,
    pub pctx_ops: *const evp_md_pctx_ops,
}
// SAFETY: `#[repr(C)]` POD — a byte-array union plus three raw pointers.
// All-zero is exactly the state `EVP_MD_CTX_init` writes (S021).
unsafe impl bun_core::ffi::Zeroable for EVP_MD_CTX {}

/// `struct hmac_ctx_st`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct HMAC_CTX {
    pub md: *const EVP_MD,
    pub md_ctx: EVP_MD_CTX,
    pub i_ctx: EVP_MD_CTX,
    pub o_ctx: EVP_MD_CTX,
}

// ═══════════════════════════════════════════════════════════════════════════
// SHA / RIPEMD context structs (by-value layouts)
// ═══════════════════════════════════════════════════════════════════════════

/// `struct sha_state_st`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct SHA_CTX {
    pub h: [u32; 5],
    pub Nl: u32,
    pub Nh: u32,
    pub data: [u8; 64],
    pub num: c_uint,
}

/// `struct sha256_state_st`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct SHA256_CTX {
    pub h: [u32; 8],
    pub Nl: u32,
    pub Nh: u32,
    pub data: [u8; 64],
    pub num: c_uint,
    pub md_len: c_uint,
}

/// `struct sha512_state_st`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct SHA512_CTX {
    pub h: [u64; 8],
    pub num: u16,
    pub md_len: u16,
    pub bytes_so_far_high: u32,
    pub bytes_so_far_low: u64,
    pub p: [u8; 128],
}

/// `struct RIPEMD160state_st` (`vendor/boringssl/include/openssl/ripemd.h`).
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RIPEMD160_CTX {
    pub h: [u32; 5],
    pub Nl: u32,
    pub Nh: u32,
    pub data: [u8; 64],
    pub num: c_uint,
}

// ═══════════════════════════════════════════════════════════════════════════
// X509v3 GENERAL_NAME
// ═══════════════════════════════════════════════════════════════════════════

#[repr(C)]
#[derive(Copy, Clone)]
pub struct OTHERNAME {
    pub type_id: *mut ASN1_OBJECT,
    pub value: *mut ASN1_TYPE,
}

/// Value union for `GENERAL_NAME.d` — every arm is a raw pointer so the union
/// is trivially `Copy`.
#[repr(C)]
#[derive(Copy, Clone)]
pub union GENERAL_NAME_d {
    pub ptr: *mut c_char,
    pub otherName: *mut OTHERNAME,
    pub rfc822Name: *mut ASN1_IA5STRING,
    pub dNSName: *mut ASN1_IA5STRING,
    pub x400Address: *mut ASN1_STRING,
    pub directoryName: *mut X509_NAME,
    pub ediPartyName: *mut c_void,
    pub uniformResourceIdentifier: *mut ASN1_IA5STRING,
    pub iPAddress: *mut ASN1_OCTET_STRING,
    pub registeredID: *mut ASN1_OBJECT,
    // OpenSSL convenience aliases:
    pub ip: *mut ASN1_OCTET_STRING,
    pub dirn: *mut X509_NAME,
    pub ia5: *mut ASN1_IA5STRING,
    pub rid: *mut ASN1_OBJECT,
    pub other: *mut ASN1_TYPE,
}

/// `struct GENERAL_NAME_st`.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GENERAL_NAME {
    /// One of the `GEN_*` discriminants.
    pub name_type: c_int,
    pub d: GENERAL_NAME_d,
}

// ═══════════════════════════════════════════════════════════════════════════
// OPENSSL_STACK low-level ABI (used by the typed `sk_*` inline wrappers)
// ═══════════════════════════════════════════════════════════════════════════

pub type OPENSSL_sk_free_func = Option<unsafe extern "C" fn(*mut c_void)>;
pub type OPENSSL_sk_call_free_func =
    Option<unsafe extern "C" fn(OPENSSL_sk_free_func, *mut c_void)>;
pub type OPENSSL_sk_cmp_func =
    Option<unsafe extern "C" fn(*const *const c_void, *const *const c_void) -> c_int>;

/// `struct stack_st` / `OPENSSL_STACK`.
#[repr(C)]
pub struct OPENSSL_STACK {
    pub num: usize,
    pub data: *mut *mut c_void,
    pub sorted: c_int,
    pub num_alloc: usize,
    pub comp: OPENSSL_sk_cmp_func,
}

unsafe extern "C" {
    fn sk_num(sk: *const OPENSSL_STACK) -> usize;
    fn sk_value(sk: *const OPENSSL_STACK, i: usize) -> *mut c_void;
    fn sk_free(sk: *mut OPENSSL_STACK);
    fn sk_pop_free_ex(
        sk: *mut OPENSSL_STACK,
        call_free_func: OPENSSL_sk_call_free_func,
        free_func: OPENSSL_sk_free_func,
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Extern functions
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    // ── crypto / err ──────────────────────────────────────────────────────
    // No-arg init calls — no preconditions, idempotent.
    pub safe fn CRYPTO_library_init();
    pub fn CRYPTO_memcmp(a: *const c_void, b: *const c_void, len: usize) -> c_int;
    pub fn ERR_error_string_n(packed_error: u32, buf: *mut c_char, len: usize) -> *mut c_char;
    pub safe fn ERR_load_BIO_strings();
    pub safe fn OpenSSL_add_all_algorithms();

    // ── ASN1 ──────────────────────────────────────────────────────────────
    pub fn ASN1_STRING_get0_data(str: *const ASN1_STRING) -> *const u8;
    pub fn ASN1_STRING_length(str: *const ASN1_STRING) -> c_int;

    // ── EVP digest getters (infallible, return static singletons) ────────
    pub safe fn EVP_md4() -> *const EVP_MD;
    pub safe fn EVP_md5() -> *const EVP_MD;
    pub safe fn EVP_md5_sha1() -> *const EVP_MD;
    pub safe fn EVP_ripemd160() -> *const EVP_MD;
    pub safe fn EVP_sha1() -> *const EVP_MD;
    pub safe fn EVP_sha224() -> *const EVP_MD;
    pub safe fn EVP_sha256() -> *const EVP_MD;
    pub safe fn EVP_sha384() -> *const EVP_MD;
    pub safe fn EVP_sha512() -> *const EVP_MD;
    pub safe fn EVP_sha512_224() -> *const EVP_MD;
    pub safe fn EVP_sha512_256() -> *const EVP_MD;
    pub safe fn EVP_sha3_224() -> *const EVP_MD;
    pub safe fn EVP_sha3_256() -> *const EVP_MD;
    pub safe fn EVP_sha3_384() -> *const EVP_MD;
    pub safe fn EVP_sha3_512() -> *const EVP_MD;
    pub safe fn EVP_blake2b256() -> *const EVP_MD;
    pub safe fn EVP_blake2b512() -> *const EVP_MD;

    // ── EVP digest ctx ───────────────────────────────────────────────────
    // POD context by exclusive reference: BoringSSL only zero-initialises the
    // struct (no deref of its raw-ptr fields), so any `&mut EVP_MD_CTX` is sound.
    pub safe fn EVP_MD_CTX_init(ctx: &mut EVP_MD_CTX);
    pub fn EVP_MD_CTX_cleanup(ctx: *mut EVP_MD_CTX) -> c_int;
    pub fn EVP_MD_CTX_copy_ex(out: *mut EVP_MD_CTX, in_: *const EVP_MD_CTX) -> c_int;
    pub fn EVP_MD_CTX_size(ctx: *const EVP_MD_CTX) -> usize;
    pub fn EVP_DigestInit(ctx: *mut EVP_MD_CTX, type_: *const EVP_MD) -> c_int;
    pub fn EVP_DigestInit_ex(
        ctx: *mut EVP_MD_CTX,
        type_: *const EVP_MD,
        engine: *mut ENGINE,
    ) -> c_int;
    pub fn EVP_DigestUpdate(ctx: *mut EVP_MD_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn EVP_DigestFinal(ctx: *mut EVP_MD_CTX, md_out: *mut u8, out_size: *mut c_uint) -> c_int;
    pub fn EVP_DigestFinal_ex(
        ctx: *mut EVP_MD_CTX,
        md_out: *mut u8,
        out_size: *mut c_uint,
    ) -> c_int;
    pub fn EVP_get_digestbyname(name: *const c_char) -> *const EVP_MD;
    pub fn EVP_MD_do_all_sorted(
        callback: extern "C" fn(*const EVP_MD, *const c_char, *const c_char, *mut c_void),
        arg: *mut c_void,
    );
    pub fn EVP_Digest(
        data: *const c_void,
        len: usize,
        md_out: *mut u8,
        md_out_size: *mut c_uint,
        type_: *const EVP_MD,
        impl_: *mut ENGINE,
    ) -> c_int;

    // ── HMAC ─────────────────────────────────────────────────────────────
    pub fn HMAC(
        evp_md: *const EVP_MD,
        key: *const c_void,
        key_len: usize,
        data: *const u8,
        data_len: usize,
        out: *mut u8,
        out_len: *mut c_uint,
    ) -> *mut u8;

    // ── SHA-1 ────────────────────────────────────────────────────────────
    // `*_Init` are write-only initialisers but stay `*mut`: callers feed
    // `MaybeUninit::as_mut_ptr()`, and forcing `&mut CTX` would require a
    // valid (initialised) `CTX` first — defeating the point.
    pub fn SHA1_Init(sha: *mut SHA_CTX) -> c_int;
    pub fn SHA1_Update(sha: *mut SHA_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn SHA1_Final(out: *mut u8, sha: *mut SHA_CTX) -> c_int;
    pub fn SHA1(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SHA-256 ──────────────────────────────────────────────────────────
    pub fn SHA256_Init(sha: *mut SHA256_CTX) -> c_int;
    pub fn SHA256_Update(sha: *mut SHA256_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn SHA256_Final(out: *mut u8, sha: *mut SHA256_CTX) -> c_int;
    pub fn SHA256(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SHA-384 ──────────────────────────────────────────────────────────
    pub fn SHA384_Init(sha: *mut SHA512_CTX) -> c_int;
    pub fn SHA384_Update(sha: *mut SHA512_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn SHA384_Final(out: *mut u8, sha: *mut SHA512_CTX) -> c_int;
    pub fn SHA384(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SHA-512 ──────────────────────────────────────────────────────────
    pub fn SHA512_Init(sha: *mut SHA512_CTX) -> c_int;
    pub fn SHA512_Update(sha: *mut SHA512_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn SHA512_Final(out: *mut u8, sha: *mut SHA512_CTX) -> c_int;
    pub fn SHA512(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SHA-512/256 ──────────────────────────────────────────────────────
    pub fn SHA512_256_Init(sha: *mut SHA512_CTX) -> c_int;
    pub fn SHA512_256_Update(sha: *mut SHA512_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn SHA512_256_Final(out: *mut u8, sha: *mut SHA512_CTX) -> c_int;
    pub fn SHA512_256(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── RIPEMD-160 ───────────────────────────────────────────────────────
    pub fn RIPEMD160_Init(ctx: *mut RIPEMD160_CTX) -> c_int;
    pub fn RIPEMD160_Update(ctx: *mut RIPEMD160_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn RIPEMD160_Final(out: *mut u8, ctx: *mut RIPEMD160_CTX) -> c_int;
    pub fn RIPEMD160(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SSL ──────────────────────────────────────────────────────────────
    pub safe fn SSL_library_init() -> c_int;
    pub safe fn SSL_load_error_strings();
    pub fn SSL_CTX_up_ref(ctx: *mut SSL_CTX) -> c_int;
    pub fn SSL_get_peer_cert_chain(ssl: *const SSL) -> *mut struct_stack_st_X509;

    // ── X509 ─────────────────────────────────────────────────────────────
    pub fn d2i_X509(out: *mut *mut X509, inp: *mut *const u8, len: c_long) -> *mut X509;
    pub fn i2d_X509(x: *mut X509, outp: *mut *mut u8) -> c_int;
    pub fn X509_free(x509: *mut X509);
    pub fn X509_get_subject_name(x509: *const X509) -> *mut X509_NAME;
    pub fn X509_get_ext_by_NID(x: *const X509, nid: c_int, lastpos: c_int) -> c_int;
    pub fn X509_get_ext(x: *const X509, loc: c_int) -> *mut X509_EXTENSION;
    pub fn X509_NAME_get_index_by_NID(name: *const X509_NAME, nid: c_int, lastpos: c_int) -> c_int;
    pub fn X509_NAME_get_entry(name: *const X509_NAME, loc: c_int) -> *mut X509_NAME_ENTRY;
    pub fn X509_NAME_ENTRY_get_data(entry: *const X509_NAME_ENTRY) -> *mut ASN1_STRING;
    pub fn X509V3_EXT_d2i(ext: *mut X509_EXTENSION) -> *mut c_void;
    pub fn X509V3_EXT_get(ext: *mut X509_EXTENSION) -> *const X509V3_EXT_METHOD;
    pub safe fn X509V3_EXT_get_nid(nid: c_int) -> *const X509V3_EXT_METHOD;
}

// ═══════════════════════════════════════════════════════════════════════════
// Typed STACK_OF(...) inline wrappers
//
// BoringSSL defines these as `static inline` in C, so they have no exported
// symbol — they bottom out on the untyped `sk_*` ABI above. Mirrors the
// translate-c bodies in `boringssl.zig`.
// ═══════════════════════════════════════════════════════════════════════════

/// Per-stack free callback type used by `sk_GENERAL_NAME_pop_free`
/// (matches Zig's `stack_GENERAL_NAME_free_func`).
pub type sk_GENERAL_NAME_free_func = unsafe extern "C" fn(*mut struct_stack_st_GENERAL_NAME);

#[inline]
pub unsafe fn sk_X509_value(sk: *const struct_stack_st_X509, i: usize) -> *mut X509 {
    // SAFETY: Two independent type casts, not a const→mut provenance laundering:
    //   - `sk` is reinterpreted `*const opaque -> *const OPENSSL_STACK` (const→const).
    //   - `sk_value` returns `*mut c_void` from the C heap; we narrow that to
    //     `*mut X509` (mut→mut). Mutability originates from BoringSSL's ABI
    //     (`void *sk_value(const _STACK *, size_t)`), not from `sk`.
    unsafe { sk_value(sk.cast::<OPENSSL_STACK>(), i).cast::<X509>() }
}

#[inline]
pub unsafe fn sk_GENERAL_NAME_num(sk: *const struct_stack_st_GENERAL_NAME) -> usize {
    unsafe { sk_num(sk.cast::<OPENSSL_STACK>()) }
}

#[inline]
pub unsafe fn sk_GENERAL_NAME_value(
    sk: *const struct_stack_st_GENERAL_NAME,
    i: usize,
) -> *mut GENERAL_NAME {
    // SAFETY: `sk` cast is const→const between opaque stack types; the `*mut`
    // return is narrowed from `sk_value`'s own `*mut c_void` result (C-heap
    // provenance), not derived from `sk`. No const→mut on a single value.
    unsafe { sk_value(sk.cast::<OPENSSL_STACK>(), i).cast::<GENERAL_NAME>() }
}

#[inline]
pub unsafe extern "C" fn sk_GENERAL_NAME_free(sk: *mut struct_stack_st_GENERAL_NAME) {
    unsafe { sk_free(sk.cast::<OPENSSL_STACK>()) }
}

unsafe extern "C" fn sk_GENERAL_NAME_call_free_func(
    free_func: OPENSSL_sk_free_func,
    ptr: *mut c_void,
) {
    // SAFETY: `free_func` was originally an `sk_GENERAL_NAME_free_func` erased
    // through `OPENSSL_sk_free_func` by `sk_GENERAL_NAME_pop_free` below; both
    // are `extern "C" fn(*mut _)` so the pointer round-trip is ABI-sound.
    let f: sk_GENERAL_NAME_free_func = unsafe {
        core::mem::transmute::<unsafe extern "C" fn(*mut c_void), sk_GENERAL_NAME_free_func>(
            free_func.expect("non-null free_func"),
        )
    };
    unsafe { f(ptr.cast::<struct_stack_st_GENERAL_NAME>()) }
}

#[inline]
pub unsafe fn sk_GENERAL_NAME_pop_free(
    sk: *mut struct_stack_st_GENERAL_NAME,
    free_func: sk_GENERAL_NAME_free_func,
) {
    unsafe {
        sk_pop_free_ex(
            sk.cast::<OPENSSL_STACK>(),
            Some(sk_GENERAL_NAME_call_free_func),
            Some(core::mem::transmute::<
                sk_GENERAL_NAME_free_func,
                unsafe extern "C" fn(*mut c_void),
            >(free_func)),
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SSL / TLS — error codes, verify modes, shutdown flags, renegotiate modes
// (`vendor/boringssl/include/openssl/ssl.h`)
// ═══════════════════════════════════════════════════════════════════════════

pub const SSL_ERROR_NONE: c_int = 0;
pub const SSL_ERROR_SSL: c_int = 1;
pub const SSL_ERROR_WANT_READ: c_int = 2;
pub const SSL_ERROR_WANT_WRITE: c_int = 3;
pub const SSL_ERROR_WANT_X509_LOOKUP: c_int = 4;
pub const SSL_ERROR_SYSCALL: c_int = 5;
pub const SSL_ERROR_ZERO_RETURN: c_int = 6;
pub const SSL_ERROR_WANT_CONNECT: c_int = 7;
pub const SSL_ERROR_WANT_ACCEPT: c_int = 8;
pub const SSL_ERROR_WANT_RENEGOTIATE: c_int = 19;

pub const SSL_VERIFY_NONE: c_int = 0x00;
pub const SSL_VERIFY_PEER: c_int = 0x01;
pub const SSL_VERIFY_FAIL_IF_NO_PEER_CERT: c_int = 0x02;
pub const SSL_VERIFY_PEER_IF_NO_OBC: c_int = 0x04;

pub const SSL_SENT_SHUTDOWN: c_int = 1;
pub const SSL_RECEIVED_SHUTDOWN: c_int = 2;

pub const SSL_TLSEXT_ERR_OK: c_int = 0;
pub const SSL_TLSEXT_ERR_ALERT_WARNING: c_int = 1;
pub const SSL_TLSEXT_ERR_ALERT_FATAL: c_int = 2;
pub const SSL_TLSEXT_ERR_NOACK: c_int = 3;

pub const OPENSSL_NPN_UNSUPPORTED: c_int = 0;
pub const OPENSSL_NPN_NEGOTIATED: c_int = 1;
pub const OPENSSL_NPN_NO_OVERLAP: c_int = 2;

/// `enum ssl_renegotiate_mode_t` — passed to `SSL_set_renegotiate_mode`.
pub type ssl_renegotiate_mode_t = c_uint;
pub const ssl_renegotiate_never: ssl_renegotiate_mode_t = 0;
pub const ssl_renegotiate_once: ssl_renegotiate_mode_t = 1;
pub const ssl_renegotiate_freely: ssl_renegotiate_mode_t = 2;
pub const ssl_renegotiate_ignore: ssl_renegotiate_mode_t = 3;
pub const ssl_renegotiate_explicit: ssl_renegotiate_mode_t = 4;

/// `SSL_OP_LEGACY_SERVER_CONNECT` — BoringSSL defines this as 0 (no-op flag);
/// kept so callers can mirror the OpenSSL clear/set dance verbatim.
pub const SSL_OP_LEGACY_SERVER_CONNECT: u32 = 0;

/// `#define RSA_PKCS1_OAEP_PADDING 4` (`openssl/rsa.h`).
pub const RSA_PKCS1_OAEP_PADDING: c_int = 4;

// ═══════════════════════════════════════════════════════════════════════════
// BIO — opaque-ish handle + method vtable
// (`vendor/boringssl/include/openssl/bio.h`)
// ═══════════════════════════════════════════════════════════════════════════

/// `CRYPTO_refcount_t` (`openssl/thread.h`) — atomic-ish u32 in BoringSSL.
pub type CRYPTO_refcount_t = u32;

/// `ossl_ssize_t` — signed counterpart of `size_t` for BoringSSL "length or -1"
/// parameters. Mirrors the `isize` definition in `boringssl.zig`.
pub type ossl_ssize_t = isize;

/// `bio_info_cb` — callback type for `BIO_METHOD.callback_ctrl`.
pub type bio_info_cb =
    Option<unsafe extern "C" fn(*mut BIO, c_int, *const c_char, c_int, c_long, c_long) -> c_long>;

/// `struct bio_method_st` — vtable for a BIO implementation. Laid out by-value
/// so callers can construct custom BIO methods on the Rust side.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BIO_METHOD {
    pub r#type: c_int,
    pub name: *const c_char,
    pub bwrite: Option<unsafe extern "C" fn(*mut BIO, *const c_char, c_int) -> c_int>,
    pub bread: Option<unsafe extern "C" fn(*mut BIO, *mut c_char, c_int) -> c_int>,
    pub bputs: Option<unsafe extern "C" fn(*mut BIO, *const c_char) -> c_int>,
    pub bgets: Option<unsafe extern "C" fn(*mut BIO, *mut c_char, c_int) -> c_int>,
    pub ctrl: Option<unsafe extern "C" fn(*mut BIO, c_int, c_long, *mut c_void) -> c_long>,
    pub create: Option<unsafe extern "C" fn(*mut BIO) -> c_int>,
    pub destroy: Option<unsafe extern "C" fn(*mut BIO) -> c_int>,
    pub callback_ctrl: Option<unsafe extern "C" fn(*mut BIO, c_int, bio_info_cb) -> c_long>,
}

/// `struct bio_st` — exposed by-value because the Zig side reaches into
/// `flags`/`num`/`ptr` directly when implementing custom BIO backends.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct BIO {
    pub method: *const BIO_METHOD,
    pub init: c_int,
    pub shutdown: c_int,
    pub flags: c_int,
    pub retry_reason: c_int,
    pub num: c_int,
    pub references: CRYPTO_refcount_t,
    pub ptr: *mut c_void,
    pub next_bio: *mut BIO,
    pub num_read: usize,
    pub num_write: usize,
}

// ═══════════════════════════════════════════════════════════════════════════
// Additional opaque handles
// ═══════════════════════════════════════════════════════════════════════════

opaque!(
    /// `struct ssl_method_st` (`typedef ... SSL_METHOD`).
    SSL_METHOD
);
opaque!(
    /// `struct x509_store_st` (`typedef ... X509_STORE`).
    X509_STORE
);
opaque!(
    /// `struct x509_store_ctx_st` (`typedef ... X509_STORE_CTX`).
    X509_STORE_CTX
);
opaque!(
    /// `struct rsa_st` (`typedef ... RSA`).
    RSA
);

/// `int (*SSL_verify_cb)(int preverify_ok, X509_STORE_CTX *ctx)` — verify
/// callback type for `SSL_set_verify` / `SSL_CTX_set_verify`.
pub type SSL_verify_cb = Option<unsafe extern "C" fn(c_int, *mut X509_STORE_CTX) -> c_int>;

/// `int pem_password_cb(char *buf, int size, int rwflag, void *userdata)`.
pub type pem_password_cb = unsafe extern "C" fn(*mut c_char, c_int, c_int, *mut c_void) -> c_int;

// ═══════════════════════════════════════════════════════════════════════════
// Extern functions — SSL / BIO / ERR / HMAC / RSA / PBKDF2
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    // ── SSL_METHOD ───────────────────────────────────────────────────────
    pub safe fn TLS_with_buffers_method() -> *const SSL_METHOD;

    // ── ENGINE ───────────────────────────────────────────────────────────
    pub safe fn ENGINE_new() -> *mut ENGINE;
    pub fn ENGINE_free(engine: *mut ENGINE) -> c_int;

    // ── SSL_CTX ──────────────────────────────────────────────────────────
    pub fn SSL_CTX_new(method: *const SSL_METHOD) -> *mut SSL_CTX;
    pub fn SSL_CTX_free(ctx: *mut SSL_CTX);
    pub fn SSL_CTX_get_verify_mode(ctx: *const SSL_CTX) -> c_int;
    pub fn SSL_CTX_set_ex_data(ctx: *mut SSL_CTX, idx: c_int, data: *mut c_void) -> c_int;
    pub fn SSL_CTX_get_ex_data(ctx: *const SSL_CTX, idx: c_int) -> *mut c_void;
    pub fn SSL_CTX_set0_buffer_pool(ctx: *mut SSL_CTX, pool: *mut CRYPTO_BUFFER_POOL);
    pub fn SSL_CTX_set_cipher_list(ctx: *mut SSL_CTX, str_: *const c_char) -> c_int;

    // ── CRYPTO_BUFFER_POOL ───────────────────────────────────────────────
    pub fn CRYPTO_BUFFER_POOL_new() -> *mut CRYPTO_BUFFER_POOL;

    // ── SSL ──────────────────────────────────────────────────────────────
    pub fn SSL_new(ctx: *mut SSL_CTX) -> *mut SSL;
    pub fn SSL_free(ssl: *mut SSL);
    pub fn SSL_set_connect_state(ssl: *mut SSL);
    pub fn SSL_set_accept_state(ssl: *mut SSL);
    pub fn SSL_set_bio(ssl: *mut SSL, rbio: *mut BIO, wbio: *mut BIO);
    pub fn SSL_get_rbio(ssl: *const SSL) -> *mut BIO;
    pub fn SSL_get_wbio(ssl: *const SSL) -> *mut BIO;
    pub fn SSL_do_handshake(ssl: *mut SSL) -> c_int;
    pub fn SSL_read(ssl: *mut SSL, buf: *mut c_void, num: c_int) -> c_int;
    pub fn SSL_write(ssl: *mut SSL, buf: *const c_void, num: c_int) -> c_int;
    pub fn SSL_shutdown(ssl: *mut SSL) -> c_int;
    pub fn SSL_get_error(ssl: *const SSL, ret_code: c_int) -> c_int;
    pub fn SSL_get_shutdown(ssl: *const SSL) -> c_int;
    pub fn SSL_is_init_finished(ssl: *const SSL) -> c_int;
    pub fn SSL_set_verify(ssl: *mut SSL, mode: c_int, callback: SSL_verify_cb);
    pub fn SSL_set0_verify_cert_store(ssl: *mut SSL, store: *mut X509_STORE) -> c_int;
    pub fn SSL_set_renegotiate_mode(ssl: *mut SSL, mode: ssl_renegotiate_mode_t);
    pub fn SSL_renegotiate(ssl: *mut SSL) -> c_int;
    pub fn SSL_get_servername(ssl: *const SSL, ty: c_int) -> *const c_char;
    pub fn SSL_get_SSL_CTX(ssl: *const SSL) -> *mut SSL_CTX;
    pub fn SSL_get_ex_data(ssl: *const SSL, idx: c_int) -> *mut c_void;
    pub fn SSL_set_ex_data(ssl: *mut SSL, idx: c_int, data: *mut c_void) -> c_int;
    pub fn SSL_set_tlsext_host_name(ssl: *mut SSL, name: *const c_char) -> c_int;
    pub fn SSL_set_alpn_protos(ssl: *mut SSL, protos: *const u8, protos_len: usize) -> c_int;
    pub fn SSL_get0_alpn_selected(ssl: *const SSL, out_data: *mut *const u8, out_len: *mut c_uint);
    pub fn SSL_set_options(ssl: *mut SSL, options: u32) -> u32;
    pub fn SSL_clear_options(ssl: *mut SSL, options: u32) -> u32;
    pub fn SSL_enable_signed_cert_timestamps(ssl: *mut SSL);
    pub fn SSL_enable_ocsp_stapling(ssl: *mut SSL);
    pub fn SSL_select_next_proto(
        out: *mut *mut u8,
        out_len: *mut u8,
        peer: *const u8,
        peer_len: c_uint,
        supported: *const u8,
        supported_len: c_uint,
    ) -> c_int;
    pub fn SSL_CTX_set_alpn_select_cb(
        ctx: *mut SSL_CTX,
        cb: Option<
            unsafe extern "C" fn(
                ssl: *mut SSL,
                out: *mut *const u8,
                out_len: *mut u8,
                in_: *const u8,
                in_len: c_uint,
                arg: *mut c_void,
            ) -> c_int,
        >,
        arg: *mut c_void,
    );

    // ── BIO ──────────────────────────────────────────────────────────────
    pub fn BIO_new(method: *const BIO_METHOD) -> *mut BIO;
    pub fn BIO_free(bio: *mut BIO) -> c_int;
    pub fn BIO_read(bio: *mut BIO, data: *mut c_void, len: c_int) -> c_int;
    pub fn BIO_write(bio: *mut BIO, data: *const c_void, len: c_int) -> c_int;
    pub fn BIO_ctrl(bio: *mut BIO, cmd: c_int, larg: c_long, parg: *mut c_void) -> c_long;
    pub fn BIO_ctrl_pending(bio: *const BIO) -> usize;
    pub safe fn BIO_s_mem() -> *const BIO_METHOD;
    pub fn BIO_new_mem_buf(buf: *const c_void, len: ossl_ssize_t) -> *mut BIO;
    pub fn BIO_set_mem_eof_return(bio: *mut BIO, eof_value: c_int) -> c_int;

    // ── ERR ──────────────────────────────────────────────────────────────
    // Thread-local error queue — no pointer args, no preconditions.
    pub safe fn ERR_clear_error();
    pub safe fn ERR_get_error() -> u32;
    pub safe fn ERR_peek_error() -> u32;
    pub safe fn ERR_peek_last_error() -> u32;
    pub fn ERR_error_string(packed_error: u32, buf: *mut c_char) -> *mut c_char;
    // `ERR_error_string_n` declared once in the crypto/err block above.
    /// Returns a static NUL-terminated string, or NULL if unknown.
    pub safe fn ERR_lib_error_string(packed_error: u32) -> *const c_char;
    /// Returns a static NUL-terminated string, or NULL if unknown.
    pub safe fn ERR_func_error_string(packed_error: u32) -> *const c_char;
    /// Returns a static NUL-terminated string, or NULL if unknown.
    pub safe fn ERR_reason_error_string(packed_error: u32) -> *const c_char;
    pub safe fn ERR_load_ERR_strings();
    pub safe fn ERR_load_crypto_strings();

    // ── HMAC (streaming) ─────────────────────────────────────────────────
    pub fn HMAC_CTX_init(ctx: *mut HMAC_CTX);
    pub fn HMAC_CTX_cleanup(ctx: *mut HMAC_CTX);
    pub fn HMAC_CTX_copy(dest: *mut HMAC_CTX, src: *const HMAC_CTX) -> c_int;
    pub fn HMAC_Init_ex(
        ctx: *mut HMAC_CTX,
        key: *const c_void,
        key_len: usize,
        md: *const EVP_MD,
        impl_: *mut ENGINE,
    ) -> c_int;
    pub fn HMAC_Update(ctx: *mut HMAC_CTX, data: *const u8, data_len: usize) -> c_int;
    pub fn HMAC_Final(ctx: *mut HMAC_CTX, out: *mut u8, out_len: *mut c_uint) -> c_int;
    pub fn HMAC_size(ctx: *const HMAC_CTX) -> usize;

    // ── scrypt ───────────────────────────────────────────────────────────
    pub fn EVP_PBE_validate_scrypt_params(
        password: *const u8,
        password_len: usize,
        salt: *const u8,
        salt_len: usize,
        N: u64,
        r: u64,
        p: u64,
        max_mem: usize,
        out_key: *mut u8,
        key_len: usize,
    ) -> c_int;
    pub fn EVP_PBE_scrypt(
        password: *const u8,
        password_len: usize,
        salt: *const u8,
        salt_len: usize,
        N: u64,
        r: u64,
        p: u64,
        max_mem: usize,
        out_key: *mut u8,
        key_len: usize,
    ) -> c_int;

    // ── PBKDF2 ───────────────────────────────────────────────────────────
    pub fn PKCS5_PBKDF2_HMAC(
        password: *const u8,
        password_len: usize,
        salt: *const u8,
        salt_len: usize,
        iterations: c_uint,
        digest: *const EVP_MD,
        key_len: usize,
        out_key: *mut u8,
    ) -> c_int;

    // ── RSA / PEM ────────────────────────────────────────────────────────
    pub fn RSA_free(rsa: *mut RSA);
    pub fn RSA_size(rsa: *const RSA) -> c_uint;
    pub fn RSA_public_encrypt(
        flen: usize,
        from: *const u8,
        to: *mut u8,
        rsa: *mut RSA,
        padding: c_int,
    ) -> c_int;
    pub fn PEM_read_bio_RSA_PUBKEY(
        bp: *mut BIO,
        x: *mut *mut RSA,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut RSA;
}
