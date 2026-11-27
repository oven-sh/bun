#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MacroNotFound")]
    MacroNotFound,
    #[error("MacroLoadError")]
    MacroLoadError,
    #[error("MacroFailed")]
    MacroFailed,
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    ToJs(#[from] bun_ast::ToJSError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::MacroNotFound => "MacroNotFound",
            Self::MacroLoadError => "MacroLoadError",
            Self::MacroFailed => "MacroFailed",
            Self::Core(e) => e.name(),
            Self::Resolver(e) => e.name(),
            Self::ToJs(e) => e.into(),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
