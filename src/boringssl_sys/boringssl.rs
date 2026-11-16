//! Hand-rolled BoringSSL FFI surface.
//!
//! Ground truth: `vendor/boringssl/include/openssl/*.h`. This file exposes
//! only the subset of symbols Bun's Rust crates actually consume — it is
//! **not** a full bindgen dump. When the bindgen pipeline lands this module
//! is replaced wholesale.

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_long, c_uint, c_ulong, c_void};
use core::mem::MaybeUninit;
use core::ptr::null_mut;

use bun_core::vec::BorrowedCursor;
use bun_core::{BoundedArray, CStrRef};

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/// `#define EVP_MAX_MD_SIZE 64` — SHA-512 is the longest digest.
pub const EVP_MAX_MD_SIZE: c_int = 64;

const SHA_DIGEST_LENGTH: usize = 20;
const SHA256_DIGEST_LENGTH: usize = 32;

pub(crate) const NID_undef: c_int = 0;
pub(crate) const NID_md5: c_int = 4;
/// `#define NID_commonName 13`
pub(crate) const NID_commonName: c_int = 13;
pub(crate) const NID_sha1: c_int = 64;
/// `#define NID_subject_alt_name 85`
pub(crate) const NID_subject_alt_name: c_int = 85;
pub const NID_X9_62_prime256v1: c_int = 415;
pub const NID_secp384r1: c_int = 715;
pub const NID_secp521r1: c_int = 716;
pub(crate) const NID_rsassaPss: c_int = 912;
pub const NID_X25519: c_int = 948;
pub const NID_kx_ecdhe: c_int = 952;

pub(crate) const V_ASN1_SEQUENCE: c_int = 16;

pub(crate) const GEN_DNS: c_int = 2;
pub(crate) const GEN_URI: c_int = 6;
pub(crate) const GEN_IPADD: c_int = 7;

// ═══════════════════════════════════════════════════════════════════════════
// ASN.1 string types
// ═══════════════════════════════════════════════════════════════════════════

/// `struct asn1_string_st` — backing store for every `ASN1_*STRING` typedef.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct asn1_string_st {
    pub(crate) length: c_int,
    pub r#type: c_int,
    pub(crate) data: *mut u8,
    pub flags: c_long,
}

pub(crate) type ASN1_STRING = asn1_string_st;
pub type ASN1_OCTET_STRING = asn1_string_st;
pub(crate) type ASN1_IA5STRING = asn1_string_st;

/// `struct rsa_pss_params_st` (`typedef ... RSA_PSS_PARAMS`): RFC 4055 RSASSA-PSS-params.
#[repr(C)]
pub struct RSA_PSS_PARAMS {
    pub hashAlgorithm: *mut X509_ALGOR,
    pub maskGenAlgorithm: *mut X509_ALGOR,
    pub saltLength: *mut asn1_string_st,
    pub trailerField: *mut asn1_string_st,
    pub maskHash: *mut X509_ALGOR,
}

// ═══════════════════════════════════════════════════════════════════════════
// Opaque handles
// ═══════════════════════════════════════════════════════════════════════════

bun_opaque::sealed_handle! {
    /// `struct engine_st` (`typedef ... ENGINE`).
    pub struct ENGINE;
    /// `struct env_md_st` (`typedef ... EVP_MD`).
    pub struct EVP_MD;
    /// `struct ssl_st` (`typedef ... SSL`).
    pub struct SSL;
    /// `struct ssl_ctx_st` (`typedef ... SSL_CTX`).
    pub struct SSL_CTX;
    /// `struct ssl_cipher_st` (`typedef ... SSL_CIPHER`).
    pub struct SSL_CIPHER;
    /// `struct crypto_buffer_pool_st` (`typedef ... CRYPTO_BUFFER_POOL`).
    pub struct CRYPTO_BUFFER_POOL;
    /// `struct crypto_buffer_st` (`typedef ... CRYPTO_BUFFER`).
    pub struct CRYPTO_BUFFER;
    /// `struct x509_lazy_cert_set_st` (`typedef ... X509_LAZY_CERT_SET`, oven-sh/boringssl).
    pub struct X509_LAZY_CERT_SET;
    /// `struct x509_st` (`typedef ... X509`).
    pub struct X509;
    /// `struct X509_name_st` (`typedef ... X509_NAME`).
    pub struct X509_NAME;
    /// `struct X509_name_entry_st` (`typedef ... X509_NAME_ENTRY`).
    pub struct X509_NAME_ENTRY;
    /// `struct X509_extension_st` (`typedef ... X509_EXTENSION`).
    pub struct X509_EXTENSION;
    /// `struct v3_ext_method` (`typedef ... X509V3_EXT_METHOD`).
    pub struct X509V3_EXT_METHOD;
    /// `struct asn1_object_st` (`typedef ... ASN1_OBJECT`).
    pub struct ASN1_OBJECT;
    /// `struct asn1_type_st` (`typedef ... ASN1_TYPE`).
    pub struct ASN1_TYPE;
    /// `struct X509_algor_st` (`typedef ... X509_ALGOR`).
    pub struct X509_ALGOR;
    /// `struct evp_pkey_ctx_st`.
    pub struct EVP_PKEY_CTX;
    /// `struct evp_md_pctx_ops` (private vtable).
    pub struct evp_md_pctx_ops;
    /// `STACK_OF(X509)` — opaque stack handle.
    pub struct struct_stack_st_X509;
    /// `STACK_OF(GENERAL_NAME)` — opaque stack handle.
    pub struct struct_stack_st_GENERAL_NAME;
    /// `struct crypto_ex_data_st` (`typedef ... CRYPTO_EX_DATA`).
    pub struct CRYPTO_EX_DATA;
}

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
/// Rust side (stored inline, not behind `EVP_MD_CTX_new`).
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

// SAFETY: BoringSSL's `EVP_MD`s are immutable statics.
unsafe impl Sync for EVP_MD {}

impl EVP_MD {
    pub fn by_name(name: &CStr) -> Option<&'static EVP_MD> {
        // SAFETY: BoringSSL only reads `name`.
        unsafe { EVP_get_digestbyname(name.as_ptr()) }
    }

    pub fn size(&self) -> usize {
        EVP_MD_size(self)
    }

    /// Writes the digest to the start of `out` and returns its length. Panics if `out` is shorter than [`Self::size`].
    pub fn digest(&self, data: &[u8], out: &mut [u8]) -> Option<usize> {
        let out = &mut out[..self.size()];
        // SAFETY: `out` is as long as the digest. The size and the `ENGINE` are nullable.
        let rc = unsafe {
            EVP_Digest(
                data.as_ptr().cast(),
                data.len(),
                out.as_mut_ptr(),
                null_mut(),
                self,
                null_mut(),
            )
        };
        (rc == 1).then_some(out.len())
    }

    /// Fills `out` with the derived key.
    pub fn pbkdf2_hmac(
        &self,
        password: &[u8],
        salt: &[u8],
        iterations: u32,
        out: &mut [u8],
    ) -> bool {
        // SAFETY: each pointer is valid for the length passed with it.
        let rc = unsafe {
            PKCS5_PBKDF2_HMAC(
                password.as_ptr(),
                password.len(),
                salt.as_ptr(),
                salt.len(),
                iterations,
                self,
                out.len(),
                out.as_mut_ptr(),
            )
        };
        rc > 0
    }
}

/// An initialized `EVP_MD_CTX`: its `digest` is not null.
pub struct OwnedEvpMdCtx(EVP_MD_CTX);

impl OwnedEvpMdCtx {
    pub fn new(md: &'static EVP_MD) -> Self {
        let mut ctx = Self(bun_core::ffi::zeroed());
        // SAFETY: the context keeps `md`, a static. The state is inline, so this cannot fail.
        unsafe { EVP_DigestInit(&raw mut ctx.0, md) };
        ctx
    }

    pub fn md(&self) -> &'static EVP_MD {
        // SAFETY: `digest` is the static that `new` was given.
        unsafe { &*self.0.digest }
    }

    pub fn update(&mut self, data: &[u8]) {
        // SAFETY: the context is initialized; BoringSSL reads `data.len()` bytes.
        unsafe { EVP_DigestUpdate(&raw mut self.0, data.as_ptr().cast(), data.len()) };
    }

    /// Writes the digest to the start of `out`, returns it and starts a new one. Panics if `out` is too short.
    pub fn final_and_init<'a>(&mut self, out: &'a mut [u8]) -> &'a mut [u8] {
        let md = self.md();
        let out = &mut out[..md.size()];
        // SAFETY: the context is initialized, and `out` is as long as the digest. Then as in `new`.
        unsafe {
            EVP_DigestFinal_ex(&raw mut self.0, out.as_mut_ptr(), null_mut());
            EVP_DigestInit(&raw mut self.0, md);
        }
        out
    }

    pub fn try_clone(&self) -> Option<Self> {
        let mut copy = Self(bun_core::ffi::zeroed());
        // SAFETY: all-zero is what `EVP_MD_CTX_init` writes. `copy` is returned only if the call succeeded.
        let rc = unsafe { EVP_MD_CTX_copy_ex(&raw mut copy.0, &raw const self.0) };
        (rc == 1).then_some(copy)
    }
}

impl Drop for OwnedEvpMdCtx {
    fn drop(&mut self) {
        // SAFETY: the context is initialized or all-zero.
        unsafe { EVP_MD_CTX_cleanup(&raw mut self.0) };
    }
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
bun_core::impl_zeroable!(SHA_CTX, SHA256_CTX);

/// API that OpenSSL 3 deprecated
pub mod hashers {
    use super::{SHA_DIGEST_LENGTH, SHA256_DIGEST_LENGTH};

