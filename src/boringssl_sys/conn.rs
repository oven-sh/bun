//! Safe per-connection `SSL` inspection and mutation for an established or
//! handshaking TLS socket (node:tls `TLSSocket` surface): sessions, ciphers,
//! Finished messages, keying material, peer-chain walks. Every raw call and
//! pointer round-trip lives here; callers see borrows and owned RAII values.

use core::ffi::{CStr, c_char, c_int, c_long, c_void};
use core::ptr::NonNull;

use crate::boringssl::*;
use crate::ctx::OwnedX509;

bun_opaque::opaque_ffi! {
    /// `struct ssl_cipher_st` (`typedef ... SSL_CIPHER`).
    pub struct SSL_CIPHER;
    /// `struct ec_key_st` (`typedef ... EC_KEY`).
    pub struct EC_KEY;
    /// `struct ec_group_st` (`typedef ... EC_GROUP`).
    pub struct EC_GROUP;
}

// evp.h key types (NID values)
pub const EVP_PKEY_RSA: c_int = 6;
pub const EVP_PKEY_RSA_PSS: c_int = 912;
pub const EVP_PKEY_DSA: c_int = 116;
pub const EVP_PKEY_EC: c_int = 408;
pub const EVP_PKEY_DH: c_int = 28;
pub const EVP_PKEY_X25519: c_int = 948;
pub const EVP_PKEY_X448: c_int = 961;

// obj_mac.h
pub const NID_ED25519: c_int = 949;
pub const NID_ED448: c_int = 960;
pub const NID_id_GostR3410_2001: c_int = 811;
pub const NID_id_GostR3410_2012_256: c_int = 979;
pub const NID_id_GostR3410_2012_512: c_int = 980;

