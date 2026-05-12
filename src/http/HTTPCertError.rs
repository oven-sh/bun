use bun_core::ZStr;

pub struct HTTPCertError {
    pub error_no: i32,
    // TODO(port): CertificateInfo.deinit frees code/reason — ownership unclear
    // (borrowed in onHandshake, owned via dupeZ in CertificateInfo / http.zig:115).
    // May need owned NUL-terminated type (Box<ZStr> / ZString) instead of &'static.
    pub code: &'static ZStr,
    pub reason: &'static ZStr,
}

impl Default for HTTPCertError {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: ZStr::EMPTY,
            reason: ZStr::EMPTY,
        }
    }
}

impl HTTPCertError {
    /// Build from the uSockets verify-error struct delivered to `on_handshake`.
    ///
    /// Centralises the two `cstr → ZStr` upgrades so each handshake handler
    /// (outer-TLS in `HTTPContext::Handler::on_handshake`, inner-TLS in
    /// `ProxyTunnel::on_handshake`) doesn't repeat the raw deref.
    ///
    /// Mirrors http.zig: `reason` is gated on `code` being non-null (the
    /// uSockets API populates both together or neither).
    pub fn from_verify_error(ssl_error: bun_uws::us_bun_verify_error_t) -> Self {
        /// Borrow a NUL-terminated C string from uSockets as `&'static ZStr`.
        /// The string is owned by the long-lived SSL session and outlives the
        /// `on_handshake` dispatch; widened to `'static` to match the field
        /// type (see TODO above re: ownership).
        #[inline]
        fn zstr(p: *const core::ffi::c_char) -> &'static ZStr {
            // SAFETY (`bun_ptr::Interned`-style audit — Population A,
            // process-lifetime): `code` is uSockets'
            // `us_ssl_socket_verify_error_str` lookup into a static
            // string-literal table; `reason` is BoringSSL's
            // `X509_verify_cert_error_string`, which likewise returns a
            // pointer to a compile-time string literal (switch over
            // `X509_V_ERR_*`). Both are genuinely process-lifetime, so the
            // widen to `&'static ZStr` is sound. (`Interned` itself is
            // `[u8]`-only; `ZStr` keeps the open-coded widen but the owner is
            // now named per the `Interned::assume` contract.)
            unsafe { ZStr::from_c_ptr(p) }
        }
        Self {
            error_no: ssl_error.error_no,
            code: zstr(ssl_error.code),
            reason: if ssl_error.code.is_null() {
                ZStr::EMPTY
            } else {
                zstr(ssl_error.reason)
            },
        }
    }
}

// ported from: src/http/HTTPCertError.zig
