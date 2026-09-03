#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Overflow")]
    Overflow,
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("UnsupportedCSSTarget")]
    UnsupportedCSSTarget,
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Overflow => "Overflow",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::UnsupportedCSSTarget => "UnsupportedCSSTarget",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
