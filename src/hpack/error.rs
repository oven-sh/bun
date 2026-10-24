#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not HPACK, or it refers to something the tables do not have.
    #[error("InvalidHeaderBlock")]
    Invalid,
    /// The name and value have more than [`crate::MAX_FIELD_LEN`] bytes together.
    #[error("HeaderFieldTooLarge")]
    TooLarge,
}

pub type Result<T> = core::result::Result<T, Error>;
