//! Safe `SSL_CTX` construction and `SSL` inspection for callers that build a
//! TLS context from PEM material (node:quic). Every raw call and pointer
//! round-trip lives here; callers see owned RAII values and borrows only.

use core::ffi::{CStr, c_char, c_int, c_long, c_uint, c_ulong, c_void};
use core::ptr::NonNull;

use crate::boringssl::*;

/// An owned `X509` reference; `X509_free` on drop.
pub struct OwnedX509(NonNull<X509>);

impl OwnedX509 {
    fn from_raw(raw: *mut X509) -> Option<Self> {
        NonNull::new(raw).map(Self)
    }
}

impl core::ops::Deref for OwnedX509 {
    type Target = X509;
    fn deref(&self) -> &X509 {
        X509::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedX509 {
    fn drop(&mut self) {
        // SAFETY: we own exactly one reference, released once.
        unsafe { X509_free(self.0.as_ptr()) }
    }
}

/// An owned `EVP_PKEY`; `EVP_PKEY_free` on drop.
pub struct OwnedEvpPkey(NonNull<EVP_PKEY>);

impl core::ops::Deref for OwnedEvpPkey {
    type Target = EVP_PKEY;
    fn deref(&self) -> &EVP_PKEY {
        EVP_PKEY::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedEvpPkey {
    fn drop(&mut self) {
        // SAFETY: we own exactly one reference, released once.
        unsafe { EVP_PKEY_free(self.0.as_ptr()) }
    }
}

/// An owned `X509_CRL`; `X509_CRL_free` on drop.
pub struct OwnedX509Crl(NonNull<X509_CRL>);

impl core::ops::Deref for OwnedX509Crl {
    type Target = X509_CRL;
    fn deref(&self) -> &X509_CRL {
        X509_CRL::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedX509Crl {
    fn drop(&mut self) {
        // SAFETY: we own exactly one reference, released once.
        unsafe { X509_CRL_free(self.0.as_ptr()) }
    }
}

/// An owned `STACK_OF(X509)` whose elements it also owns;
/// `sk_X509_pop_free(X509_free)` on drop.
pub struct OwnedX509Stack(NonNull<struct_stack_st_X509>);

impl OwnedX509Stack {
    /// Takes ownership of a stack (and its elements); `None` when null.
    ///
    /// # Safety
    /// `raw` must be null or a stack the caller owns and does not free itself.
    pub unsafe fn from_raw(raw: *mut struct_stack_st_X509) -> Option<Self> {
        NonNull::new(raw).map(Self)
    }

    /// The first (leaf) certificate.
    pub fn leaf(&self) -> Option<&X509> {
        // SAFETY: we own a live stack; a null element reads as `None`.
        let p = unsafe { sk_X509_value(self.0.as_ptr(), 0) };
        (!p.is_null()).then(|| X509::opaque_ref(p))
    }
}

impl Drop for OwnedX509Stack {
    fn drop(&mut self) {
        // SAFETY: we own the stack and its elements.
        unsafe { sk_X509_pop_free(self.0.as_ptr()) }
    }
}

/// A read-only memory BIO over a borrowed byte slice.
pub struct MemBio<'a> {
    bio: NonNull<BIO>,
    _bytes: core::marker::PhantomData<&'a [u8]>,
}

impl<'a> MemBio<'a> {
    pub fn new(bytes: &'a [u8]) -> Option<Self> {
        let len = ossl_ssize_t::try_from(bytes.len()).ok()?;
        // SAFETY: `bytes` is readable for `len` and outlives the BIO (`'a`).
        let bio = unsafe { BIO_new_mem_buf(bytes.as_ptr().cast(), len) };
        Some(MemBio {
            bio: NonNull::new(bio)?,
            _bytes: core::marker::PhantomData,
        })
    }

    /// `PEM_read_bio_X509_AUX`: the next certificate, honouring trust settings.
    pub fn read_pem_x509_aux(&mut self) -> Option<OwnedX509> {
        // SAFETY: live BIO; no out-slot, no password callback.
        OwnedX509::from_raw(unsafe {
            PEM_read_bio_X509_AUX(
                self.bio.as_ptr(),
                core::ptr::null_mut(),
                None,
                core::ptr::null_mut(),
            )
        })
    }

    /// `PEM_read_bio_X509`: the next certificate.
    pub fn read_pem_x509(&mut self) -> Option<OwnedX509> {
        // SAFETY: as above.
        OwnedX509::from_raw(unsafe {
            PEM_read_bio_X509(
                self.bio.as_ptr(),
                core::ptr::null_mut(),
                None,
                core::ptr::null_mut(),
            )
        })
    }

    /// `PEM_read_bio_PrivateKey`: the next private key.
    pub fn read_pem_private_key(&mut self) -> Option<OwnedEvpPkey> {
        // SAFETY: as above.
        let p = unsafe {
            PEM_read_bio_PrivateKey(
                self.bio.as_ptr(),
                core::ptr::null_mut(),
                None,
                core::ptr::null_mut(),
            )
        };
        NonNull::new(p).map(OwnedEvpPkey)
    }

    /// `PEM_read_bio_X509_CRL`: the next revocation list.
    pub fn read_pem_x509_crl(&mut self) -> Option<OwnedX509Crl> {
        // SAFETY: as above.
        let p = unsafe {
            PEM_read_bio_X509_CRL(
                self.bio.as_ptr(),
                core::ptr::null_mut(),
                None,
                core::ptr::null_mut(),
            )
        };
        NonNull::new(p).map(OwnedX509Crl)
    }
}

impl Drop for MemBio<'_> {
    fn drop(&mut self) {
        // SAFETY: created by `BIO_new_mem_buf`, freed once.
        unsafe { BIO_free(self.bio.as_ptr()) };
    }
}

impl X509 {
    /// DER encoding of this certificate.
    pub fn to_der(&self) -> Option<Vec<u8>> {
        let mut der: *mut u8 = core::ptr::null_mut();
        // SAFETY: `self` is live; `i2d_X509` allocates `der` on success.
        let len = unsafe { i2d_X509(self.as_mut_ptr(), &raw mut der) };
        let len = usize::try_from(len).ok().filter(|&n| n > 0)?;
        let der = NonNull::new(der)?;
        // SAFETY: `i2d_X509` returned `len` bytes at `der`, which we free below.
        let bytes = unsafe { core::slice::from_raw_parts(der.as_ptr(), len) }.to_vec();
        // SAFETY: allocated by `i2d_X509` (OPENSSL_malloc).
        unsafe { OPENSSL_free(der.as_ptr().cast()) };
        Some(bytes)
    }
}

impl X509_STORE {
    /// `X509_STORE_add_cert` (takes its own reference).
    pub fn add_cert(&self, cert: &X509) -> bool {
        // SAFETY: both live; the store up-refs `cert`.
        unsafe { X509_STORE_add_cert(self.as_mut_ptr(), cert.as_mut_ptr()) == 1 }
    }

    /// `X509_STORE_add_crl` (takes its own reference).
    pub fn add_crl(&self, crl: &X509_CRL) -> bool {
        // SAFETY: both live; the store up-refs `crl`.
        unsafe { X509_STORE_add_crl(self.as_mut_ptr(), crl.as_mut_ptr()) == 1 }
    }

    /// `X509_STORE_set_flags`.
    pub fn set_flags(&self, flags: c_ulong) -> bool {
        // SAFETY: `self` is live.
        unsafe { X509_STORE_set_flags(self.as_mut_ptr(), flags) == 1 }
    }
}

/// `X509_verify_cert_error_string`: the static description of a verify code.
pub fn verify_cert_error_string(code: c_long) -> &'static CStr {
    // SAFETY: returns a pointer to a static string for every input.
    unsafe { CStr::from_ptr(X509_verify_cert_error_string(code)) }
}

/// `SSL_get_group_name`: the static name of a TLS named group, if known.
pub fn group_name(group_id: u16) -> Option<&'static CStr> {
    // SAFETY: returns null or a pointer to a static string.
    let p = unsafe { SSL_get_group_name(group_id) };
    // SAFETY: as above.
    (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) })
}