// `&T` to an `opaque_ffi!` ZST is ABI-identical to a non-null pointer and
// carries no `dereferenceable`/`noalias` obligation, so functions whose only
// pointer arguments are such handles (plus scalars / `&mut` out-slots) are
// `safe fn`. The rest keep their raw signatures and are wrapped below.
unsafe extern "C" {
    safe fn SSL_get_version(ssl: &SSL) -> *const c_char;
    safe fn SSL_is_server(ssl: &SSL) -> c_int;
    safe fn SSL_set_max_send_fragment(ssl: &SSL, max_send_fragment: usize) -> c_int;
    fn SSL_get_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
    fn SSL_get_peer_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
    safe fn SSL_get_shared_sigalgs(
        ssl: &SSL,
        idx: c_int,
        psign: Option<&mut c_int>,
        phash: Option<&mut c_int>,
        psignhash: Option<&mut c_int>,
        rsig: Option<&mut u8>,
        rhash: Option<&mut u8>,
    ) -> c_int;
    fn SSL_export_keying_material(
        ssl: *mut SSL,
        out: *mut u8,
        out_len: usize,
        label: *const c_char,
        label_len: usize,
        context: *const u8,
        context_len: usize,
        use_context: c_int,
    ) -> c_int;
    safe fn SSL_session_reused(ssl: &SSL) -> c_int;
    safe fn SSL_get_privatekey(ssl: &SSL) -> *mut EVP_PKEY;
    safe fn SSL_get_session(ssl: &SSL) -> *mut SSL_SESSION;
    fn SSL_SESSION_free(session: *mut SSL_SESSION);
    fn SSL_SESSION_get0_ticket(
        session: *const SSL_SESSION,
        out_ticket: *mut *const u8,
        out_len: *mut usize,
    );
    fn i2d_SSL_SESSION(session: *mut SSL_SESSION, pp: *mut *mut u8) -> c_int;
    fn d2i_SSL_SESSION(
        a: *mut *mut SSL_SESSION,
        pp: *mut *const u8,
        length: c_long,
    ) -> *mut SSL_SESSION;
    safe fn SSL_get_current_cipher(ssl: &SSL) -> *const SSL_CIPHER;
    safe fn SSL_CIPHER_get_name(cipher: &SSL_CIPHER) -> *const c_char;
    safe fn SSL_CIPHER_standard_name(cipher: &SSL_CIPHER) -> *const c_char;
    safe fn SSL_CIPHER_get_version(cipher: &SSL_CIPHER) -> *const c_char;
    safe fn X509_up_ref(x: &X509) -> c_int;
    safe fn EVP_PKEY_id(pkey: &EVP_PKEY) -> c_int;
    safe fn EVP_PKEY_bits(pkey: &EVP_PKEY) -> c_int;
    safe fn EVP_PKEY_get0_EC_KEY(pkey: &EVP_PKEY) -> *mut EC_KEY;
    safe fn EC_KEY_get0_group(key: &EC_KEY) -> *const EC_GROUP;
    safe fn EC_GROUP_get_curve_name(group: &EC_GROUP) -> c_int;
    safe fn OBJ_nid2sn(nid: c_int) -> *const c_char;
    fn SSL_set_SSL_CTX(ssl: *mut SSL, ctx: *mut SSL_CTX) -> *mut SSL_CTX;
    safe fn SSL_CTX_get0_certificate(ctx: &SSL_CTX) -> *mut X509;
    safe fn SSL_CTX_get0_privatekey(ctx: &SSL_CTX) -> *mut EVP_PKEY;
    fn SSL_use_certificate(ssl: *mut SSL, x509: *mut X509) -> c_int;
    fn SSL_use_PrivateKey(ssl: *mut SSL, pkey: *mut EVP_PKEY) -> c_int;
    fn SSL_CTX_get0_chain_certs(
        ctx: *const SSL_CTX,
        out_chain: *mut *mut struct_stack_st_X509,
    ) -> c_int;
    fn SSL_set1_chain(ssl: *mut SSL, chain: *mut struct_stack_st_X509) -> c_int;
    fn X509_STORE_get0_objects(store: *mut X509_STORE) -> *mut c_void;
    fn OPENSSL_sk_num(sk: *const c_void) -> usize;
    safe fn X509_STORE_free(store: *mut X509_STORE);
    safe fn X509_STORE_CTX_new() -> *mut X509_STORE_CTX;
    fn X509_STORE_CTX_init(
        ctx: *mut X509_STORE_CTX,
        store: *mut X509_STORE,
        x509: *mut X509,
        chain: *mut struct_stack_st_X509,
    ) -> c_int;
    fn X509_STORE_CTX_free(ctx: *mut X509_STORE_CTX);
    fn X509_STORE_CTX_get1_issuer(
        issuer: *mut *mut X509,
        ctx: *mut X509_STORE_CTX,
        x: *mut X509,
    ) -> c_int;
    safe fn X509_check_issued(issuer: &X509, subject: &X509) -> c_int;
}

/// A static NUL-terminated string BoringSSL returned, or `None` for null.
fn static_cstr(p: *const c_char) -> Option<&'static CStr> {
    // SAFETY: every caller passes the result of a BoringSSL accessor
    // documented to return null or a pointer into static storage.
    (!p.is_null()).then(|| unsafe { CStr::from_ptr(p) })
}

/// `OBJ_nid2sn`: the short name of a NID, if it has one.
pub fn nid2sn(nid: c_int) -> Option<&'static CStr> {
    static_cstr(OBJ_nid2sn(nid))
}

/// `ERR_reason_error_string` for a packed error code.
pub fn err_reason_error_string(packed: u32) -> Option<&'static CStr> {
    static_cstr(ERR_reason_error_string(packed))
}

/// `ERR_func_error_string` for a packed error code.
pub fn err_func_error_string(packed: u32) -> Option<&'static CStr> {
    static_cstr(ERR_func_error_string(packed))
}

/// `ERR_lib_error_string` for a packed error code.
pub fn err_lib_error_string(packed: u32) -> Option<&'static CStr> {
    static_cstr(ERR_lib_error_string(packed))
}

impl X509 {
    /// Take another reference on this certificate.
    pub fn up_ref(&self) -> OwnedX509 {
        X509_up_ref(self);
        OwnedX509::from_raw(self.as_mut_ptr()).expect("non-null")
    }

    /// `X509_check_issued`: `X509_V_OK` (0) when `self` could have issued
    /// `subject`.
    pub fn check_issued(&self, subject: &X509) -> c_int {
        X509_check_issued(self, subject)
    }
}