    macro_rules! new_hasher {
        ($name:ident, $digest_size:expr, $ctx:ident, $init:ident, $update:ident, $final_:ident) => {
            pub struct $name {
                hasher: super::$ctx,
            }

            impl $name {
                pub const DIGEST: usize = $digest_size;

                pub fn init() -> Self {
                    let mut this = Self {
                        hasher: bun_core::ffi::zeroed(),
                    };
                    // SAFETY: *_Init only writes to the context.
                    let rc = unsafe { super::$init(&raw mut this.hasher) };
                    debug_assert!(rc == 1);
                    this
                }

                pub fn hash(bytes: &[u8], out: &mut [u8; $digest_size]) {
                    // SAFETY: reads `bytes.len()` bytes and writes DIGEST bytes.
                    unsafe { super::$name(bytes.as_ptr(), bytes.len(), out.as_mut_ptr()) };
                }

                pub fn update(&mut self, data: &[u8]) {
                    // SAFETY: `init()` initialised the context; reads `data.len()` bytes.
                    let rc = unsafe {
                        super::$update(&raw mut self.hasher, data.as_ptr().cast(), data.len())
                    };
                    debug_assert!(rc == 1);
                }

                pub fn r#final(&mut self, out: &mut [u8; $digest_size]) {
                    // SAFETY: `init()` initialised the context; writes DIGEST bytes.
                    let rc = unsafe { super::$final_(out.as_mut_ptr(), &raw mut self.hasher) };
                    debug_assert!(rc == 1);
                }
            }
        };
    }

    new_hasher!(
        SHA1,
        SHA_DIGEST_LENGTH,
        SHA_CTX,
        SHA1_Init,
        SHA1_Update,
        SHA1_Final
    );
    new_hasher!(
        SHA256,
        SHA256_DIGEST_LENGTH,
        SHA256_CTX,
        SHA256_Init,
        SHA256_Update,
        SHA256_Final
    );
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
    pub(crate) dNSName: *mut ASN1_IA5STRING,
    pub x400Address: *mut ASN1_STRING,
    pub directoryName: *mut X509_NAME,
    pub ediPartyName: *mut c_void,
    pub(crate) uniformResourceIdentifier: *mut ASN1_IA5STRING,
    pub iPAddress: *mut ASN1_OCTET_STRING,
    pub registeredID: *mut ASN1_OBJECT,
    // OpenSSL convenience aliases:
    pub(crate) ip: *mut ASN1_OCTET_STRING,
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
    pub(crate) name_type: c_int,
    pub(crate) d: GENERAL_NAME_d,
}

// ═══════════════════════════════════════════════════════════════════════════
// OPENSSL_STACK low-level ABI (used by the typed `sk_*` inline wrappers)
// ═══════════════════════════════════════════════════════════════════════════

type OPENSSL_sk_free_func = Option<unsafe extern "C" fn(*mut c_void)>;
type OPENSSL_sk_call_free_func = Option<unsafe extern "C" fn(OPENSSL_sk_free_func, *mut c_void)>;
pub(crate) type OPENSSL_sk_cmp_func =
    Option<unsafe extern "C" fn(*const *const c_void, *const *const c_void) -> c_int>;

/// `struct stack_st` / `OPENSSL_STACK`.
#[repr(C)]
struct OPENSSL_STACK {
    pub num: usize,
    pub data: *mut *mut c_void,
    pub sorted: c_int,
    pub num_alloc: usize,
    pub comp: OPENSSL_sk_cmp_func,
}

unsafe extern "C" {
    fn GENERAL_NAME_free(name: *mut GENERAL_NAME);
}

// SAFETY: made from a pointer that already carries a +1 (`SSL_CTX_new`, `SSL_CTX_up_ref`).
bun_opaque::owned_handle! {
    /// Owns one `SSL_CTX` reference; `SSL_CTX_free`s it on drop.
    pub struct OwnedSslCtx(SSL_CTX) => unsafe SSL_CTX_free;
}

impl OwnedSslCtx {
    /// Takes the +1 `raw` carries; `None` when `raw` is null.
    ///
    /// # Safety
    /// `raw` must be null or carry a reference the caller is giving up.
    pub unsafe fn from_raw(raw: *mut SSL_CTX) -> Option<Self> {
        core::ptr::NonNull::new(raw).map(Self)
    }

    pub fn as_ptr(&self) -> *mut SSL_CTX {
        self.0.as_ptr()
    }

    /// Transfers the reference back out; the caller must free it.
    pub fn into_raw(self) -> *mut SSL_CTX {
        core::mem::ManuallyDrop::new(self).0.as_ptr()
    }
}

impl Clone for OwnedSslCtx {
    /// Another reference to the same `SSL_CTX` (`SSL_CTX_up_ref`).
    fn clone(&self) -> Self {
        // SAFETY: `self.0` is a live SSL_CTX.
        unsafe { SSL_CTX_up_ref(self.0.as_ptr()) };
        Self(self.0)
    }
}

// SAFETY: each is made from one reference that BoringSSL handed over.
bun_opaque::owned_handle! {
    pub struct OwnedSslSession(SSL_SESSION) => unsafe SSL_SESSION_free;
    pub struct OwnedX509(X509) => unsafe X509_free;
    pub struct OwnedX509Crl(X509_CRL) => unsafe X509_CRL_free;
    pub struct OwnedX509Store(X509_STORE) => unsafe X509_STORE_free;
    pub struct OwnedEvpPkey(EVP_PKEY) => unsafe EVP_PKEY_free;
    pub struct OwnedRsa(RSA) => unsafe RSA_free;
}

impl SSL_CTX {
    /// `SSL_VERIFY_*` bits.
    pub fn verify_mode(&self) -> c_int {
        // SAFETY: `self` is a live SSL_CTX.
        unsafe { SSL_CTX_get_verify_mode(self) }
    }

    /// Retained, because `us_ssl_ctx_add_ca_cert` can replace the store.
    pub fn cert_store(&self) -> Option<OwnedX509Store> {
        // SAFETY: the context holds a reference to its store, and `X509_STORE_up_ref` takes the one returned.
        unsafe {
            let store = core::ptr::NonNull::new(SSL_CTX_get_cert_store(self))?;
            X509_STORE_up_ref(store.as_ptr());
            Some(OwnedX509Store(store))
        }
    }

    pub fn set_session_id_context(&self, id: &[u8; SSL_MAX_SID_CTX_LENGTH]) {
        // SAFETY: BoringSSL copies `id`.
        unsafe { SSL_CTX_set_session_id_context(self, id.as_ptr(), id.len()) };
    }
}

impl SSL_SESSION {
    pub fn to_der(&self) -> Option<OpensslBytes> {
        let mut der: *mut u8 = null_mut();
        // SAFETY: given null, `i2d_SSL_SESSION` allocates `len` bytes or leaves it null.
        unsafe {
            let len = i2d_SSL_SESSION(self, &raw mut der);
            OpensslBytes::from_raw(der, len as usize)
        }
    }

    pub fn ticket(&self) -> &[u8] {
        let (mut ticket, mut len) = (core::ptr::null(), 0);
        // SAFETY: the session owns `len` bytes at `ticket`, which is null only if there are none.
        // A handshake writes the ticket of a session only while that is empty.
        unsafe {
            SSL_SESSION_get0_ticket(self, &raw mut ticket, &raw mut len);
            bun_core::ffi::slice(ticket, len)
        }
    }
}

impl RSA {
    /// `None` if `plaintext` is too long for the key.
    pub fn public_encrypt_oaep(&self, plaintext: &[u8]) -> Option<Vec<u8>> {
        // SAFETY: `self` is a live RSA. Reads `plaintext.len()` bytes and writes at most `RSA_size` bytes.
        unsafe {
            let mut ciphertext = vec![0u8; RSA_size(self) as usize];
            let len = RSA_public_encrypt(
                plaintext.len(),
                plaintext.as_ptr(),
                ciphertext.as_mut_ptr(),
                self,
                RSA_PKCS1_OAEP_PADDING,
            );
            ciphertext.truncate(usize::try_from(len).ok()?);
            Some(ciphertext)
        }
    }
}

/// `error:0b000074:X.509 certificate routines:OPENSSL_internal:...`, truncated to fit `buf`.
pub fn err_error_string_n(packed_error: u32, buf: &mut [u8]) -> &[u8] {
    // SAFETY: writes at most `buf.len()` bytes.
    unsafe { ERR_error_string_n(packed_error, buf.as_mut_ptr().cast(), buf.len()) };
    bun_core::slice_to_nul(buf)
}

const MAX_REASON_LEN: usize = 128;

/// Copied, because the reason of an `ERR_LIB_SYS` error comes from `strerror`.
pub fn err_reason_error_string(packed_error: u32) -> BoundedArray<u8, MAX_REASON_LEN> {
    // SAFETY: the call takes any code. The string is never null, and lives until this thread calls `strerror` again.
    let reason = unsafe { CStr::from_ptr(ERR_reason_error_string(packed_error)) }.to_bytes();
    BoundedArray::from_slice(&reason[..reason.len().min(MAX_REASON_LEN)]).expect("truncated to fit")
}

impl OwnedSslSession {
    pub fn retain(session: &SSL_SESSION) -> Self {
        SSL_SESSION_up_ref(session);
        Self(session.into())
    }

    pub fn from_der(der: &[u8]) -> Option<Self> {
        let len = c_long::try_from(der.len()).expect("int cast");
        // SAFETY: BoringSSL reads at most `len` bytes of `der`.
        unsafe { d2i_SSL_SESSION(core::ptr::null_mut(), &mut der.as_ptr(), len) }
    }
}

impl OwnedX509 {
    fn retain(cert: &X509) -> Self {
        X509_up_ref(cert);
        Self(cert.into())
    }

    pub fn from_der(der: &[u8]) -> Option<Self> {
        let len = c_long::try_from(der.len()).expect("int cast");
        // SAFETY: BoringSSL reads at most `len` bytes of `der`.
        unsafe { d2i_X509(core::ptr::null_mut(), &mut der.as_ptr(), len) }
    }
}

