#[derive(Default)]
pub struct HTTPCertError {
    pub error_no: i32,
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
    pub fn from_verify_error(ssl_error: bun_uws::us_bun_verify_error_t) -> Self {
        Self {
            error_no: ssl_error.error_no,
        }
    }
}
