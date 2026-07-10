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
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::SyntaxError => "SyntaxError",
            Self::StackOverflow => "StackOverflow",
            Self::Backtrack => "Backtrack",
            Self::MacroFailed => "MacroFailed",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
