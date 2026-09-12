#[derive(Default)]
pub struct HTTPCertError {
    pub(crate) error_no: i32,
}

impl HTTPCertError {
    /// Build from the uSockets verify-error struct delivered to `on_handshake`.
    pub(crate) fn from_verify_error(ssl_error: bun_uws::us_bun_verify_error_t) -> Self {
        Self {
            error_no: ssl_error.error_no,
        }
    }
}
