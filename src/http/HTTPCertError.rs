use bun_core::{ZBox, ZStr};

pub struct HTTPCertError {
    pub error_no: i32,
    // `code` borrows the core's static verify-error code table; `reason` is
    // owned — the EPROTO arm hands us a per-socket `FatalReason` that dies
    // when `on_handshake` returns, so it must be copied, never widened.
    pub code: &'static ZStr,
    pub reason: ZBox,
}

impl Default for HTTPCertError {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: ZStr::EMPTY,
            reason: ZBox::default(),
        }
    }
}

impl HTTPCertError {
    /// Build from the uSockets verify-error struct delivered to `on_handshake`.
    ///
    /// Centralises the decode so each handshake handler (outer-TLS in
    /// `HTTPContext::Handler::on_handshake`, inner-TLS in
    /// `ProxyTunnel::on_handshake`) doesn't repeat the raw deref.
    ///
    /// `reason` is gated on `code` being non-null (the
    /// uSockets API populates both together or neither).
    pub fn from_verify_error(ssl_error: bun_usockets::us_bun_verify_error_t) -> Self {
        // SAFETY: `code` is always a pointer into a process-lifetime static
        // table (`x509_error_code`, the `"EPROTO"`/`"ECONNRESET"` literals in
        // `us_bun_verify_error_t`'s constructors), so the `'static` widen is
        // sound for `code` only.
        let code = unsafe { ZStr::from_c_ptr(ssl_error.code) };
        let reason = if ssl_error.code.is_null() {
            ZBox::default()
        } else {
            // SAFETY: `reason` is NUL-terminated and live for the duration of
            // the `on_handshake` dispatch only — the EPROTO arm borrows the
            // socket's parked `FatalReason` (§3.4) — so copy it here.
            ZBox::from_bytes(unsafe { ZStr::from_c_ptr(ssl_error.reason) }.as_bytes())
        };
        Self {
            error_no: ssl_error.error_no,
            code,
            reason,
        }
    }
}
