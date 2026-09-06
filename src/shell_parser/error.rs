#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("UnexpectedToken")]
    UnexpectedToken,
    #[error("TooManyBraces")]
    TooManyBraces,
    #[error("Unsupported")]
    Unsupported,
    #[error("Expected")]
    Expected,
    #[error("Unexpected")]
    Unexpected,
    #[error("Unknown")]
    Unknown,
    #[error("Lex")]
    Lex,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::UnexpectedToken => "UnexpectedToken",
            Self::TooManyBraces => "TooManyBraces",
            Self::Unsupported => "Unsupported",
            Self::Expected => "Expected",
            Self::Unexpected => "Unexpected",
            Self::Unknown => "Unknown",
            Self::Lex => "Lex",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
