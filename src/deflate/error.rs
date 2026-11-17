#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("bad data")]
    BadData,
    #[error("insufficient space")]
    InsufficientSpace,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl From<std::collections::TryReserveError> for Error {
    fn from(_: std::collections::TryReserveError) -> Self {
        Self::Alloc(bun_alloc::AllocError)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