unsafe extern "C" {
    safe fn SSL_early_data_accepted(ssl: &SSL) -> c_int;
    safe fn SSL_get_early_data_reason(ssl: &SSL) -> c_int;
    fn SSL_CTX_get_ex_new_index(
        argl: c_long,
        argp: *mut c_void,
        unused: *mut c_void,
        dup_unused: Option<unsafe extern "C" fn()>,
        free_func: Option<
            unsafe extern "C" fn(
                parent: *mut c_void,
                ptr: *mut c_void,
                ad: *mut CRYPTO_EX_DATA,
                index: c_int,
                argl: c_long,
                argp: *mut c_void,
            ),
        >,
    ) -> c_int;
    fn SSL_CTX_get_ex_data(ctx: *const SSL_CTX, idx: c_int) -> *mut c_void;
}

impl SSL {
    /// `SSL_early_data_accepted`.
    pub fn early_data_accepted(&self) -> bool {
        SSL_early_data_accepted(self) != 0
    }

    /// `SSL_get_early_data_reason` (`enum ssl_early_data_reason_t`).
    pub fn early_data_reason(&self) -> c_int {
        SSL_get_early_data_reason(self)
    }

    /// `SSL_get0_alpn_selected`: the negotiated protocol, if any.
    pub fn alpn_selected(&self) -> Option<&[u8]> {
        let mut data: *const u8 = core::ptr::null();
        let mut len: c_uint = 0;
        // SAFETY: `self` is live; out-params are stack slots.
        unsafe { SSL_get0_alpn_selected(self, &raw mut data, &raw mut len) };
        if data.is_null() || len == 0 {
            return None;
        }
        // SAFETY: BoringSSL returns `len` bytes owned by the SSL, which
        // outlive this borrow of it.
        Some(unsafe { core::slice::from_raw_parts(data, len as usize) })
    }

