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

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::MacroNotFound => "MacroNotFound",
            Self::MacroFailed => "MacroFailed",
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
            Self::Resolver(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
