#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Unexpected")]
    Unexpected,
    #[error(transparent)]
    Parser(#[from] crate::parser::ParserError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Unexpected => "Unexpected",
            Self::Parser(e) => <&'static str>::from(*e),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