impl OwnedX509 {
    /// Transfers the reference out; the caller must release it.
    pub fn into_raw(self) -> *mut X509 {
        core::mem::ManuallyDrop::new(self).as_mut_ptr()
    }
}

impl struct_stack_st_X509 {
    /// The `i`th certificate, borrowed from the stack.
    pub fn get(&self, i: usize) -> Option<&X509> {
        // SAFETY: `self` is a live stack; out-of-range reads return null.
        let p = unsafe { sk_X509_value(self, i) };
        (!p.is_null()).then(|| X509::opaque_ref(p))
    }
}

impl EVP_PKEY {
    /// `EVP_PKEY_id`.
    pub fn id(&self) -> c_int {
        EVP_PKEY_id(self)
    }

    /// `EVP_PKEY_bits`.
    pub fn bits(&self) -> c_int {
        EVP_PKEY_bits(self)
    }

    /// The curve NID of an EC key (`EVP_PKEY_get0_EC_KEY` →
    /// `EC_KEY_get0_group` → `EC_GROUP_get_curve_name`), if this is one.
    pub fn ec_curve_nid(&self) -> Option<c_int> {
        let key = EVP_PKEY_get0_EC_KEY(self);
        if key.is_null() {
            return None;
        }
        let group = EC_KEY_get0_group(EC_KEY::opaque_ref(key));
        if group.is_null() {
            return None;
        }
        Some(EC_GROUP_get_curve_name(EC_GROUP::opaque_ref(group)))
    }
}

impl SSL_CIPHER {
    /// `SSL_CIPHER_get_name`: the OpenSSL name.
    pub fn name(&self) -> Option<&'static CStr> {
        static_cstr(SSL_CIPHER_get_name(self))
    }

    /// `SSL_CIPHER_standard_name`: the RFC name.
    pub fn standard_name(&self) -> Option<&'static CStr> {
        static_cstr(SSL_CIPHER_standard_name(self))
    }

    /// `SSL_CIPHER_get_version`.
    pub fn version(&self) -> Option<&'static CStr> {
        static_cstr(SSL_CIPHER_get_version(self))
    }
}

/// An owned `SSL_SESSION` reference; `SSL_SESSION_free` on drop.
pub struct OwnedSslSession(NonNull<SSL_SESSION>);

impl OwnedSslSession {
    /// `d2i_SSL_SESSION`: parse a DER-encoded session.
    pub fn from_der(der: &[u8]) -> Option<Self> {
        let len = c_long::try_from(der.len()).ok()?;
        let mut p = der.as_ptr();
        // SAFETY: `p[..len]` is `der`, readable for the call.
        let session = unsafe { d2i_SSL_SESSION(core::ptr::null_mut(), &raw mut p, len) };
        NonNull::new(session).map(Self)
    }
}

