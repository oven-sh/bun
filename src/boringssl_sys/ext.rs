//! Bun-specific additions layered over the upstream `bssl-sys` bindgen output:
//! RAII owners, typed-stack helpers, and name/type aliases that keep downstream
//! crates source-compatible with the previous hand-rolled surface.

use core::ffi::{c_int, c_void};

use bssl_sys::{
    ASN1_STRING_get0_data, ASN1_STRING_length, GEN_DNS, GEN_IPADD, GEN_URI, GENERAL_NAME,
    GENERAL_NAMES_free, NID_commonName, NID_subject_alt_name, SSL, SSL_CTX, SSL_CTX_free,
    SSL_get_peer_cert_chain, X509, X509_NAME, X509_NAME_ENTRY_get_data, X509_NAME_get_entry,
    X509_NAME_get_index_by_NID, X509_STORE_CTX, X509_get_ext, X509_get_ext_by_NID,
    X509_get_subject_name, X509V3_EXT_d2i, X509V3_EXT_get, asn1_string_st, sk_GENERAL_NAME_num,
    sk_GENERAL_NAME_value, sk_X509_value, stack_st_GENERAL_NAME,
};

/// bindgen prefixes C enum constants with the enum type name.
pub const ssl_renegotiate_never: bssl_sys::ssl_renegotiate_mode_t =
    bssl_sys::ssl_renegotiate_mode_t_ssl_renegotiate_never;
pub const ssl_renegotiate_explicit: bssl_sys::ssl_renegotiate_mode_t =
    bssl_sys::ssl_renegotiate_mode_t_ssl_renegotiate_explicit;

/// `int (*SSL_verify_cb)(int, X509_STORE_CTX *)` — not a typedef in the C
/// headers, so bindgen emits nothing. Matches the callback type
/// `SSL_set_verify`/`SSL_CTX_set_verify` take.
pub type SSL_verify_cb = Option<unsafe extern "C" fn(c_int, *mut X509_STORE_CTX) -> c_int>;

// ═══════════════════════════════════════════════════════════════════════════
// opaque_ref / opaque_mut on the handle types Bun passes by reference
//
// `bssl_sys`'s `{ _unused: [u8; 0] }` body is a ZST, so `&T` carries
// `dereferenceable(0)` and the `readonly`/`noalias` attributes constrain zero
// bytes — making the `*const T → &T` reborrow sound via `bun_opaque`'s
// null-checked helpers. An extension trait is used because inherent impls
// cannot be added to types defined in another crate.
// ═══════════════════════════════════════════════════════════════════════════

/// Extension methods for `bssl_sys` opaque handle types (ZST `{ _unused: [u8; 0] }`).
pub trait BsslOpaqueExt: Sized {
    /// `*const Self → &Self`; panics on null.
    #[inline(always)]
    fn opaque_ref<'a>(p: *const Self) -> &'a Self {
        bun_opaque::opaque_deref(p)
    }
    /// `*mut Self → &mut Self`; panics on null.
    #[inline(always)]
    fn opaque_mut<'a>(p: *mut Self) -> &'a mut Self {
        bun_opaque::opaque_deref_mut(p)
    }
}

impl BsslOpaqueExt for bssl_sys::ssl_st {}
impl BsslOpaqueExt for bssl_sys::ssl_ctx_st {}
impl BsslOpaqueExt for bssl_sys::x509_st {}
impl BsslOpaqueExt for bssl_sys::stack_st_X509 {}

// ═══════════════════════════════════════════════════════════════════════════
// Constant-time comparison
// ═══════════════════════════════════════════════════════════════════════════

/// Constant-time byte-slice equality via BoringSSL `CRYPTO_memcmp`.
///
/// Returns `false` when lengths differ (the length comparison itself is NOT
/// constant-time — matches all existing call sites, which already early-out on len).
#[inline]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    bssl_crypto::constant_time_compare(a, b)
}

// ═══════════════════════════════════════════════════════════════════════════
// RAND
// ═══════════════════════════════════════════════════════════════════════════