    /// `SSL_get_verify_result`.
    pub fn verify_result(&self) -> c_long {
        // SAFETY: `self` is live; read-only.
        unsafe { SSL_get_verify_result(self) }
    }

    /// `SSL_get_group_id`: the negotiated named group, or 0.
    pub fn group_id(&self) -> u16 {
        // SAFETY: `self` is live; read-only.
        unsafe { SSL_get_group_id(self) }
    }

    /// `SSL_get_certificate`: the local certificate, borrowed from the SSL.
    pub fn certificate(&self) -> Option<&X509> {
        // SAFETY: `self` is live; the certificate is owned by the SSL and
        // outlives this borrow of it.
        let p = unsafe { SSL_get_certificate(self) };
        (!p.is_null()).then(|| X509::opaque_ref(p))
    }

    /// `SSL_get_peer_certificate`: a new reference to the peer's certificate.
    pub fn peer_certificate(&self) -> Option<OwnedX509> {
        // SAFETY: `self` is live; the returned +1 is owned by the guard.
        OwnedX509::from_raw(unsafe { SSL_get_peer_certificate(self) })
    }
}

/// `SSL_CTX_set_keylog_callback` handler, with the pointer plumbing done once
/// in this crate.
pub trait KeylogCallback {
    /// `line` is one NSS key log line (no trailing newline).
    fn log(ssl: &SSL, line: &[u8]);
}

unsafe extern "C" fn keylog_thunk<H: KeylogCallback>(ssl: *const SSL, line: *const c_char) {
    if ssl.is_null() || line.is_null() {
        return;
    }
    // SAFETY: BoringSSL passes the live SSL and a NUL-terminated line valid
    // for this call.
    let (ssl, line) = unsafe { (SSL::opaque_ref(ssl), CStr::from_ptr(line)) };
    H::log(ssl, line.to_bytes());
}

/// `SSL_CTX` ex-data slot holding the wire-format ALPN preference list that
/// [`SSL_CTX::set_alpn_select_from`] installed. Freed with the context.
fn alpn_prefs_index() -> Option<c_int> {
    static INDEX: std::sync::OnceLock<Option<c_int>> = std::sync::OnceLock::new();
    unsafe extern "C" fn free_prefs(
        _parent: *mut c_void,
        ptr: *mut c_void,
        _ad: *mut CRYPTO_EX_DATA,
        _index: c_int,
        _argl: c_long,
        _argp: *mut c_void,
    ) {
        if !ptr.is_null() {
            // SAFETY: the only writer of this slot is `set_alpn_select_from`,
            // which stores a `Box<Box<[u8]>>::into_raw`.
            drop(unsafe { Box::from_raw(ptr.cast::<Box<[u8]>>()) });
        }
    }
    *INDEX.get_or_init(|| {
        // SAFETY: no argp/dup; `free_prefs` matches `CRYPTO_EX_free`.
        let i = unsafe {
            SSL_CTX_get_ex_new_index(
                0,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                None,
                Some(free_prefs),
            )
        };
        (i >= 0).then_some(i)
    })
}