impl core::ops::Deref for OwnedSslSession {
    type Target = SSL_SESSION;
    fn deref(&self) -> &SSL_SESSION {
        SSL_SESSION::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedSslSession {
    fn drop(&mut self) {
        // SAFETY: we own exactly one reference, released once.
        unsafe { SSL_SESSION_free(self.0.as_ptr()) }
    }
}

impl SSL_SESSION {
    /// `SSL_SESSION_get0_ticket`: the session ticket, borrowed from the
    /// session (empty when there is none).
    pub fn ticket(&self) -> &[u8] {
        let mut data: *const u8 = core::ptr::null();
        let mut len: usize = 0;
        // SAFETY: `self` is live; out-params are stack slots.
        unsafe { SSL_SESSION_get0_ticket(self, &raw mut data, &raw mut len) };
        if data.is_null() || len == 0 {
            return &[];
        }
        // SAFETY: BoringSSL returned `len` bytes owned by the session, which
        // outlive this borrow of it.
        unsafe { core::slice::from_raw_parts(data, len) }
    }

    /// `i2d_SSL_SESSION` length probe: the DER size, or `None` on error.
    pub fn der_len(&self) -> Option<usize> {
        // SAFETY: `self` is live; a null out-param requests only the size.
        let n = unsafe { i2d_SSL_SESSION(self.as_mut_ptr(), core::ptr::null_mut()) };
        usize::try_from(n).ok().filter(|&n| n > 0)
    }

    /// `i2d_SSL_SESSION` into `out`, which must be exactly
    /// [`der_len`](Self::der_len) bytes. Returns the bytes written.
    pub fn to_der_into(&self, out: &mut [u8]) -> usize {
        assert_eq!(Some(out.len()), self.der_len());
        let mut p = out.as_mut_ptr();
        // SAFETY: `self` is live; `out` has room for the full encoding
        // (asserted above), which is all `i2d` writes.
        let n = unsafe { i2d_SSL_SESSION(self.as_mut_ptr(), &raw mut p) };
        usize::try_from(n).unwrap_or(0)
    }
}

/// An owned `X509_STORE` reference; `X509_STORE_free` on drop.
pub struct OwnedX509Store(NonNull<X509_STORE>);

impl OwnedX509Store {
    /// Takes the +1 `raw` carries; `None` when `raw` is null.
    ///
    /// # Safety
    /// `raw` is null or an `X509_STORE` reference the caller owns.
    pub unsafe fn from_raw(raw: *mut X509_STORE) -> Option<Self> {
        NonNull::new(raw).map(Self)
    }
}

impl core::ops::Deref for OwnedX509Store {
    type Target = X509_STORE;
    fn deref(&self) -> &X509_STORE {
        X509_STORE::opaque_ref(self.0.as_ptr())
    }
}

impl Drop for OwnedX509Store {
    fn drop(&mut self) {
        X509_STORE_free(self.0.as_ptr())
    }
}

impl X509_STORE {
    /// Whether the store holds no objects (`X509_STORE_get0_objects` is
    /// empty).
    pub fn is_empty(&self) -> bool {
        // SAFETY: `self` is live; `get0_objects` borrows its object stack and
        // `OPENSSL_sk_num(NULL)` is 0.
        unsafe { OPENSSL_sk_num(X509_STORE_get0_objects(self.as_mut_ptr())) == 0 }
    }
}

/// An `X509_STORE_CTX` initialised against a store for issuer lookups;
/// freed on drop. Borrows the store for its lifetime.
pub struct X509StoreCtx<'a> {
    ctx: NonNull<X509_STORE_CTX>,
    _store: core::marker::PhantomData<&'a X509_STORE>,
}

impl<'a> X509StoreCtx<'a> {
    /// `X509_STORE_CTX_new` + `X509_STORE_CTX_init(store, NULL, NULL)`.
    pub fn new(store: &'a X509_STORE) -> Option<Self> {
        let ctx = NonNull::new(X509_STORE_CTX_new())?;
        let this = X509StoreCtx {
            ctx,
            _store: core::marker::PhantomData,
        };
        // SAFETY: fresh context; `store` is live for `'a`; no target/chain.
        let ok = unsafe {
            X509_STORE_CTX_init(
                ctx.as_ptr(),
                store.as_mut_ptr(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
            )
        };
        (ok == 1).then_some(this)
    }

    /// `X509_STORE_CTX_get1_issuer`: a certificate from the store that could
    /// have issued `subject`.
    pub fn get1_issuer(&mut self, subject: &X509) -> Option<OwnedX509> {
        let mut issuer: *mut X509 = core::ptr::null_mut();
        // SAFETY: initialised context; `subject` is live; on success `issuer`
        // is a +1 reference the guard owns.
        let rc = unsafe {
            X509_STORE_CTX_get1_issuer(&raw mut issuer, self.ctx.as_ptr(), subject.as_mut_ptr())
        };
        if rc <= 0 {
            return None;
        }
        OwnedX509::from_raw(issuer)
    }
}

impl Drop for X509StoreCtx<'_> {
    fn drop(&mut self) {
        // SAFETY: created by `X509_STORE_CTX_new`, freed once.
        unsafe { X509_STORE_CTX_free(self.ctx.as_ptr()) }
    }
}

impl SSL_CTX {
    /// `SSL_CTX_get_cert_store`, or `None` if the context has no store.
    pub fn cert_store_opt(&self) -> Option<&X509_STORE> {
        // SAFETY: `self` is live; the store is owned by the context for its
        // lifetime.
        let p = unsafe { SSL_CTX_get_cert_store(self) };
        (!p.is_null()).then(|| X509_STORE::opaque_ref(p))
    }
}

impl SSL {
    /// `SSL_get_version`: the negotiated protocol version's name.
    pub fn version_str(&self) -> Option<&'static CStr> {
        static_cstr(SSL_get_version(self))
    }

