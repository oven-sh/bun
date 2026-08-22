#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MacroNotFound")]
    MacroNotFound,
    #[error("MacroFailed")]
    MacroFailed,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
