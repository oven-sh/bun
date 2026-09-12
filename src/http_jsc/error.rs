#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("ConnectionClosed")]
    ConnectionClosed,
    #[error("DeflateInitFailed")]
    DeflateInitFailed,
    #[error("InflateInitFailed")]
    InflateInitFailed,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::InvalidOptions => "InvalidOptions",
            Self::ConnectionClosed => "ConnectionClosed",
            Self::DeflateInitFailed => "DeflateInitFailed",
            Self::InflateInitFailed => "InflateInitFailed",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
