#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum InitError {
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error("LoadCAFile")]
    LoadCAFile,
    #[error("InvalidCAFile")]
    InvalidCAFile,
    #[error("InvalidCA")]
    InvalidCA,
    #[error("InvalidCRL")]
    InvalidCRL,
}

/// Why a TLS context could not be built from its options.
impl From<bun_uws::create_bun_socket_error_t> for InitError {
    fn from(err: bun_uws::create_bun_socket_error_t) -> Self {
        use bun_uws::create_bun_socket_error_t as CtxError;
        match err {
            CtxError::load_ca_file => InitError::LoadCAFile,
            CtxError::invalid_ca_file => InitError::InvalidCAFile,
            CtxError::invalid_ca => InitError::InvalidCA,
            CtxError::invalid_crl => InitError::InvalidCRL,
            CtxError::none | CtxError::invalid_ciphers | CtxError::invalid_ecdh_curve => {
                InitError::FailedToOpenSocket
            }
        }
    }
}