/// Finds the issuer of a certificate in a trust store.
pub struct IssuerLookup<'a>(
    core::ptr::NonNull<X509_STORE_CTX>,
    core::marker::PhantomData<&'a X509_STORE>,
);

impl<'a> IssuerLookup<'a> {
    pub fn new(store: &'a X509_STORE) -> Option<Self> {
        let ctx = core::ptr::NonNull::new(X509_STORE_CTX_new())?;
        let lookup = Self(ctx, core::marker::PhantomData);
        // SAFETY: the context keeps a pointer to `store`, which outlives it.
        let ready = unsafe {
            X509_STORE_CTX_init(
                ctx.as_ptr(),
                store,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
            )
        };
        (ready == 1).then_some(lookup)
    }

    pub fn issuer_of(&self, cert: &X509) -> Option<OwnedX509> {
        let mut issuer = None;
        // SAFETY: `new` initialized the context.
        unsafe { X509_STORE_CTX_get1_issuer(&mut issuer, self.0.as_ptr(), cert) };
        issuer
    }
}

impl Drop for IssuerLookup<'_> {
    fn drop(&mut self) {
        // SAFETY: we own the context, freed once.
        unsafe { X509_STORE_CTX_free(self.0.as_ptr()) }
    }
}

/// Owns one `CRYPTO_BUFFER` reference. A slice of them is a `CRYPTO_BUFFER **`.
#[repr(transparent)]
pub struct OwnedCryptoBuffer(core::ptr::NonNull<CRYPTO_BUFFER>);

impl OwnedCryptoBuffer {
    pub fn new(data: &[u8]) -> Option<Self> {
        // SAFETY: BoringSSL copies `data`, and no pool is asked for.
        let buf = unsafe { CRYPTO_BUFFER_new(data.as_ptr(), data.len(), core::ptr::null_mut()) };
        core::ptr::NonNull::new(buf).map(Self)
    }
}

impl Drop for OwnedCryptoBuffer {
    fn drop(&mut self) {
        // SAFETY: we own exactly one reference, released once.
        unsafe { CRYPTO_BUFFER_free(self.0.as_ptr()) }
    }
}

/// A `BIO` that reads from a slice.
pub struct MemBio<'a>(core::ptr::NonNull<BIO>, core::marker::PhantomData<&'a [u8]>);

impl<'a> MemBio<'a> {
    pub fn new(data: &'a [u8]) -> Option<Self> {
        // SAFETY: the `BIO` only reads `data`, which outlives it.
        let bio = unsafe { BIO_new_mem_buf(data.as_ptr().cast(), data.len() as ossl_ssize_t) };
        core::ptr::NonNull::new(bio).map(|bio| Self(bio, core::marker::PhantomData))
    }

    pub fn as_ptr(&self) -> *mut BIO {
        self.0.as_ptr()
    }

    /// The next PEM block that `read` accepts. `None` at the end, or when it does not parse.
    fn read_pem<T>(&self, read: PemReader<T>) -> Option<core::ptr::NonNull<T>> {
        // SAFETY: the `BIO` is live; no out-parameter, password callback or password is passed.
        core::ptr::NonNull::new(unsafe { read(self.as_ptr(), null_mut(), None, null_mut()) })
    }

    pub fn read_x509(&self) -> Option<OwnedX509> {
        self.read_pem(PEM_read_bio_X509).map(OwnedX509)
    }

    /// Also accepts a `TRUSTED CERTIFICATE` block.
    pub fn read_x509_aux(&self) -> Option<OwnedX509> {
        self.read_pem(PEM_read_bio_X509_AUX).map(OwnedX509)
    }

    pub fn read_x509_crl(&self) -> Option<OwnedX509Crl> {
        self.read_pem(PEM_read_bio_X509_CRL).map(OwnedX509Crl)
    }

    pub fn read_private_key(&self) -> Option<OwnedEvpPkey> {
        self.read_pem(PEM_read_bio_PrivateKey).map(OwnedEvpPkey)
    }

    pub fn read_rsa_public_key(&self) -> Option<OwnedRsa> {
        self.read_pem(PEM_read_bio_RSA_PUBKEY).map(OwnedRsa)
    }
}

/// A `PEM_read_bio_*` function: it returns a new reference, or null.
type PemReader<T> =
    unsafe extern "C" fn(*mut BIO, *mut *mut T, Option<pem_password_cb>, *mut c_void) -> *mut T;

impl Drop for MemBio<'_> {
    fn drop(&mut self) {
        // SAFETY: we own the `BIO`, freed once.
        unsafe { BIO_free(self.0.as_ptr()) };
    }
}

/// Owns the `STACK_OF(GENERAL_NAME)` that `X509V3_EXT_d2i` returns for a
/// subjectAltName extension. Frees every `GENERAL_NAME` and then the stack.
pub struct GeneralNames(core::ptr::NonNull<struct_stack_st_GENERAL_NAME>);

impl GeneralNames {
    /// Takes ownership of a `STACK_OF(GENERAL_NAME)`; `None` when `raw` is null.
    ///
    /// # Safety
    /// `raw` must be null or a stack the caller owns and does not free itself.
    pub(crate) unsafe fn from_raw(raw: *mut c_void) -> Option<Self> {
        core::ptr::NonNull::new(raw.cast::<struct_stack_st_GENERAL_NAME>()).map(Self)
    }

    pub(crate) fn len(&self) -> usize {
        // SAFETY: we own a live stack; `sk_num` takes it as `const OPENSSL_STACK`.
        unsafe { sk_num(self.0.as_ptr().cast::<OPENSSL_STACK>()) }
    }

    /// Borrows the `i`th entry; `None` past the end.
    pub(crate) fn get(&self, i: usize) -> Option<&GENERAL_NAME> {
        if i >= self.len() {
            return None;
        }
        // SAFETY: `i` is in bounds and the stack outlives the borrow, which is
        // tied to `&self`. BoringSSL owns the element until our `Drop`.
        unsafe {
            sk_value(self.0.as_ptr().cast::<OPENSSL_STACK>(), i)
                .cast::<GENERAL_NAME>()
                .as_ref()
        }
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &GENERAL_NAME> {
        (0..self.len()).filter_map(|i| self.get(i))
    }
}

/// A DNS / IP / URI subjectAltName entry borrowed from a [`GeneralNames`]
/// stack. IP entries are the raw 4- or 16-byte address octets.
pub enum SubjectAltName<'a> {
    Dns(&'a [u8]),
    Ip(&'a [u8]),
    Uri(&'a [u8]),
}

impl GeneralNames {
    /// The stack's DNS / IP / URI entries; other name types are skipped.
    pub fn subject_alt_names(&self) -> impl Iterator<Item = SubjectAltName<'_>> {
        self.iter().filter_map(|name| {
            // SAFETY: every `GeneralNames` comes from `from_raw`, whose
            // contract requires a stack BoringSSL produced, so `name_type`
            // selects the live union arm and the ASN1 string's `data` is
            // readable for `length` bytes for the stack's lifetime.
            unsafe {
                let string: &asn1_string_st = match name.name_type {
                    GEN_DNS => name.d.dNSName.as_ref()?,
                    GEN_URI => name.d.uniformResourceIdentifier.as_ref()?,
                    GEN_IPADD => name.d.ip.as_ref()?,
                    _ => return None,
                };
                if string.data.is_null() {
                    return None;
                }
                let bytes =
                    core::slice::from_raw_parts(string.data, usize::try_from(string.length).ok()?);
                Some(match name.name_type {
                    GEN_DNS => SubjectAltName::Dns(bytes),
                    GEN_IPADD => SubjectAltName::Ip(bytes),
                    _ => SubjectAltName::Uri(bytes),
                })
            }
        })
    }
}

/// The certificate's subjectAltName extension.
pub enum SanLookup {
    Absent,
    /// Present but not decodable as subjectAltName.
    Invalid,
    Names(GeneralNames),
}

impl X509 {
    /// This certificate's subjectAltName extension.
    pub fn subject_alt_names(&self) -> SanLookup {
        // SAFETY: `self` is a live certificate (opaque, only obtainable from
        // BoringSSL); `X509V3_EXT_d2i` returns a freshly allocated stack that
        // `GeneralNames::from_raw` then owns and frees.
        unsafe {
            let index = X509_get_ext_by_NID(self, NID_subject_alt_name, -1);
            if index < 0 {
                return SanLookup::Absent;
            }
            let Some(ext) = X509_get_ext(self, index).as_ref() else {
                return SanLookup::Absent;
            };
            if X509V3_EXT_get(ext) != X509V3_EXT_get_nid(NID_subject_alt_name) {
                return SanLookup::Invalid;
            }
            match GeneralNames::from_raw(X509V3_EXT_d2i(ext)) {
                Some(names) => SanLookup::Names(names),
                None => SanLookup::Absent,
            }
        }
    }

    /// RFC 5929 §4.1 `tls-server-end-point`: hashed with the digest of the signature algorithm,
    /// SHA-256 in place of MD5 and SHA-1. `None` when the algorithm names no digest (Ed25519).
    pub fn tls_server_end_point_hash(
        &self,
        out: &mut [u8; EVP_MAX_MD_SIZE as usize],
    ) -> Option<usize> {
        let mut len: c_uint = 0;
        // SAFETY: `self` is live; `X509_digest` writes at most `EVP_MAX_MD_SIZE` bytes to `out`.
        unsafe {
            let md = match self.signature_digest_nid() {
                NID_undef => return None,
                NID_md5 | NID_sha1 => EVP_sha256(),
                nid => EVP_get_digestbynid(nid)?,
            };
            if X509_digest(self, md, out.as_mut_ptr(), &raw mut len) != 1 {
                return None;
            }
        }
        Some(len as usize).filter(|len| (1..=out.len()).contains(len))
    }

    /// RSASSA-PSS names its digest in its parameters. `NID_undef` when there is none.
    fn signature_digest_nid(&self) -> c_int {
        let mut digest_nid: c_int = NID_undef;
        // SAFETY: `self` owns `algorithm`; a `V_ASN1_SEQUENCE` parameter is an `ASN1_STRING` (DER).
        unsafe {
            let signature_nid = X509_get_signature_nid(self);
            if signature_nid != NID_rsassaPss {
                OBJ_find_sigid_algs(signature_nid, &raw mut digest_nid, core::ptr::null_mut());
                return digest_nid;
            }
            let mut algorithm: *const X509_ALGOR = core::ptr::null();
            X509_get0_signature(core::ptr::null_mut(), &raw mut algorithm, self);
            let mut parameter_type: c_int = 0;
            let mut parameter: *const c_void = core::ptr::null();
            X509_ALGOR_get0(
                core::ptr::null_mut(),
                &raw mut parameter_type,
                &raw mut parameter,
                algorithm,
            );
            if parameter_type != V_ASN1_SEQUENCE {
                return NID_undef;
            }
            let Some(der) = parameter.cast::<ASN1_STRING>().as_ref() else {
                return NID_undef;
            };
            let mut input = der.data.cast_const();
            let params =
                d2i_RSA_PSS_PARAMS(core::ptr::null_mut(), &raw mut input, der.length as c_long);
            let Some(hash) = params.as_ref().map(|params| params.hashAlgorithm) else {
                ERR_clear_error();
                return NID_undef;
            };
            // RFC 4055 §3.1: `hashAlgorithm [0] HashAlgorithm DEFAULT sha1Identifier`
            digest_nid = NID_sha1;
            if !hash.is_null() {
                let mut object: *const ASN1_OBJECT = core::ptr::null();
                X509_ALGOR_get0(
                    &raw mut object,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    hash,
                );
                digest_nid = OBJ_obj2nid(object);
            }
            RSA_PSS_PARAMS_free(params);
        }
        digest_nid
    }

    pub fn to_der(&self) -> Option<OpensslBytes> {
        let mut der: *mut u8 = core::ptr::null_mut();
        // SAFETY: `self` is live. Given null, `i2d_X509` allocates `len` bytes or leaves it null.
        unsafe {
            let len = i2d_X509(self, &raw mut der);
            OpensslBytes::from_raw(der, len as usize)
        }
    }

    /// Whether `self` could have issued `subject`.
    pub fn issued(&self, subject: &X509) -> bool {
        // SAFETY: both certificates are live.
        c_long::from(unsafe { X509_check_issued(self, subject) }) == X509_V_OK
    }

    /// Iterates this certificate's Subject Common Names in order.
    pub fn common_names(&self) -> CommonNames<'_> {
        CommonNames {
            subject: X509_get_subject_name(self),
            last: -1,
            _cert: core::marker::PhantomData,
        }
    }
}

/// Bytes that BoringSSL has allocated. `OPENSSL_free`s on drop.
pub struct OpensslBytes {
    ptr: core::ptr::NonNull<u8>,
    len: usize,
}

impl OpensslBytes {
    /// SAFETY: `ptr` is null, or `len` bytes from `OPENSSL_malloc` that the caller gives up.
    pub unsafe fn from_raw(ptr: *mut u8, len: usize) -> Option<Self> {
        core::ptr::NonNull::new(ptr).map(|ptr| Self { ptr, len })
    }
}

impl core::ops::Deref for OpensslBytes {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        // SAFETY: this struct owns `len` readable bytes at `ptr` until `Drop`.
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }
}