/// Fill `buf` with cryptographically-secure random bytes via BoringSSL `RAND_bytes`.
///
/// BoringSSL's `RAND_bytes` is a thread-local AES-CTR DRBG seeded once from the
/// OS entropy source and then run entirely in userspace, so this does not incur
/// a syscall per call. This is the CSPRNG for all of Bun.
#[inline]
pub fn rand_bytes(buf: &mut [u8]) {
    if buf.is_empty() {
        return;
    }
    // SAFETY: `buf` is a valid writable slice of `buf.len()` bytes. BoringSSL's
    // `RAND_bytes` always returns 1 (it `abort()`s on failure).
    unsafe {
        bssl_sys::RAND_bytes(buf.as_mut_ptr(), buf.len());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// RAII owners
// ═══════════════════════════════════════════════════════════════════════════

/// Owns one `SSL_CTX` reference; `SSL_CTX_free`s it on drop. Construct from a
/// pointer that already carries a +1 (`SSL_CTX_new`, `SSL_CTX_up_ref`).
pub struct OwnedSslCtx(core::ptr::NonNull<SSL_CTX>);

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

impl Drop for OwnedSslCtx {
    fn drop(&mut self) {
        // SAFETY: we own exactly one reference, released once.
        unsafe { SSL_CTX_free(self.0.as_ptr()) }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GeneralNames — owned STACK_OF(GENERAL_NAME) from X509V3_EXT_d2i
// ═══════════════════════════════════════════════════════════════════════════

/// Owns the `STACK_OF(GENERAL_NAME)` that `X509V3_EXT_d2i` returns for a
/// subjectAltName extension. Frees every `GENERAL_NAME` and then the stack.
pub struct GeneralNames(core::ptr::NonNull<stack_st_GENERAL_NAME>);

impl GeneralNames {
    /// Takes ownership of a `STACK_OF(GENERAL_NAME)`; `None` when `raw` is null.
    ///
    /// # Safety
    /// `raw` must be null or a stack the caller owns and does not free itself.
    pub unsafe fn from_raw(raw: *mut c_void) -> Option<Self> {
        core::ptr::NonNull::new(raw.cast::<stack_st_GENERAL_NAME>()).map(Self)
    }

    pub fn len(&self) -> usize {
        // SAFETY: we own a live stack.
        unsafe { sk_GENERAL_NAME_num(self.0.as_ptr()) }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Borrows the `i`th entry; `None` past the end.
    pub fn get(&self, i: usize) -> Option<&GENERAL_NAME> {
        if i >= self.len() {
            return None;
        }
        // SAFETY: `i` is in bounds and the stack outlives the borrow, which is
        // tied to `&self`. BoringSSL owns the element until our `Drop`.
        unsafe { sk_GENERAL_NAME_value(self.0.as_ptr(), i).as_ref() }
    }

    pub fn iter(&self) -> impl Iterator<Item = &GENERAL_NAME> {
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
            // contract requires a stack BoringSSL produced, so `type_` selects
            // the live union arm and the ASN1 string's `data` is readable for
            // `length` bytes for the stack's lifetime.
            unsafe {
                let string: &asn1_string_st = match name.type_ {
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
                Some(match name.type_ {
                    GEN_DNS => SubjectAltName::Dns(bytes),
                    GEN_IPADD => SubjectAltName::Ip(bytes),
                    _ => SubjectAltName::Uri(bytes),
                })
            }
        })
    }
}

impl Drop for GeneralNames {
    fn drop(&mut self) {
        // SAFETY: we own the stack; `GENERAL_NAMES_free` frees each element
        // and then the stack itself.
        unsafe { GENERAL_NAMES_free(self.0.as_ptr()) }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// X509 / SSL extension methods
// ═══════════════════════════════════════════════════════════════════════════

/// The certificate's subjectAltName extension.
pub enum SanLookup {
    Absent,
    /// Present but not decodable as subjectAltName.
    Invalid,
    Names(GeneralNames),
}

/// Extension methods on `bssl_sys::X509` (= `x509_st`).
pub trait BsslX509Ext {
    /// This certificate's subjectAltName extension.
    fn subject_alt_names(&mut self) -> SanLookup;
    /// Iterates this certificate's Subject Common Names in order.
    fn common_names(&mut self) -> CommonNames<'_>;
}

impl BsslX509Ext for X509 {
    fn subject_alt_names(&mut self) -> SanLookup {
        // SAFETY: `self` is a live certificate (opaque, only obtainable from
        // BoringSSL); `X509V3_EXT_d2i` returns a freshly allocated stack that
        // `GeneralNames::from_raw` then owns and frees.
        unsafe {
            let x509: *mut X509 = self;
            let index = X509_get_ext_by_NID(x509, NID_subject_alt_name, -1);
            if index < 0 {
                return SanLookup::Absent;
            }
            let Some(ext) = X509_get_ext(x509, index).as_mut() else {
                return SanLookup::Absent;
            };
            if X509V3_EXT_get(ext) != crate::X509V3_EXT_get_nid(NID_subject_alt_name) {
                return SanLookup::Invalid;
            }
            match GeneralNames::from_raw(X509V3_EXT_d2i(ext)) {
                Some(names) => SanLookup::Names(names),
                None => SanLookup::Absent,
            }
        }
    }

    fn common_names(&mut self) -> CommonNames<'_> {
        // SAFETY: `self` is a live certificate; a null subject yields an
        // empty iterator.
        let subject = unsafe { X509_get_subject_name(self) };
        CommonNames {
            subject,
            last: -1,
            _cert: core::marker::PhantomData,
        }
    }
}

/// Borrowing iterator over a certificate's Subject Common Names.
pub struct CommonNames<'a> {
    subject: *mut X509_NAME,
    last: c_int,
    _cert: core::marker::PhantomData<&'a mut X509>,
}

impl<'a> Iterator for CommonNames<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        if self.subject.is_null() {
            return None;
        }
        // SAFETY: the subject and its entries are owned by the certificate
        // borrowed for `'a`; every accessor is guarded against null returns
        // and non-positive lengths.
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
                let cn_ptr = ASN1_STRING_get0_data(data);
                let cn_len = ASN1_STRING_length(data);
                if cn_ptr.is_null() || cn_len <= 0 {
                    continue;
                }
                return Some(core::slice::from_raw_parts(
                    cn_ptr,
                    usize::try_from(cn_len).expect("int cast"),
                ));
            }
        }
    }
}

/// Extension methods on `bssl_sys::SSL` (= `ssl_st`).
pub trait BsslSslExt {
    /// The peer's leaf certificate, borrowed from this SSL's cert chain.
    fn peer_leaf_certificate(&mut self) -> Option<&mut X509>;
}

impl BsslSslExt for SSL {
    fn peer_leaf_certificate(&mut self) -> Option<&mut X509> {
        // SAFETY: the chain and its entries are owned by this SSL and outlive
        // the returned borrow, which is tied to `&mut self`.
        unsafe {
            let cert_chain = SSL_get_peer_cert_chain(self);
            if cert_chain.is_null() {
                return None;
            }
            sk_X509_value(cert_chain, 0).as_mut()
        }
    }
}
