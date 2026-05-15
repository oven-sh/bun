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

bun_core::named_error_set!(InitError);

// ported from: src/http/InitError.zig