impl Drop for OpensslBytes {
    fn drop(&mut self) {
        // SAFETY: `ptr` is from `OPENSSL_malloc`, freed once.
        unsafe { OPENSSL_free(self.ptr.as_ptr().cast()) }
    }
}

/// Iterator over a certificate's Subject Common Names, transcoded to UTF-8 via
/// `ASN1_STRING_to_UTF8` (so BMPString / UniversalString CNs compare like
/// OpenSSL `X509_check_host`'s `do_check_string`).
pub struct CommonNames<'a> {
    subject: *mut X509_NAME,
    last: c_int,
    _cert: core::marker::PhantomData<&'a X509>,
}

impl Iterator for CommonNames<'_> {
    type Item = OpensslBytes;

    fn next(&mut self) -> Option<OpensslBytes> {
        if self.subject.is_null() {
            return None;
        }
        // SAFETY: the subject and its entries are owned by the certificate
        // borrowed for `'a`; every accessor is guarded against null returns
        // and `ASN1_STRING_to_UTF8` allocates `len` bytes or leaves `out` null.
        unsafe {
            loop {
                let entry_idx = X509_NAME_get_index_by_NID(self.subject, NID_commonName, self.last);
                if entry_idx < 0 {
                    return None;
                }
                self.last = entry_idx;
                let entry = X509_NAME_get_entry(self.subject, entry_idx);
                if entry.is_null() {
                    continue;
                }
                let data = X509_NAME_ENTRY_get_data(entry);
                if data.is_null() {
                    continue;
                }
                let mut out: *mut u8 = core::ptr::null_mut();
                let len = ASN1_STRING_to_UTF8(&raw mut out, data);
                if let Some(name) = OpensslBytes::from_raw(out, len as usize) {
                    return Some(name);
                }
            }
        }
    }
}

/// Owns an `SSL`.
pub struct OwnedSsl {
    ssl: core::ptr::NonNull<SSL>,
    /// Set while `SSL_do_handshake`, `SSL_read`, `SSL_write` or `SSL_shutdown` is on the stack.
    in_use: Cell<bool>,
}

impl OwnedSsl {
    pub fn new(ctx: &SSL_CTX, is_client: bool) -> Option<Self> {
        // SAFETY: `SSL_new` takes its own references to `ctx`, and the new `SSL` has not started a handshake.
        let ssl = unsafe {
            let ssl = core::ptr::NonNull::new(SSL_new(ctx))?;
            if is_client {
                SSL_set_connect_state(ssl.as_ptr());
            } else {
                SSL_set_accept_state(ssl.as_ptr());
            }
            ssl
        };
        Some(Self {
            ssl,
            in_use: Cell::new(false),
        })
    }

    fn call_unless_in_use(&self, f: impl FnOnce(*mut SSL) -> c_int) -> Option<c_int> {
        if self.in_use.replace(true) {
            return None;
        }
        let ret_code = f(self.ssl.as_ptr());
        self.in_use.set(false);
        Some(ret_code)
    }

    /// A call that was skipped because the `SSL` is in use reports `WANT_READ`.
    fn check_ret_code(&self, ret_code: Option<c_int>) -> Result<usize, SslErrorCode> {
        match ret_code {
            Some(ret_code @ 1..) => Ok(ret_code as usize),
            // SAFETY: we own the `SSL`.
            Some(ret_code) => Err(SslErrorCode(unsafe {
                SSL_get_error(self.ssl.as_ptr(), ret_code)
            })),
            None => Err(SslErrorCode::WANT_READ),
        }
    }

    pub fn do_handshake(&self) -> Result<(), SslErrorCode> {
        // SAFETY: we own the `SSL`, and none of the calls that set `in_use` is on the stack.
        let ret_code = self.call_unless_in_use(|ssl| unsafe { SSL_do_handshake(ssl) });
        self.check_ret_code(ret_code).map(drop)
    }

    pub fn read(&self, mut buf: BorrowedCursor<'_, u8>) -> Result<usize, SslErrorCode> {
        let len = c_int::try_from(buf.capacity()).unwrap_or(c_int::MAX);
        // SAFETY: as in `do_handshake`. BoringSSL initializes as many of the `len` bytes as it
        // reports, and uninitializes none.
        unsafe {
            let unfilled = buf.as_mut().as_mut_ptr();
            let ret_code = self.call_unless_in_use(|ssl| SSL_read(ssl, unfilled.cast(), len));
            self.check_ret_code(ret_code)
                .inspect(|&read| _ = buf.advance(read))
        }
    }

    pub fn write(&self, data: &[u8]) -> Result<usize, SslErrorCode> {
        let len = c_int::try_from(data.len()).unwrap_or(c_int::MAX);
        // SAFETY: as in `do_handshake`. BoringSSL reads at most `len` bytes, and only in this call.
        let ret_code =
            self.call_unless_in_use(|ssl| unsafe { SSL_write(ssl, data.as_ptr().cast(), len) });
        self.check_ret_code(ret_code)
    }

    /// `true` once both ends have sent close_notify. Also during a handshake, as in `SSL_shutdown`, and if the `SSL` is in use.
    pub fn shutdown(&self) -> Result<bool, SslErrorCode> {
        // SAFETY: as in `do_handshake`.
        match self.call_unless_in_use(|ssl| unsafe { SSL_shutdown(ssl) }) {
            Some(0) => Ok(false),
            None => Ok(true),
            ret_code => self.check_ret_code(ret_code).map(|_| true),
        }
    }
}

impl core::ops::Deref for OwnedSsl {
    type Target = SSL;
    fn deref(&self) -> &SSL {
        // SAFETY: live until `self` is dropped.
        unsafe { self.ssl.as_ref() }
    }
}

impl Drop for OwnedSsl {
    fn drop(&mut self) {
        // SAFETY: we own the `SSL`, freed once.
        unsafe { SSL_free(self.ssl.as_ptr()) }
    }
}

