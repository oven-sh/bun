//! Hand-rolled BoringSSL FFI surface.
//!
//! Ground truth: `src/boringssl_sys/boringssl.zig` (translate-c output) and
//! `vendor/boringssl/include/openssl/*.h`. This file exposes only the subset
//! of symbols Bun's Rust crates actually consume — it is **not** a full
//! bindgen dump. When the bindgen pipeline lands this module is replaced
//! wholesale.
//
// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/boringssl_sys/boringssl.zig (19306 lines)
//   confidence: high
//   todos:      0
//   notes:      hand-curated subset (93 symbols) pending bindgen regeneration
// ──────────────────────────────────────────────────────────────────────────

use core::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_void};
use core::marker::{PhantomData, PhantomPinned};

// ═══════════════════════════════════════════════════════════════════════════
// Opaque-type helper
// ═══════════════════════════════════════════════════════════════════════════

macro_rules! opaque {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[repr(C)]
        pub struct $name {
            _p: [u8; 0],
            _m: PhantomData<(*mut u8, PhantomPinned)>,
        }
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
    pub fn CRYPTO_library_init();
    pub fn CRYPTO_memcmp(a: *const c_void, b: *const c_void, len: usize) -> c_int;
    pub fn ERR_error_string_n(packed_error: u32, buf: *mut c_char, len: usize) -> *mut c_char;
    pub fn ERR_load_BIO_strings();
    pub fn OpenSSL_add_all_algorithms();

    // ── ASN1 ──────────────────────────────────────────────────────────────
    pub fn ASN1_STRING_get0_data(str: *const ASN1_STRING) -> *const u8;
    pub fn ASN1_STRING_length(str: *const ASN1_STRING) -> c_int;

    // ── EVP digest getters (infallible, return static singletons) ────────
    pub fn EVP_md4() -> *const EVP_MD;
    pub fn EVP_md5() -> *const EVP_MD;
    pub fn EVP_md5_sha1() -> *const EVP_MD;
    pub fn EVP_ripemd160() -> *const EVP_MD;
    pub fn EVP_sha1() -> *const EVP_MD;
    pub fn EVP_sha224() -> *const EVP_MD;
    pub fn EVP_sha256() -> *const EVP_MD;
    pub fn EVP_sha384() -> *const EVP_MD;
    pub fn EVP_sha512() -> *const EVP_MD;
    pub fn EVP_sha512_224() -> *const EVP_MD;
    pub fn EVP_sha512_256() -> *const EVP_MD;
    pub fn EVP_sha3_224() -> *const EVP_MD;
    pub fn EVP_sha3_256() -> *const EVP_MD;
    pub fn EVP_sha3_384() -> *const EVP_MD;
    pub fn EVP_sha3_512() -> *const EVP_MD;
    pub fn EVP_blake2b256() -> *const EVP_MD;
    pub fn EVP_blake2b512() -> *const EVP_MD;

    // ── EVP digest ctx ───────────────────────────────────────────────────
    pub fn EVP_MD_CTX_init(ctx: *mut EVP_MD_CTX);
    pub fn EVP_MD_CTX_cleanup(ctx: *mut EVP_MD_CTX) -> c_int;
    pub fn EVP_DigestInit(ctx: *mut EVP_MD_CTX, type_: *const EVP_MD) -> c_int;
    pub fn EVP_DigestUpdate(ctx: *mut EVP_MD_CTX, data: *const c_void, len: usize) -> c_int;
    pub fn EVP_DigestFinal(ctx: *mut EVP_MD_CTX, md_out: *mut u8, out_size: *mut c_uint) -> c_int;
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
    pub fn SSL_library_init() -> c_int;
    pub fn SSL_load_error_strings();
    pub fn SSL_CTX_up_ref(ctx: *mut SSL_CTX) -> c_int;
    pub fn SSL_get_peer_cert_chain(ssl: *const SSL) -> *mut struct_stack_st_X509;

    // ── X509 ─────────────────────────────────────────────────────────────
    pub fn X509_get_subject_name(x509: *const X509) -> *mut X509_NAME;
    pub fn X509_get_ext_by_NID(x: *const X509, nid: c_int, lastpos: c_int) -> c_int;
    pub fn X509_get_ext(x: *const X509, loc: c_int) -> *mut X509_EXTENSION;
    pub fn X509_NAME_get_index_by_NID(name: *const X509_NAME, nid: c_int, lastpos: c_int) -> c_int;
    pub fn X509_NAME_get_entry(name: *const X509_NAME, loc: c_int) -> *mut X509_NAME_ENTRY;
    pub fn X509_NAME_ENTRY_get_data(entry: *const X509_NAME_ENTRY) -> *mut ASN1_STRING;
    pub fn X509V3_EXT_d2i(ext: *mut X509_EXTENSION) -> *mut c_void;
    pub fn X509V3_EXT_get(ext: *mut X509_EXTENSION) -> *const X509V3_EXT_METHOD;
    pub fn X509V3_EXT_get_nid(nid: c_int) -> *const X509V3_EXT_METHOD;
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
    unsafe { sk_value(sk as *const OPENSSL_STACK, i) as *mut X509 }
}

#[inline]
pub unsafe fn sk_GENERAL_NAME_num(sk: *const struct_stack_st_GENERAL_NAME) -> usize {
    unsafe { sk_num(sk as *const OPENSSL_STACK) }
}

#[inline]
pub unsafe fn sk_GENERAL_NAME_value(
    sk: *const struct_stack_st_GENERAL_NAME,
    i: usize,
) -> *mut GENERAL_NAME {
    unsafe { sk_value(sk as *const OPENSSL_STACK, i) as *mut GENERAL_NAME }
}

#[inline]
pub unsafe extern "C" fn sk_GENERAL_NAME_free(sk: *mut struct_stack_st_GENERAL_NAME) {
    unsafe { sk_free(sk as *mut OPENSSL_STACK) }
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
    unsafe { f(ptr as *mut struct_stack_st_GENERAL_NAME) }
}

#[inline]
pub unsafe fn sk_GENERAL_NAME_pop_free(
    sk: *mut struct_stack_st_GENERAL_NAME,
    free_func: sk_GENERAL_NAME_free_func,
) {
    unsafe {
        sk_pop_free_ex(
            sk as *mut OPENSSL_STACK,
            Some(sk_GENERAL_NAME_call_free_func),
            Some(core::mem::transmute::<
                sk_GENERAL_NAME_free_func,
                unsafe extern "C" fn(*mut c_void),
            >(free_func)),
        )
    }
}
