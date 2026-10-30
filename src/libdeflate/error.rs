use bun_alloc::AllocError;

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// The input is not a valid stream of the requested format, or its checksum does not match.
    #[error("bad data")]
    BadData,
    /// The result does not fit in the space the caller gave.
    #[error("insufficient space")]
    InsufficientSpace,
    #[error(transparent)]
    Alloc(#[from] AllocError),
}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::Alloc(AllocError)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