unsafe extern "C" fn alpn_select_from_prefs(
    ssl: *mut SSL,
    out: *mut *const u8,
    out_len: *mut u8,
    in_: *const u8,
    in_len: c_uint,
    _arg: *mut c_void,
) -> c_int {
    if ssl.is_null() {
        return SSL_TLSEXT_ERR_NOACK;
    }
    // SAFETY: `ssl` is the live handshaking SSL; its SSL_CTX is live with it,
    // and the slot holds null or the `Box<[u8]>` `set_alpn_select_from` stored.
    let prefs = unsafe {
        let ctx = SSL_get_SSL_CTX(ssl);
        if ctx.is_null() {
            return SSL_TLSEXT_ERR_NOACK;
        }
        let Some(index) = alpn_prefs_index() else {
            return SSL_TLSEXT_ERR_NOACK;
        };
        let p = SSL_CTX_get_ex_data(ctx, index).cast::<Box<[u8]>>();
        if p.is_null() {
            return SSL_TLSEXT_ERR_NOACK;
        }
        &**p
    };
    // SAFETY: `in_[..in_len]` is the client's protocol list for this call and
    // `out`/`out_len` are BoringSSL's out-params. On NEGOTIATED the selection
    // points into `prefs`, which the SSL_CTX ex_data slot owns for the
    // context's lifetime; on NO_OVERLAP `*out` would point into `in_`, but we
    // return ALERT_FATAL so BoringSSL never reads it.
    unsafe {
        if SSL_select_next_proto(
            out.cast::<*mut u8>(),
            out_len,
            prefs.as_ptr(),
            prefs.len() as c_uint,
            in_,
            in_len,
        ) == OPENSSL_NPN_NEGOTIATED
        {
            SSL_TLSEXT_ERR_OK
        } else {
            SSL_TLSEXT_ERR_ALERT_FATAL
        }
    }
}

impl OwnedSslCtx {
    /// `SSL_CTX_new(TLS_method())`.
    pub fn new_tls() -> Option<Self> {
        // SAFETY: `TLS_method()` is a static method table; the +1 from
        // `SSL_CTX_new` is owned by the guard.
        unsafe { Self::from_raw(SSL_CTX_new(TLS_method())) }
    }
}

impl core::ops::Deref for OwnedSslCtx {
    type Target = SSL_CTX;
    fn deref(&self) -> &SSL_CTX {
        SSL_CTX::opaque_ref(self.as_ptr())
    }
}

impl SSL_CTX {
    /// `SSL_CTX_set_compliance_policy`.
    pub fn set_compliance_policy(&self, policy: c_int) -> bool {
        // SAFETY: `self` is live.
        unsafe { SSL_CTX_set_compliance_policy(self.as_mut_ptr(), policy) == 1 }
    }

    /// `SSL_CTX_set_min_proto_version` + `SSL_CTX_set_max_proto_version`.
    pub fn set_proto_version_range(&self, min: u16, max: u16) -> bool {
        // SAFETY: `self` is live.
        unsafe {
            SSL_CTX_set_min_proto_version(self.as_mut_ptr(), min) == 1
                && SSL_CTX_set_max_proto_version(self.as_mut_ptr(), max) == 1
        }
    }

    /// `SSL_CTX_set1_groups_list`.
    pub fn set1_groups_list(&self, groups: &CStr) -> bool {
        // SAFETY: `self` is live; `groups` is NUL-terminated and copied.
        unsafe { SSL_CTX_set1_groups_list(self.as_mut_ptr(), groups.as_ptr()) == 1 }
    }

    /// `SSL_CTX_set_default_verify_paths`.
    pub fn set_default_verify_paths(&self) -> bool {
        // SAFETY: `self` is live.
        unsafe { SSL_CTX_set_default_verify_paths(self.as_mut_ptr()) == 1 }
    }

    /// `SSL_CTX_clear_chain_certs`.
    pub fn clear_chain_certs(&self) -> bool {
        // SAFETY: `self` is live.
        unsafe { SSL_CTX_clear_chain_certs(self.as_mut_ptr()) == 1 }
    }

    /// `SSL_CTX_use_certificate` (takes its own reference on `cert`).
    pub fn use_certificate(&self, cert: &X509) -> bool {
        // SAFETY: both live; the context up-refs `cert`.
        unsafe { SSL_CTX_use_certificate(self.as_mut_ptr(), cert.as_mut_ptr()) == 1 }
    }

    /// `SSL_CTX_add0_chain_cert`: the context takes ownership of `cert` on
    /// success; on failure it is handed back.
    pub fn add0_chain_cert(&self, cert: OwnedX509) -> Result<(), OwnedX509> {
        let cert = core::mem::ManuallyDrop::new(cert);
        // SAFETY: both live; on success ownership of the +1 moves to the
        // context, so the guard must not free it.
        if unsafe { SSL_CTX_add0_chain_cert(self.as_mut_ptr(), cert.0.as_ptr()) } == 1 {
            Ok(())
        } else {
            Err(core::mem::ManuallyDrop::into_inner(cert))
        }
    }