impl SSL {
    /// The number of decrypted bytes that are buffered for the next read.
    pub fn pending(&self) -> usize {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_pending(self) as usize }
    }

    pub fn is_init_finished(&self) -> bool {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_is_init_finished(self) != 0 }
    }

    pub fn has_received_shutdown(&self) -> bool {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_get_shutdown(self) & SSL_RECEIVED_SHUTDOWN != 0 }
    }

    /// An `X509_V_*` code.
    pub fn verify_result(&self) -> c_long {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_get_verify_result(self) }
    }

    /// A failed verification does not abort the handshake: the caller reads [`Self::verify_result`].
    pub fn set_verify_always_continue(&self, mode: c_int) {
        extern "C" fn always_continue_verify(_: c_int, _: *mut X509_STORE_CTX) -> c_int {
            1
        }
        // SAFETY: `self` is a live SSL, and the callback reads no argument.
        unsafe { SSL_set_verify(self, mode, Some(always_continue_verify)) }
    }

    pub fn set_renegotiate_mode(&self, mode: RenegotiateMode) {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_set_renegotiate_mode(self, mode) }
    }

    /// Accepts the HelloRequest of the peer. `false` if none is pending or BoringSSL refuses it.
    pub fn renegotiate(&self) -> bool {
        // SAFETY: `self` is a live SSL; BoringSSL refuses while a handshake is running.
        unsafe { SSL_renegotiate(self) == 1 }
    }

    pub fn clear_session_id_context(&self) {
        // SAFETY: `self` is a live SSL; no byte is read.
        unsafe { SSL_set_session_id_context(self, core::ptr::null(), 0) };
    }

    pub fn session(&self) -> Option<OwnedSslSession> {
        // SAFETY: `self` is a live SSL, and the result carries its own reference.
        unsafe { SSL_get1_session(self) }
    }

    /// Client side: the session to resume. No-op once the handshake has started.
    pub fn set_session(&self, session: &SSL_SESSION) {
        let mut random = [0u8; SSL3_RANDOM_SIZE];
        // SAFETY: writes at most `random.len()` bytes. `SSL_set_session` takes its own reference.
        // It abort()s once the ClientHello is built, which is when the client random is filled.
        unsafe {
            SSL_get_client_random(self, random.as_mut_ptr(), random.len());
            if !self.is_server() && random == [0u8; SSL3_RANDOM_SIZE] {
                SSL_set_session(self, session);
            }
        }
    }

    pub fn is_session_reused(&self) -> bool {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_session_reused(self) != 0 }
    }

    pub fn is_server(&self) -> bool {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_is_server(self) != 0 }
    }

    /// A `TLS1_*_VERSION`.
    pub fn version(&self) -> u16 {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_version(self) as u16 }
    }

    pub fn version_str(&self) -> &'static CStr {
        // SAFETY: `self` is a live SSL, and the string is static.
        unsafe { SSL_get_version(self) }.to_cstr()
    }

    /// The NID of the group of the key exchange, or `NID_undef`.
    pub fn negotiated_group(&self) -> c_int {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_get_negotiated_group(self) }
    }

    pub fn total_renegotiations(&self) -> c_int {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_total_renegotiations(self) }
    }

    pub fn current_cipher(&self) -> Option<&'static SSL_CIPHER> {
        // SAFETY: `self` is a live SSL, and the ciphers are a static table.
        unsafe { SSL_get_current_cipher(self) }
    }

    /// Retained, because SNI and [`Self::set_ssl_ctx`] replace it.
    pub fn ssl_ctx(&self) -> OwnedSslCtx {
        // SAFETY: the SSL holds a reference to its context, which is never null, and `SSL_CTX_up_ref` takes the one returned.
        unsafe {
            let ctx = SSL_get_SSL_CTX(self);
            SSL_CTX_up_ref(ctx);
            OwnedSslCtx(core::ptr::NonNull::new_unchecked(ctx))
        }
    }

    /// The SNI host name configured on (client) or received by (server) this
    /// connection, if any.
    pub fn servername(&self) -> Option<BoundedArray<u8, TLSEXT_MAXLEN_host_name>> {
        // SAFETY: `p` is null or a string that the SSL owns until the name is set again.
        unsafe {
            let p = SSL_get_servername(self, 0 /* TLSEXT_NAMETYPE_host_name */);
            if p.is_null() {
                return None;
            }
            BoundedArray::from_slice(CStr::from_ptr(p).to_bytes()).ok()
        }
    }

    /// Client side: the SNI host name to send, set before the handshake. `false` if BoringSSL rejects it.
    pub fn set_servername(&self, hostname: &[u8]) -> bool {
        // One byte over the limit is kept, so BoringSSL still rejects a name that is too long.
        let mut name = [0u8; TLSEXT_MAXLEN_host_name + 2];
        let len = hostname.len().min(TLSEXT_MAXLEN_host_name + 1);
        name[..len].copy_from_slice(&hostname[..len]);
        // SAFETY: `name` ends with a NUL; BoringSSL copies it.
        unsafe { SSL_set_tlsext_host_name(self, name.as_ptr().cast()) == 1 }
    }

    /// Client side: the protocols to offer, in wire format. `false` if the list is malformed.
    pub fn set_alpn_protos(&self, protos: &[u8]) -> bool {
        // SAFETY: `self` is a live SSL; BoringSSL copies `protos`.
        unsafe { SSL_set_alpn_protos(self, protos.as_ptr(), protos.len()) == 0 }
    }

    /// `f` must not call into the SSL.
    fn with_alpn_selected<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        let (mut protocol, mut len) = (core::ptr::null(), 0);
        // SAFETY: the SSL owns `len` bytes at `protocol` until the next handshake step.
        f(unsafe {
            SSL_get0_alpn_selected(self, &raw mut protocol, &raw mut len);
            bun_core::ffi::slice(protocol, len as usize)
        })
    }

    pub fn alpn_selected(&self) -> Option<BoundedArray<u8, { u8::MAX as usize }>> {
        self.with_alpn_selected(BoundedArray::from_slice)
            .ok()
            .filter(|protocol| !protocol.is_empty())
    }

    pub fn is_alpn_selected(&self, protocol: &[u8]) -> bool {
        self.with_alpn_selected(|selected| selected == protocol)
    }

    pub fn enable_signed_cert_timestamps(&self) {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_enable_signed_cert_timestamps(self) }
    }

    pub fn enable_ocsp_stapling(&self) {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_enable_ocsp_stapling(self) }
    }

    pub fn set_max_send_fragment(&self, size: usize) -> bool {
        // SAFETY: `self` is a live SSL.
        unsafe { SSL_set_max_send_fragment(self, size) == 1 }
    }

    /// The peer's leaf certificate.
    pub fn peer_certificate(&self) -> Option<OwnedX509> {
        SSL_get_peer_certificate(self)
    }

    pub fn peer_cert_chain_without_leaf(&self) -> Vec<OwnedX509> {
        // SAFETY: `chain` is null or a stack of certificates that the session owns until the next
        // handshake step. `sk_value` returns null for a null stack and past the end.
        unsafe {
            let chain = SSL_get_peer_full_cert_chain(self).cast::<OPENSSL_STACK>();
            (1..)
                .map_while(|i| sk_value(chain, i).cast::<X509>().as_ref())
                .map(OwnedX509::retain)
                .collect()
        }
    }

    /// The local leaf certificate.
    pub fn certificate(&self) -> Option<OwnedX509> {
        // SAFETY: the result is null or a certificate that the SSL owns until another one is set.
        unsafe { SSL_get_certificate(self).as_ref() }.map(OwnedX509::retain)
    }

    /// Uses the certificate, key and chain of `ctx` for the rest of the handshake. `false` if BoringSSL rejects one.
    pub fn set_ssl_ctx(&self, ctx: &SSL_CTX) -> bool {
        // SAFETY: each setter takes its own references. `ctx` owns what its getters return until
        // its certificate or key is set again.
        unsafe {
            SSL_set_SSL_CTX(self, ctx);
            // `SSL_set_SSL_CTX` stops retargeting the certificate once ClientHello processing has reached ALPN selection.
            let leaf = SSL_CTX_get0_certificate(ctx);
            let pkey = SSL_CTX_get0_privatekey(ctx);
            if leaf.is_null() || pkey.is_null() {
                return true;
            }
            let ok_cert = SSL_use_certificate(self, leaf) == 1;
            let ok_key = SSL_use_PrivateKey(self, pkey) == 1;
            let mut chain = null_mut();
            let ok_chain = SSL_CTX_get0_chain_certs(ctx, &raw mut chain) != 1
                || chain.is_null()
                || SSL_set1_chain(self, chain) == 1;
            ok_cert && ok_key && ok_chain
        }
    }

    /// The Finished message that was sent. `None` before that and in TLS 1.3.
    pub fn finished(&self) -> Option<[u8; FINISHED_LEN]> {
        let mut out = [0u8; FINISHED_LEN];
        // SAFETY: writes at most `out.len()` bytes.
        let len = unsafe { SSL_get_finished(self, out.as_mut_ptr().cast(), out.len()) };
        (len == FINISHED_LEN).then_some(out)
    }

    /// As [`Self::finished`], for the message that was received.
    pub fn peer_finished(&self) -> Option<[u8; FINISHED_LEN]> {
        let mut out = [0u8; FINISHED_LEN];
        // SAFETY: writes at most `out.len()` bytes.
        let len = unsafe { SSL_get_peer_finished(self, out.as_mut_ptr().cast(), out.len()) };
        (len == FINISHED_LEN).then_some(out)
    }

    pub fn export_keying_material(
        &self,
        out: &mut [u8],
        label: &[u8],
        context: Option<&[u8]>,
    ) -> bool {
        let use_context = c_int::from(context.is_some());
        let context = context.unwrap_or_default();
        // SAFETY: each pointer is valid for the length passed with it.
        let rc = unsafe {
            SSL_export_keying_material(
                self,
                out.as_mut_ptr(),
                out.len(),
                label.as_ptr().cast(),
                label.len(),
                context.as_ptr(),
                context.len(),
                use_context,
            )
        };
        rc == 1
    }
}

