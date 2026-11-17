#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Malformed response head")]
    MalformedHead,
    #[error("Response head too long")]
    HeadTooLong,
    #[error("Malformed chunk")]
    MalformedChunk,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
