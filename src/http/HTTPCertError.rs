use bun_core::ZStr;

pub struct HTTPCertError {
    pub error_no: i32,
    pub code: &'static ZStr,
    // Only the X509 path's `reason` is a process-lifetime literal. A fatal TLS
    // error hands over the dispatch frame's stack buffer (openssl.c's
    // `ssl_dispatch_parked_reason`), so don't read it after `on_handshake`.
    pub reason: &'static ZStr,
    // Taken in `from_verify_error`, while `reason` is still live.
    no_application_protocol: bool,
}

impl Default for HTTPCertError {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: ZStr::EMPTY,
            reason: ZStr::EMPTY,
            no_application_protocol: false,
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
    /// `reason` is gated on `code` being non-null (the
    /// uSockets API populates both together or neither).
    pub fn from_verify_error(ssl_error: bun_uws::us_bun_verify_error_t) -> Self {
        /// Borrow a NUL-terminated C string from uSockets for this dispatch.
        #[inline]
        fn zstr(p: *const core::ffi::c_char) -> &'static ZStr {
            // SAFETY: `code` is uSockets' static verify-error table. `reason` is
            // a BoringSSL literal on the X509 path but the caller's stack buffer
            // on the fatal-TLS one, so it is only read inside that dispatch.
            unsafe { ZStr::from_c_ptr(p) }
        }
        let reason = if ssl_error.code.is_null() {
            ZStr::EMPTY
        } else {
            zstr(ssl_error.reason)
        };
        Self {
            error_no: ssl_error.error_no,
            code: zstr(ssl_error.code),
            no_application_protocol: bun_core::strings::ends_with_comptime(
                reason.as_bytes(),
                b":TLSV1_ALERT_NO_APPLICATION_PROTOCOL",
            ),
            reason,
        }
    }

    /// True when the peer refused our ALPN offer with a fatal
    /// `no_application_protocol` alert. BoringSSL's reason string carries it in
    /// the shape `node:net` decomposes into `ERR_SSL_<REASON>`.
    pub fn is_no_application_protocol(&self) -> bool {
        self.no_application_protocol
    }
}
