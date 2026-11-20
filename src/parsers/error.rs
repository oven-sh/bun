#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("StackOverflow")]
    StackOverflow,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("ParserError")]
    ParserError,
    /// The input's narrow encoding cannot hold the result (a Latin-1 XML
    /// document with a character reference above U+00FF); parse it again
    /// as UTF-8.
    #[error("NeedsWiderEncoding")]
    NeedsWiderEncoding,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::StackOverflow => "StackOverflow",
            Self::SyntaxError => "SyntaxError",
            Self::ParserError => "ParserError",
            Self::NeedsWiderEncoding => "NeedsWiderEncoding",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

/// Already logged, like every other `SyntaxError`.
impl From<bun_ast::SourceTooLarge> for Error {
    fn from(_: bun_ast::SourceTooLarge) -> Self {
        Error::SyntaxError
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
