#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not HPACK, or it refers to something the tables do not have.
    #[error("Invalid")]
    Invalid,
    /// The name and value have more than 64 KiB together.
    #[error("TooLarge")]
    TooLarge,
}

pub(crate) type Result<T> = core::result::Result<T, Error>;
