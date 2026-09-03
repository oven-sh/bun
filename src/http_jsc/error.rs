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

pub type Result<T, E = Error> = core::result::Result<T, E>;
