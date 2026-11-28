#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Overflow")]
    Overflow,
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("UnsupportedCSSTarget")]
    UnsupportedCSSTarget,
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