impl SSL_CIPHER {
    pub fn name(&self) -> &'static CStr {
        // SAFETY: `self` is an entry of the static table of ciphers.
        unsafe { SSL_CIPHER_get_name(self) }.to_cstr()
    }

    pub fn standard_name(&self) -> &'static CStr {
        // SAFETY: as in `name`.
        unsafe { SSL_CIPHER_standard_name(self) }.to_cstr()
    }

    /// A `TLS1_*_VERSION`, or `SSL3_VERSION`.
    pub fn min_version(&self) -> u16 {
        // SAFETY: as in `name`.
        unsafe { SSL_CIPHER_get_min_version(self) }
    }

    pub fn kx_nid(&self) -> c_int {
        // SAFETY: as in `name`.
        unsafe { SSL_CIPHER_get_kx_nid(self) }
    }
}

impl Drop for GeneralNames {
    fn drop(&mut self) {
        // SAFETY: we own the stack. `sk_pop_free_ex` only passes its third argument on
        // to `call_general_name_free`, once per element, and that ignores it.
        unsafe {
            sk_pop_free_ex(
                self.0.as_ptr().cast::<OPENSSL_STACK>(),
                Some(call_general_name_free),
                None,
            )
        }
    }
}

unsafe extern "C" fn call_general_name_free(_: OPENSSL_sk_free_func, ptr: *mut c_void) {
    // SAFETY: `ptr` is an element `sk_pop_free_ex` is draining from the stack.
    unsafe { GENERAL_NAME_free(ptr.cast::<GENERAL_NAME>()) }
}

