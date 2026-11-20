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

/// What a request reports for TLS options that give no context.
impl From<InitError> for crate::Error {
    fn from(err: InitError) -> Self {
        match err {
            InitError::InvalidCRL => crate::Error::InvalidCRL,
            InitError::FailedToOpenSocket
            | InitError::InvalidCA
            | InitError::InvalidCAFile
            | InitError::LoadCAFile => crate::Error::FailedToOpenSocket,
        }
    }
}
