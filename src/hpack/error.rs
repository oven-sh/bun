#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Malformed header block")]
    Malformed,
    #[error("Header field too long")]
    FieldTooLong,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
