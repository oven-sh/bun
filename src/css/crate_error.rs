#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Overflow")]
    Overflow,
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("UnsupportedCSSTarget")]
    UnsupportedCSSTarget,
    #[error("CSSPrintError")]
    CSSPrintError,
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Overflow => "Overflow",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::UnsupportedCSSTarget => "UnsupportedCSSTarget",
            Self::CSSPrintError => "CSSPrintError",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