    /// `SSL_is_server`.
    pub fn is_server(&self) -> bool {
        SSL_is_server(self) != 0
    }

    /// `SSL_is_init_finished`: the handshake has completed.
    pub fn is_init_finished(&self) -> bool {
        // SAFETY: `self` is live; read-only.
        unsafe { SSL_is_init_finished(self) != 0 }
    }

    /// `SSL_session_reused`.
    pub fn session_reused(&self) -> bool {
        SSL_session_reused(self) == 1
    }

    /// `SSL_set_max_send_fragment`; `false` if out of range.
    pub fn set_max_send_fragment(&self, size: usize) -> bool {
        SSL_set_max_send_fragment(self, size) == 1
    }

    /// `SSL_renegotiate`; `false` on error (see the error queue).
    pub fn renegotiate(&self) -> bool {
        // SAFETY: `self` is live.
        unsafe { SSL_renegotiate(self.as_mut_ptr()) == 1 }
    }

    /// `SSL_set_renegotiate_mode`.
    pub fn set_renegotiate_mode(&self, mode: ssl_renegotiate_mode_t) {
        // SAFETY: `self` is live.
        unsafe { SSL_set_renegotiate_mode(self.as_mut_ptr(), mode) }
    }

    /// `SSL_set_verify`.
    pub fn set_verify(&self, mode: c_int, callback: SSL_verify_cb) {
        // SAFETY: `self` is live; the callback is stored opaquely.
        unsafe { SSL_set_verify(self.as_mut_ptr(), mode, callback) }
    }

    /// `SSL_get_SSL_CTX`: the context this connection was created from (or
    /// last retargeted to), which it keeps alive.
    pub fn ssl_ctx(&self) -> &SSL_CTX {
        // SAFETY: `self` is live; every SSL holds a reference on its SSL_CTX.
        SSL_CTX::opaque_ref(unsafe { SSL_get_SSL_CTX(self) })
    }

    /// `SSL_get_privatekey`: the local private key, borrowed from the SSL.
    pub fn private_key(&self) -> Option<&EVP_PKEY> {
        let p = SSL_get_privatekey(self);
        (!p.is_null()).then(|| EVP_PKEY::opaque_ref(p))
    }

    /// `SSL_get_current_cipher`.
    pub fn current_cipher(&self) -> Option<&SSL_CIPHER> {
        let p = SSL_get_current_cipher(self);
        (!p.is_null()).then(|| SSL_CIPHER::opaque_ref(p))
    }

    /// `SSL_get_session`: the session in use, borrowed from the SSL.
    pub fn session(&self) -> Option<&SSL_SESSION> {
        let p = SSL_get_session(self);
        (!p.is_null()).then(|| SSL_SESSION::opaque_ref(p))
    }

    /// `SSL_set_session` (takes its own reference); `false` on error.
    pub fn set_session(&self, session: &SSL_SESSION) -> bool {
        // SAFETY: both live; BoringSSL up-refs `session`.
        unsafe { SSL_set_session(self.as_mut_ptr(), session.as_mut_ptr()) == 1 }
    }

    /// `SSL_get_peer_cert_chain`: the chain the peer presented, borrowed
    /// from the SSL (includes the leaf on the client side only).
    pub fn peer_cert_chain(&self) -> Option<&struct_stack_st_X509> {
        // SAFETY: `self` is live; the chain is owned by the SSL and outlives
        // this borrow of it.
        let p = unsafe { SSL_get_peer_cert_chain(self) };
        (!p.is_null()).then(|| struct_stack_st_X509::opaque_ref(p))
    }

