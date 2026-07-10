#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("SyntaxError")]
    SyntaxError,
    #[error("StackOverflow")]
    StackOverflow,
    #[error("Backtrack")]
    Backtrack,
    #[error("MacroFailed")]
    MacroFailed,
    #[error(transparent)]
    Lexer(#[from] crate::lexer::Error),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::SyntaxError => "SyntaxError",
            Self::StackOverflow => "StackOverflow",
            Self::Backtrack => "Backtrack",
            Self::MacroFailed => "MacroFailed",
            Self::Lexer(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