    /// `SSL_CTX_use_PrivateKey` (takes its own reference on `key`).
    pub fn use_private_key(&self, key: &EVP_PKEY) -> bool {
        // SAFETY: both live; the context up-refs `key`.
        unsafe { SSL_CTX_use_PrivateKey(self.as_mut_ptr(), key.as_mut_ptr()) == 1 }
    }

    /// `SSL_CTX_get_cert_store`: the context's trust store, owned by it.
    pub fn cert_store(&self) -> &X509_STORE {
        // SAFETY: `self` is live; every SSL_CTX has a store, which it owns
        // for its lifetime.
        X509_STORE::opaque_ref(unsafe { SSL_CTX_get_cert_store(self) })
    }

    /// `SSL_CTX_set_early_data_enabled`.
    pub fn set_early_data_enabled(&self, enabled: bool) {
        // SAFETY: `self` is live.
        unsafe { SSL_CTX_set_early_data_enabled(self.as_mut_ptr(), enabled as c_int) }
    }

    /// Install `H` as this context's key log hook (`SSL_CTX_set_keylog_callback`).
    pub fn set_keylog_callback<H: KeylogCallback>(&self) {
        // SAFETY: `self` is live; the callback is stored opaquely.
        unsafe { SSL_CTX_set_keylog_callback(self.as_mut_ptr(), Some(keylog_thunk::<H>)) }
    }

    /// `SSL_CTX_set_verify` with no callback.
    pub fn set_verify_mode(&self, mode: c_int) {
        // SAFETY: `self` is live.
        unsafe { SSL_CTX_set_verify(self.as_mut_ptr(), mode, None) }
    }

    /// `SSL_CTX_set_alpn_protos`: the client's wire-format ALPN list
    /// (copied). Returns whether BoringSSL accepted it.
    pub fn set_alpn_protos(&self, protos: &[u8]) -> bool {
        // SAFETY: `self` is live; `protos` is readable for its length and copied.
        unsafe { SSL_CTX_set_alpn_protos(self.as_mut_ptr(), protos.as_ptr(), protos.len()) == 0 }
    }

    /// Server-side ALPN: answer each ClientHello with the first entry of
    /// `prefs` (wire format, preference order) the client also offers, and a
    /// fatal `no_application_protocol` alert when none match. The list is
    /// copied into the context and freed with it.
    pub fn set_alpn_select_from(&self, prefs: &[u8]) -> bool {
        if c_uint::try_from(prefs.len()).is_err() {
            return false;
        }
        let Some(index) = alpn_prefs_index() else {
            return false;
        };
        let boxed: Box<Box<[u8]>> = Box::new(prefs.into());
        // SAFETY: `self` is live. The slot's previous value (if any) was
        // stored by this function and is freed here before being replaced;
        // the new value is freed by the slot's `free_func` with the context.
        unsafe {
            let prev = SSL_CTX_get_ex_data(self, index).cast::<Box<[u8]>>();
            let raw = Box::into_raw(boxed);
            if SSL_CTX_set_ex_data(self.as_mut_ptr(), index, raw.cast()) != 1 {
                drop(Box::from_raw(raw));
                return false;
            }
            if !prev.is_null() {
                drop(Box::from_raw(prev));
            }
            SSL_CTX_set_alpn_select_cb(
                self.as_mut_ptr(),
                Some(alpn_select_from_prefs),
                core::ptr::null_mut(),
            );
        }
        true
    }

    /// `X509_VERIFY_PARAM_set_flags` on the context's verify parameters.
    pub fn set_verify_flags(&self, flags: c_ulong) -> bool {
        // SAFETY: `self` is live; its param block lives with it.
        unsafe {
            let param = SSL_CTX_get0_param(self.as_mut_ptr());
            !param.is_null() && X509_VERIFY_PARAM_set_flags(param, flags) == 1
        }
    }

    /// `X509_VERIFY_PARAM_set1_host` on the context's verify parameters: the
    /// name peer certificates must match. `false` for an empty `host` (which
    /// BoringSSL would read as "clear the check") or on failure.
    pub fn set1_verify_host(&self, host: &[u8]) -> bool {
        if host.is_empty() {
            return false;
        }
        // SAFETY: `self` is live; its param block lives with it; `host` is
        // non-empty, readable for its length, and copied.
        unsafe {
            let param = SSL_CTX_get0_param(self.as_mut_ptr());
            !param.is_null()
                && X509_VERIFY_PARAM_set1_host(param, host.as_ptr().cast(), host.len()) == 1
        }
    }
}
