#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// The input is not a valid stream of the requested encoding, or its checksum does not match.
    #[error("bad data")]
    BadData,
    /// The result does not fit in the space the caller gave.
    #[error("insufficient space")]
    InsufficientSpace,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

pub type Result<T> = core::result::Result<T, Error>;
