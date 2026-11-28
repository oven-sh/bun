#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum Error {
    #[error("Invalid string length")]
    StringTooLong,
    #[error(transparent)]
    Alloc(#[from] bun_core::AllocError),
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
