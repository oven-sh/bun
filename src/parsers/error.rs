#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("StackOverflow")]
    StackOverflow,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("ParserError")]
    ParserError,
    #[error("UTF8Fail")]
    UTF8Fail,
    /// The input's narrow encoding cannot hold the result (a Latin-1 XML
    /// document with a character reference above U+00FF); parse it again
    /// as UTF-8.
    #[error("NeedsWiderEncoding")]
    NeedsWiderEncoding,
    #[error("UnexpectedSyntax")]
    UnexpectedSyntax,
    #[error("JSONStringsMustUseDoubleQuotes")]
    JSONStringsMustUseDoubleQuotes,
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
            Self::UTF8Fail => "UTF8Fail",
            Self::NeedsWiderEncoding => "NeedsWiderEncoding",
            Self::UnexpectedSyntax => "UnexpectedSyntax",
            Self::JSONStringsMustUseDoubleQuotes => "JSONStringsMustUseDoubleQuotes",
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
