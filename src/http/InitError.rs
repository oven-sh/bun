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
}

impl From<InitError> for bun_core::Error {
    fn from(e: InitError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// ported from: src/http/InitError.zig
