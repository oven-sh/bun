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
    /// Packed BoringSSL error from [`crate::error::take_boringssl_error`].
    #[error("ClientTLSSetup")]
    ClientTLSSetup(u32),
}