unsafe extern "C" {
    fn sk_num(sk: *const OPENSSL_STACK) -> usize;
    fn sk_value(sk: *const OPENSSL_STACK, i: usize) -> *mut c_void;
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
    pub(crate) fn CRYPTO_memcmp(a: *const c_void, b: *const c_void, len: usize) -> c_int;
    fn ERR_error_string_n(packed_error: u32, buf: *mut c_char, len: usize) -> *mut c_char;
    pub safe fn ERR_load_BIO_strings();
    pub safe fn OpenSSL_add_all_algorithms();

    // ── ASN1 ──────────────────────────────────────────────────────────────
    fn ASN1_STRING_to_UTF8(out: *mut *mut u8, in_: *const ASN1_STRING) -> c_int;

    // ── EVP digest getters (infallible, return static singletons) ────────
    pub safe fn EVP_md4() -> &'static EVP_MD;
    pub safe fn EVP_md5() -> &'static EVP_MD;
    pub safe fn EVP_ripemd160() -> &'static EVP_MD;
    pub safe fn EVP_sha1() -> &'static EVP_MD;
    pub safe fn EVP_sha224() -> &'static EVP_MD;
    pub safe fn EVP_sha256() -> &'static EVP_MD;
    pub safe fn EVP_sha384() -> &'static EVP_MD;
    pub safe fn EVP_sha512() -> &'static EVP_MD;
    pub safe fn EVP_sha512_224() -> &'static EVP_MD;
    pub safe fn EVP_sha512_256() -> &'static EVP_MD;
    pub safe fn EVP_sha3_224() -> &'static EVP_MD;
    pub safe fn EVP_sha3_256() -> &'static EVP_MD;
    pub safe fn EVP_sha3_384() -> &'static EVP_MD;
    pub safe fn EVP_sha3_512() -> &'static EVP_MD;
    pub safe fn EVP_blake2b256() -> &'static EVP_MD;
    pub safe fn EVP_blake2b512() -> &'static EVP_MD;

    // ── EVP digest ctx ───────────────────────────────────────────────────
    fn EVP_MD_CTX_cleanup(ctx: *mut EVP_MD_CTX) -> c_int;
    fn EVP_MD_CTX_copy_ex(out: *mut EVP_MD_CTX, in_: *const EVP_MD_CTX) -> c_int;
    safe fn EVP_MD_size(md: &EVP_MD) -> usize;
    fn EVP_DigestInit(ctx: *mut EVP_MD_CTX, type_: *const EVP_MD) -> c_int;
    fn EVP_DigestUpdate(ctx: *mut EVP_MD_CTX, data: *const c_void, len: usize) -> c_int;
    fn EVP_DigestFinal_ex(ctx: *mut EVP_MD_CTX, md_out: *mut u8, out_size: *mut c_uint) -> c_int;
    fn EVP_get_digestbyname(name: *const c_char) -> Option<&'static EVP_MD>;
    fn EVP_Digest(
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
    fn SHA1_Init(sha: *mut SHA_CTX) -> c_int;
    fn SHA1_Update(sha: *mut SHA_CTX, data: *const c_void, len: usize) -> c_int;
    fn SHA1_Final(out: *mut u8, sha: *mut SHA_CTX) -> c_int;
    fn SHA1(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SHA-256 ──────────────────────────────────────────────────────────
    fn SHA256_Init(sha: *mut SHA256_CTX) -> c_int;
    fn SHA256_Update(sha: *mut SHA256_CTX, data: *const c_void, len: usize) -> c_int;
    fn SHA256_Final(out: *mut u8, sha: *mut SHA256_CTX) -> c_int;
    fn SHA256(data: *const u8, len: usize, out: *mut u8) -> *mut u8;

    // ── SSL ──────────────────────────────────────────────────────────────
    pub safe fn SSL_library_init() -> c_int;
    pub safe fn SSL_load_error_strings();
    pub fn SSL_CTX_up_ref(ctx: *mut SSL_CTX) -> c_int;
    fn SSL_get_peer_full_cert_chain(ssl: &SSL) -> *mut struct_stack_st_X509;

    // ── X509 ─────────────────────────────────────────────────────────────
    fn d2i_X509(out: *mut *mut X509, inp: &mut *const u8, len: c_long) -> Option<OwnedX509>;
    fn i2d_X509(x: *const X509, outp: *mut *mut u8) -> c_int;
    safe fn X509_up_ref(x: &X509) -> c_int;
    fn X509_free(x509: *mut X509);
    fn X509_get_signature_nid(x509: *const X509) -> c_int;
    fn X509_get0_signature(
        out_sig: *mut *const asn1_string_st,
        out_alg: *mut *const X509_ALGOR,
        x509: *const X509,
    );
    fn X509_ALGOR_get0(
        out_obj: *mut *const ASN1_OBJECT,
        out_param_type: *mut c_int,
        out_param_value: *mut *const c_void,
        alg: *const X509_ALGOR,
    );
    fn d2i_RSA_PSS_PARAMS(
        out: *mut *mut RSA_PSS_PARAMS,
        inp: *mut *const u8,
        len: c_long,
    ) -> *mut RSA_PSS_PARAMS;
    fn RSA_PSS_PARAMS_free(params: *mut RSA_PSS_PARAMS);
    fn OBJ_obj2nid(obj: *const ASN1_OBJECT) -> c_int;
    fn X509_digest(
        x509: *const X509,
        md: *const EVP_MD,
        out: *mut u8,
        out_len: *mut c_uint,
    ) -> c_int;
    fn OBJ_find_sigid_algs(
        sign_nid: c_int,
        out_digest_nid: *mut c_int,
        out_pkey_nid: *mut c_int,
    ) -> c_int;
    fn EVP_get_digestbynid(nid: c_int) -> Option<&'static EVP_MD>;
    safe fn X509_get_subject_name(x509: &X509) -> *mut X509_NAME;
    fn X509_get_ext_by_NID(x: *const X509, nid: c_int, lastpos: c_int) -> c_int;
    fn X509_get_ext(x: *const X509, loc: c_int) -> *mut X509_EXTENSION;
    fn X509_NAME_get_index_by_NID(name: *const X509_NAME, nid: c_int, lastpos: c_int) -> c_int;
    fn X509_NAME_get_entry(name: *const X509_NAME, loc: c_int) -> *mut X509_NAME_ENTRY;
    fn X509_NAME_ENTRY_get_data(entry: *const X509_NAME_ENTRY) -> *mut ASN1_STRING;
    fn X509V3_EXT_d2i(ext: *const X509_EXTENSION) -> *mut c_void;
    fn X509V3_EXT_get(ext: *const X509_EXTENSION) -> *const X509V3_EXT_METHOD;
    safe fn X509V3_EXT_get_nid(nid: c_int) -> *const X509V3_EXT_METHOD;
    fn X509_check_issued(issuer: &X509, subject: &X509) -> c_int;
}

pub const X509_V_OK: c_long = 0;

pub const SSL_GROUP_SECP256R1: u16 = 23;
pub const SSL_GROUP_SECP384R1: u16 = 24;
pub const SSL_GROUP_SECP521R1: u16 = 25;
pub const SSL_GROUP_X25519: u16 = 29;
pub const SSL_GROUP_X448: u16 = 30;

// ═══════════════════════════════════════════════════════════════════════════
// SSL / TLS — error codes, verify modes, shutdown flags, renegotiate modes
// (`vendor/boringssl/include/openssl/ssl.h`)
// ═══════════════════════════════════════════════════════════════════════════

/// An `SSL_ERROR_*` code from `SSL_get_error`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SslErrorCode(c_int);

impl SslErrorCode {
    const SSL: Self = Self(1);
    pub const WANT_READ: Self = Self(2);
    pub const WANT_WRITE: Self = Self(3);
    const SYSCALL: Self = Self(5);
    pub const ZERO_RETURN: Self = Self(6);
    pub const WANT_RENEGOTIATE: Self = Self(19);

    pub fn is_fatal(self) -> bool {
        matches!(self, Self::SSL | Self::SYSCALL)
    }
}

pub const SSL_VERIFY_NONE: c_int = 0x00;
pub const SSL_VERIFY_PEER: c_int = 0x01;
pub const SSL_VERIFY_FAIL_IF_NO_PEER_CERT: c_int = 0x02;

const SSL_RECEIVED_SHUTDOWN: c_int = 2;

const SSL_MAX_SID_CTX_LENGTH: usize = 32;
const SSL3_RANDOM_SIZE: usize = 32;
const TLSEXT_MAXLEN_host_name: usize = 255;
/// `kFinishedLen` (`ssl/ssl_transcript.cc`).
const FINISHED_LEN: usize = 12;

pub const SSL_TLSEXT_ERR_OK: c_int = 0;
pub const SSL_TLSEXT_ERR_ALERT_FATAL: c_int = 2;
pub const SSL_TLSEXT_ERR_NOACK: c_int = 3;

/// `enum ssl_renegotiate_mode_t`
#[repr(u32)]
pub enum RenegotiateMode {
    Never = 0,
    Explicit = 4,
}

/// `#define RSA_PKCS1_OAEP_PADDING 4` (`openssl/rsa.h`).
const RSA_PKCS1_OAEP_PADDING: c_int = 4;

// ═══════════════════════════════════════════════════════════════════════════
// BIO
// (`vendor/boringssl/include/openssl/bio.h`)
// ═══════════════════════════════════════════════════════════════════════════

/// `ossl_ssize_t` — signed counterpart of `size_t` for BoringSSL "length or -1"
/// parameters.
pub(crate) type ossl_ssize_t = isize;

bun_opaque::sealed_handle! {
    /// `struct bio_method_st` (`typedef ... BIO_METHOD`).
    pub struct BIO_METHOD;
    /// `struct bio_st` (`typedef ... BIO`).
    pub struct BIO;
}

/// `#define BIO_CTRL_FLUSH 11`
pub const BIO_CTRL_FLUSH: c_int = 11;
/// `#define BIO_TYPE_SOURCE_SINK 0x0400`
pub const BIO_TYPE_SOURCE_SINK: c_int = 0x0400;

// ═══════════════════════════════════════════════════════════════════════════
// Additional opaque handles
// ═══════════════════════════════════════════════════════════════════════════

bun_opaque::sealed_handle! {
    /// `struct ssl_method_st` (`typedef ... SSL_METHOD`).
    pub struct SSL_METHOD;
    /// `struct x509_store_st` (`typedef ... X509_STORE`).
    pub struct X509_STORE;
    /// `struct x509_store_ctx_st` (`typedef ... X509_STORE_CTX`).
    pub struct X509_STORE_CTX;
    /// `struct X509_crl_st` (`typedef ... X509_CRL`).
    pub struct X509_CRL;
    /// `struct rsa_st` (`typedef ... RSA`).
    pub struct RSA;
}

/// `int (*SSL_verify_cb)(int preverify_ok, X509_STORE_CTX *ctx)` — verify
/// callback type for `SSL_set_verify` / `SSL_CTX_set_verify`.
pub type SSL_verify_cb = Option<unsafe extern "C" fn(c_int, *mut X509_STORE_CTX) -> c_int>;

/// `int pem_password_cb(char *buf, int size, int rwflag, void *userdata)`.
pub type pem_password_cb = unsafe extern "C" fn(*mut c_char, c_int, c_int, *mut c_void) -> c_int;

// ═══════════════════════════════════════════════════════════════════════════
// Extern functions — SSL / BIO / ERR / HMAC / RSA / PBKDF2
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    // ── SSL_CTX ──────────────────────────────────────────────────────────
    pub fn SSL_CTX_new(method: *const SSL_METHOD) -> *mut SSL_CTX;
    fn SSL_CTX_free(ctx: *mut SSL_CTX);
    fn SSL_CTX_get_verify_mode(ctx: *const SSL_CTX) -> c_int;
    fn SSL_CTX_set_session_id_context(
        ctx: &SSL_CTX,
        sid_ctx: *const u8,
        sid_ctx_len: usize,
    ) -> c_int;
    pub fn SSL_CTX_set_ex_data(ctx: *mut SSL_CTX, idx: c_int, data: *mut c_void) -> c_int;
    pub fn SSL_CTX_set0_buffer_pool(ctx: *mut SSL_CTX, pool: *mut CRYPTO_BUFFER_POOL);
    pub fn SSL_CTX_set1_groups_list(ctx: *mut SSL_CTX, groups: *const c_char) -> c_int;
    /// `enum ssl_compliance_policy_t` (int-sized via BORINGSSL_ENUM_INT).
    pub fn SSL_CTX_set_compliance_policy(ctx: *mut SSL_CTX, policy: c_int) -> c_int;

    // ── CRYPTO_BUFFER_POOL ───────────────────────────────────────────────
    pub fn CRYPTO_BUFFER_POOL_new() -> *mut CRYPTO_BUFFER_POOL;

    // ── SSL ──────────────────────────────────────────────────────────────
    fn SSL_new(ctx: &SSL_CTX) -> *mut SSL;
    fn SSL_free(ssl: *mut SSL);
    fn SSL_set_connect_state(ssl: *mut SSL);
    fn SSL_set_accept_state(ssl: *mut SSL);
    pub fn SSL_set_bio(ssl: &SSL, rbio: *mut BIO, wbio: *mut BIO);
    fn SSL_do_handshake(ssl: *mut SSL) -> c_int;
    fn SSL_read(ssl: *mut SSL, buf: *mut c_void, num: c_int) -> c_int;
    fn SSL_pending(ssl: *const SSL) -> c_int;
    fn SSL_write(ssl: *mut SSL, buf: *const c_void, num: c_int) -> c_int;
    fn SSL_shutdown(ssl: *mut SSL) -> c_int;
    fn SSL_get_error(ssl: *const SSL, ret_code: c_int) -> c_int;
    fn SSL_get_shutdown(ssl: *const SSL) -> c_int;
    fn SSL_is_init_finished(ssl: *const SSL) -> c_int;
    pub fn SSL_set_verify(ssl: &SSL, mode: c_int, callback: SSL_verify_cb);
    fn SSL_set_session_id_context(ssl: &SSL, sid_ctx: *const u8, sid_ctx_len: usize) -> c_int;
    fn SSL_set_renegotiate_mode(ssl: &SSL, mode: RenegotiateMode);
    fn SSL_renegotiate(ssl: &SSL) -> c_int;
    fn SSL_total_renegotiations(ssl: &SSL) -> c_int;
    fn SSL_get_servername(ssl: *const SSL, ty: c_int) -> *const c_char;
    fn SSL_is_server(ssl: &SSL) -> c_int;
    fn SSL_version(ssl: &SSL) -> c_int;
    fn SSL_get_version(ssl: &SSL) -> CStrRef<'static>;
    fn SSL_get_negotiated_group(ssl: &SSL) -> c_int;
    fn SSL_set_max_send_fragment(ssl: &SSL, max_send_fragment: usize) -> c_int;
    fn SSL_session_reused(ssl: &SSL) -> c_int;
    fn SSL_get_client_random(ssl: &SSL, out: *mut u8, max_out: usize) -> usize;
    fn SSL_get_finished(ssl: &SSL, buf: *mut c_void, count: usize) -> usize;
    fn SSL_get_peer_finished(ssl: &SSL, buf: *mut c_void, count: usize) -> usize;
    fn SSL_export_keying_material(
        ssl: &SSL,
        out: *mut u8,
        out_len: usize,
        label: *const c_char,
        label_len: usize,
        context: *const u8,
        context_len: usize,
        use_context: c_int,
    ) -> c_int;
    fn SSL_get_current_cipher(ssl: &SSL) -> Option<&'static SSL_CIPHER>;
    fn SSL_CIPHER_get_name(cipher: &SSL_CIPHER) -> CStrRef<'static>;
    fn SSL_CIPHER_standard_name(cipher: &SSL_CIPHER) -> CStrRef<'static>;
    fn SSL_CIPHER_get_min_version(cipher: &SSL_CIPHER) -> u16;
    fn SSL_CIPHER_get_kx_nid(cipher: &SSL_CIPHER) -> c_int;
    fn SSL_get_certificate(ssl: &SSL) -> *mut X509;
    fn SSL_set_SSL_CTX(ssl: &SSL, ctx: &SSL_CTX) -> *mut SSL_CTX;
    fn SSL_use_certificate(ssl: &SSL, x509: *mut X509) -> c_int;
    fn SSL_use_PrivateKey(ssl: &SSL, pkey: *mut EVP_PKEY) -> c_int;
    fn SSL_set1_chain(ssl: &SSL, chain: *mut struct_stack_st_X509) -> c_int;
    fn SSL_CTX_get0_privatekey(ctx: &SSL_CTX) -> *mut EVP_PKEY;
    fn SSL_CTX_get0_chain_certs(ctx: &SSL_CTX, out: *mut *mut struct_stack_st_X509) -> c_int;
    pub fn SSL_CTX_set_default_verify_paths(ctx: *mut SSL_CTX) -> c_int;
    pub fn SSL_CTX_set_alpn_protos(
        ctx: *mut SSL_CTX,
        protos: *const u8,
        protos_len: usize,
    ) -> c_int;
    fn SSL_CTX_get_cert_store(ctx: &SSL_CTX) -> *mut X509_STORE;
    pub fn SSL_CTX_add1_chain_cert(ctx: &SSL_CTX, x509: &X509) -> c_int;
    pub fn SSL_CTX_clear_chain_certs(ctx: *mut SSL_CTX) -> c_int;
    fn PEM_read_bio_X509_AUX(
        bp: *mut BIO,
        x: *mut *mut X509,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut X509;
    fn OPENSSL_free(ptr: *mut c_void);
    pub fn SSL_CTX_get0_param(ctx: *mut SSL_CTX) -> *mut c_void;
    pub fn SSL_get_group_id(ssl: *const SSL) -> u16;
    /// Returns a static NUL-terminated string, or NULL if unknown.
    pub safe fn SSL_get_group_name(group_id: u16) -> *const c_char;
    pub fn X509_VERIFY_PARAM_set1_host(
        param: *mut c_void,
        name: *const c_char,
        namelen: usize,
    ) -> c_int;
    pub fn SSL_CTX_set_keylog_callback(
        ctx: *mut SSL_CTX,
        cb: Option<unsafe extern "C" fn(ssl: *const SSL, line: *const c_char)>,
    );
    pub fn SSL_CTX_set_early_data_enabled(ctx: *mut SSL_CTX, enabled: c_int);
    pub fn SSL_get_SSL_CTX(ssl: *const SSL) -> *mut SSL_CTX;
    fn SSL_set_tlsext_host_name(ssl: &SSL, name: *const c_char) -> c_int;
    fn SSL_set_alpn_protos(ssl: &SSL, protos: *const u8, protos_len: usize) -> c_int;
    pub fn SSL_get0_alpn_selected(ssl: *const SSL, out_data: *mut *const u8, out_len: *mut c_uint);
    fn SSL_enable_signed_cert_timestamps(ssl: &SSL);
    fn SSL_enable_ocsp_stapling(ssl: &SSL);
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
    fn BIO_free(bio: *mut BIO) -> c_int;
    fn BIO_new_mem_buf(buf: *const c_void, len: ossl_ssize_t) -> *mut BIO;
    pub safe fn BIO_get_new_index() -> c_int;
    pub fn BIO_meth_new(r#type: c_int, name: *const c_char) -> *mut BIO_METHOD;
    pub fn BIO_meth_set_write(
        method: *mut BIO_METHOD,
        write_func: Option<unsafe extern "C" fn(*mut BIO, *const c_char, c_int) -> c_int>,
    ) -> c_int;
    pub fn BIO_meth_set_read(
        method: *mut BIO_METHOD,
        read_func: Option<unsafe extern "C" fn(*mut BIO, *mut c_char, c_int) -> c_int>,
    ) -> c_int;
    pub fn BIO_meth_set_ctrl(
        method: *mut BIO_METHOD,
        ctrl_func: Option<unsafe extern "C" fn(*mut BIO, c_int, c_long, *mut c_void) -> c_long>,
    ) -> c_int;
    pub fn BIO_set_data(bio: *mut BIO, ptr: *mut c_void);
    pub fn BIO_get_data(bio: *mut BIO) -> *mut c_void;
    pub fn BIO_set_init(bio: *mut BIO, init: c_int);
    pub fn BIO_set_retry_read(bio: *mut BIO);
    pub fn BIO_clear_retry_flags(bio: *mut BIO);

    // ── RAND ─────────────────────────────────────────────────────────────
    /// Fills `buf[0..len]` from BoringSSL's thread-local CTR-DRBG and returns 1.
    /// In the event that sufficient random data can not be obtained, `abort`
    /// is called. See `rand_bytes` for the safe wrapper.
    pub(crate) fn RAND_bytes(buf: *mut u8, len: usize) -> c_int;

    // ── ERR ──────────────────────────────────────────────────────────────
    // Thread-local error queue — no pointer args, no preconditions.
    pub safe fn ERR_clear_error();
    pub safe fn ERR_get_error() -> u32;
    pub safe fn ERR_peek_last_error() -> u32;
    // `ERR_error_string_n` declared once in the crypto/err block above.
    pub safe fn ERR_lib_error_string(packed_error: u32) -> CStrRef<'static>;
    pub safe fn ERR_func_error_string(packed_error: u32) -> CStrRef<'static>;
    fn ERR_reason_error_string(packed_error: u32) -> *const c_char;

    // ── HMAC (streaming) ─────────────────────────────────────────────────
    // Write-only initialiser: reads nothing from `ctx`.
    pub safe fn HMAC_CTX_init(ctx: &mut MaybeUninit<HMAC_CTX>);
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
    fn PKCS5_PBKDF2_HMAC(
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
    fn RSA_free(rsa: *mut RSA);
    fn RSA_size(rsa: *const RSA) -> c_uint;
    fn RSA_public_encrypt(
        flen: usize,
        from: *const u8,
        to: *mut u8,
        rsa: &RSA,
        padding: c_int,
    ) -> c_int;
    fn PEM_read_bio_RSA_PUBKEY(
        bp: *mut BIO,
        x: *mut *mut RSA,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut RSA;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extern functions — TLS context/session setup for QUIC (node:quic)
// ═══════════════════════════════════════════════════════════════════════════

bun_opaque::sealed_handle! {
    /// `struct evp_pkey_st` (`typedef ... EVP_PKEY`).
    pub struct EVP_PKEY;
    /// `struct ssl_session_st` (`typedef ... SSL_SESSION`).
    pub struct SSL_SESSION;
}

/// `TLS1_2_VERSION` (`openssl/tls1.h`).
pub const TLS1_2_VERSION: u16 = 0x0303;
/// `TLS1_3_VERSION` (`openssl/tls1.h`).
pub const TLS1_3_VERSION: u16 = 0x0304;

unsafe extern "C" {
    pub safe fn TLS_method() -> *const SSL_METHOD;

    pub fn SSL_CTX_set_min_proto_version(ctx: *mut SSL_CTX, version: u16) -> c_int;
    pub fn SSL_CTX_set_max_proto_version(ctx: *mut SSL_CTX, version: u16) -> c_int;
    pub fn SSL_CTX_set_verify(ctx: *mut SSL_CTX, mode: c_int, callback: SSL_verify_cb);
    pub fn SSL_CTX_use_certificate(ctx: &SSL_CTX, x509: &X509) -> c_int;
    pub fn SSL_CTX_use_PrivateKey(ctx: &SSL_CTX, pkey: &EVP_PKEY) -> c_int;

    pub fn SSL_get_verify_result(ssl: *const SSL) -> c_long;

    /// Reads the next PEM block whose type is `expected_name` (e.g. `c"CERTIFICATE"`), skipping others, and
    /// returns its decoded (and, with `cb`, decrypted) payload without parsing it.
    pub fn PEM_bytes_read_bio(
        out_data: *mut *mut u8,
        out_len: *mut c_long,
        out_name: *mut *mut c_char,
        expected_name: *const c_char,
        bio: *mut BIO,
        cb: Option<pem_password_cb>,
        userdata: *mut c_void,
    ) -> c_int;
    fn CRYPTO_BUFFER_new(
        data: *const u8,
        len: usize,
        pool: *mut CRYPTO_BUFFER_POOL,
    ) -> *mut CRYPTO_BUFFER;
    fn CRYPTO_BUFFER_free(buf: *mut CRYPTO_BUFFER);
    /// oven-sh/boringssl: a set of DER certificates indexed by subject and parsed on first use. Takes a reference to
    /// each buffer; NULL if any cannot be indexed (see `X509_LAZY_CERT_SET_can_index`).
    pub fn X509_LAZY_CERT_SET_new(
        certs: *const *mut CRYPTO_BUFFER,
        num_certs: usize,
    ) -> *mut X509_LAZY_CERT_SET;
    pub fn X509_LAZY_CERT_SET_can_index(der: *const u8, len: usize) -> c_int;
    pub safe fn X509_get_default_cert_file() -> *const c_char;
    pub safe fn X509_get_default_cert_dir() -> *const c_char;
    fn PEM_read_bio_X509(
        bp: *mut BIO,
        x: *mut *mut X509,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut X509;
    fn PEM_read_bio_PrivateKey(
        bp: *mut BIO,
        x: *mut *mut EVP_PKEY,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut EVP_PKEY;
    fn EVP_PKEY_free(pkey: *mut EVP_PKEY);

    /// Returns a static NUL-terminated string, never NULL.
    pub safe fn X509_verify_cert_error_string(err: c_long) -> *const c_char;

    pub safe fn X509_STORE_add_cert(store: &X509_STORE, x509: &X509) -> c_int;
    pub safe fn X509_STORE_add_crl(store: &X509_STORE, crl: &X509_CRL) -> c_int;
    pub fn X509_STORE_set_flags(store: &X509_STORE, flags: c_ulong) -> c_int;
    fn X509_STORE_up_ref(store: *mut X509_STORE) -> c_int;
    fn X509_STORE_free(store: *mut X509_STORE);
    safe fn X509_STORE_CTX_new() -> *mut X509_STORE_CTX;
    fn X509_STORE_CTX_init(
        ctx: *mut X509_STORE_CTX,
        store: &X509_STORE,
        x509: *mut X509,
        chain: *mut struct_stack_st_X509,
    ) -> c_int;
    fn X509_STORE_CTX_free(ctx: *mut X509_STORE_CTX);
    /// Leaves `issuer` as it is when there is none.
    fn X509_STORE_CTX_get1_issuer(
        issuer: &mut Option<OwnedX509>,
        ctx: *mut X509_STORE_CTX,
        x: &X509,
    ) -> c_int;
    pub fn X509_VERIFY_PARAM_set_flags(param: *mut c_void, flags: c_ulong) -> c_int;
    fn X509_CRL_free(crl: *mut X509_CRL);
    fn PEM_read_bio_X509_CRL(
        bp: *mut BIO,
        x: *mut *mut X509_CRL,
        cb: Option<pem_password_cb>,
        u: *mut c_void,
    ) -> *mut X509_CRL;

    /// `None` when the peer sent no certificate.
    safe fn SSL_get_peer_certificate(ssl: &SSL) -> Option<OwnedX509>;
    /// Returns a BORROWED reference to the context's leaf certificate, or null.
    pub fn SSL_CTX_get0_certificate(ctx: *const SSL_CTX) -> *mut X509;

    fn SSL_set_session(ssl: &SSL, session: &SSL_SESSION) -> c_int;
    fn SSL_get1_session(ssl: &SSL) -> Option<OwnedSslSession>;
    fn SSL_SESSION_get0_ticket(session: &SSL_SESSION, ticket: *mut *const u8, len: *mut usize);
    safe fn SSL_SESSION_up_ref(session: &SSL_SESSION) -> c_int;
    fn SSL_SESSION_free(session: *mut SSL_SESSION);
    fn i2d_SSL_SESSION(session: &SSL_SESSION, outp: *mut *mut u8) -> c_int;
    fn d2i_SSL_SESSION(
        out: *mut *mut SSL_SESSION,
        inp: &mut *const u8,
        len: c_long,
    ) -> Option<OwnedSslSession>;
}
