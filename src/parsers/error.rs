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
    #[error("UnexpectedSyntax")]
    UnexpectedSyntax,
    #[error("JSONStringsMustUseDoubleQuotes")]
    JSONStringsMustUseDoubleQuotes,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::StackOverflow => "StackOverflow",
            Self::SyntaxError => "SyntaxError",
            Self::ParserError => "ParserError",
            Self::UTF8Fail => "UTF8Fail",
            Self::UnexpectedSyntax => "UnexpectedSyntax",
            Self::JSONStringsMustUseDoubleQuotes => "JSONStringsMustUseDoubleQuotes",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

impl From<crate::toml::lexer::Error> for Error {
    fn from(e: crate::toml::lexer::Error) -> Self {
        use crate::toml::lexer::Error as LexErr;
        match e {
            LexErr::UTF8Fail => Error::UTF8Fail,
            LexErr::OutOfMemory => Error::Alloc(bun_alloc::AllocError),
            LexErr::SyntaxError => Error::SyntaxError,
            LexErr::UnexpectedSyntax => Error::UnexpectedSyntax,
            LexErr::JSONStringsMustUseDoubleQuotes => Error::JSONStringsMustUseDoubleQuotes,
            LexErr::ParserError => Error::ParserError,
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
