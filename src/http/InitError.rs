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
    /// SSL_CTX construction failed while loading client cert/key material.
    /// Carries the packed BoringSSL error (from `ERR_get_error()`), captured on
    /// the thread that built the context so the JS thread can format it later.
    #[error("ClientTLSSetup")]
    ClientTLSSetup(u32),
}
