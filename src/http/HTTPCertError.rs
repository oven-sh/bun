use bun_core::ZStr;

pub struct HTTPCertError {
    pub error_no: i32,
    // `code`/`reason` borrow process-lifetime static string tables (uSockets'
    // verify-error strings and BoringSSL's `X509_verify_cert_error_string`
    // literals — see the SAFETY note in `from_verify_error`), so nothing owns
    // or frees them here.
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

/// Owned copy of the uSockets handshake-failure sentinel (`error_no < 0`):
/// `-71`/"EPROTO" for a fatal TLS protocol error (`ssl_dispatch_parked_reason`,
/// `reason` is the `ERR_error_string_n` output) or `-46`/"ECONNRESET" for a
/// mid-handshake close (`ssl_trigger_handshake_econnreset`), both in
/// packages/bun-usockets/src/crypto/openssl.c. The `reason` pointer is a stack
/// buffer in the EPROTO case, so an owned copy is required to outlive
/// `on_handshake`. Carried on `HTTPClientResult` so `fetch()` can report the
/// OpenSSL reason (e.g. `WRONG_VERSION_NUMBER`) instead of a certificate
/// verification error.
#[derive(Clone, Default)]
pub struct TLSHandshakeError {
    pub code: Box<[u8]>,
    pub reason: Box<[u8]>,
}

impl TLSHandshakeError {
    /// Capture the code/reason from a handshake-failure sentinel. Only call
    /// when `error_no < 0`; X509 verify errors use [`HTTPCertError`].
    pub fn from_verify_error(ssl_error: &bun_uws::us_bun_verify_error_t) -> Self {
        Self {
            code: Box::from(ssl_error.code_bytes()),
            reason: Box::from(ssl_error.reason_bytes()),
        }
    }

    /// Node-style error code for the JS `Error.code` property: for an EPROTO
    /// sentinel whose `reason` carries an OpenSSL reason string, derive
    /// `ERR_SSL_<REASON>` the way Node's `ThrowCryptoError` does; otherwise
    /// fall back to the sentinel's own code (`EPROTO`/`ECONNRESET`). The
    /// `reason` may be either the full `ERR_error_string_n` line
    /// (`error:<hex>:<lib>:<func>:<REASON>`, direct path via
    /// `ssl_dispatch_parked_reason`) or the bare `ERR_reason_error_string`
    /// output (`<REASON>` only, inner-TLS path via `SSLWrapper`); both reduce
    /// to the last `:`-separated segment, which BoringSSL emits upper-snake.
    pub fn node_error_code(&self) -> Box<[u8]> {
        if &*self.code == b"EPROTO" {
            let reason = self
                .reason
                .rsplit(|&b| b == b':')
                .next()
                .unwrap_or(&self.reason);
            if !reason.is_empty()
                && reason
                    .iter()
                    .all(|&b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            {
                const PREFIX: &[u8] = b"ERR_SSL_";
                let mut code = Vec::with_capacity(PREFIX.len() + reason.len());
                code.extend_from_slice(PREFIX);
                code.extend_from_slice(reason);
                return code.into_boxed_slice();
            }
        }
        if self.code.is_empty() {
            return Box::from(&b"EPROTO"[..]);
        }
        self.code.clone()
    }
}

impl HTTPCertError {
    /// Build from the uSockets verify-error struct delivered to `on_handshake`.
    ///
    /// Centralises the two `cstr → ZStr` upgrades so each handshake handler
    /// (outer-TLS in `HTTPContext::Handler::on_handshake`, inner-TLS in
    /// `ProxyTunnel::on_handshake`) doesn't repeat the raw deref.
    ///
    /// `reason` is gated on `code` being non-null (the
    /// uSockets API populates both together or neither).
    pub fn from_verify_error(ssl_error: bun_uws::us_bun_verify_error_t) -> Self {
        /// Borrow a NUL-terminated C string from uSockets as `&'static ZStr`.
        /// Both sources are process-lifetime static string tables (see the
        /// SAFETY note below), so the `'static` widen is genuine, not a
        /// convenience.
        #[inline]
        fn zstr(p: *const core::ffi::c_char) -> &'static ZStr {
            // SAFETY: (`bun_ptr::Interned`-style audit — Population A,
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