    /// Total number of signature algorithms shared with the peer
    /// (`SSL_get_shared_sigalgs` count probe).
    pub fn shared_sigalgs_count(&self) -> usize {
        usize::try_from(SSL_get_shared_sigalgs(
            self, 0, None, None, None, None, None,
        ))
        .unwrap_or(0)
    }

    /// `SSL_get_shared_sigalgs(idx)`: `(sign_nid, hash_nid)`.
    pub fn shared_sigalg(&self, idx: usize) -> (c_int, c_int) {
        let mut sign_nid: c_int = 0;
        let mut hash_nid: c_int = 0;
        SSL_get_shared_sigalgs(
            self,
            c_int::try_from(idx).unwrap_or(c_int::MAX),
            Some(&mut sign_nid),
            Some(&mut hash_nid),
            None,
            None,
            None,
        );
        (sign_nid, hash_nid)
    }

    /// `SSL_get_finished` into `out`; returns the full message length (which
    /// may exceed `out.len()` — only `out.len()` bytes are copied).
    pub fn get_finished(&self, out: &mut [u8]) -> usize {
        // A zero-length `out` still needs a non-null pointer (it reaches
        // memcpy), which an empty slice provides.
        // SAFETY: `self` is live; `out` is writable for its length.
        unsafe { SSL_get_finished(self, out.as_mut_ptr().cast(), out.len()) }
    }

    /// `SSL_get_peer_finished`; see [`get_finished`](Self::get_finished).
    pub fn get_peer_finished(&self, out: &mut [u8]) -> usize {
        // SAFETY: as for `get_finished`.
        unsafe { SSL_get_peer_finished(self, out.as_mut_ptr().cast(), out.len()) }
    }

    /// `SSL_export_keying_material` (RFC 5705) into all of `out`; `false` on
    /// error (see the error queue).
    pub fn export_keying_material(
        &self,
        out: &mut [u8],
        label: &[u8],
        context: Option<&[u8]>,
    ) -> bool {
        let (context_ptr, context_len, use_context) = match context {
            Some(c) => (c.as_ptr(), c.len(), 1),
            None => (core::ptr::null(), 0, 0),
        };
        // SAFETY: `self` is live; every buffer is valid for the length passed
        // alongside it (`context` is null only with `use_context == 0`).
        unsafe {
            SSL_export_keying_material(
                self.as_mut_ptr(),
                out.as_mut_ptr(),
                out.len(),
                label.as_ptr().cast(),
                label.len(),
                context_ptr,
                context_len,
                use_context,
            ) == 1
        }
    }

    /// Serve this connection's identity from `ctx`: `SSL_set_SSL_CTX` swaps
    /// the cert/key/chain used for the rest of the handshake (taking its own
    /// reference on `ctx`), and — because that alone stops retargeting the
    /// certificate once ClientHello processing has reached ALPN selection —
    /// the leaf certificate / private key / extra chain are applied directly
    /// too. `false` if applying them failed.
    pub fn set_key_cert_from(&self, ctx: &SSL_CTX) -> bool {
        // SAFETY: `self` and `ctx` are live; every `get0` result is borrowed
        // from `ctx` for the duration of these calls, and the `use`/`set1`
        // calls take their own references.
        unsafe {
            SSL_set_SSL_CTX(self.as_mut_ptr(), ctx.as_mut_ptr());
            let leaf = SSL_CTX_get0_certificate(ctx);
            let pkey = SSL_CTX_get0_privatekey(ctx);
            if leaf.is_null() || pkey.is_null() {
                return true;
            }
            let ok_cert = SSL_use_certificate(self.as_mut_ptr(), leaf);
            let ok_key = SSL_use_PrivateKey(self.as_mut_ptr(), pkey);
            let mut ok_chain = 1;
            let mut chain: *mut struct_stack_st_X509 = core::ptr::null_mut();
            if SSL_CTX_get0_chain_certs(ctx, &raw mut chain) == 1 && !chain.is_null() {
                ok_chain = SSL_set1_chain(self.as_mut_ptr(), chain);
            }
            ok_cert == 1 && ok_key == 1 && ok_chain == 1
        }
    }
}
