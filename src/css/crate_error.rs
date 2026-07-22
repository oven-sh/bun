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
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Overflow => "Overflow",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::UnsupportedCSSTarget => "UnsupportedCSSTarget",
            Self::CSSPrintError => "CSSPrintError",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
