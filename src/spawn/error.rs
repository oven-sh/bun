#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Unexpected")]
    Unexpected,

    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),

    #[error(transparent)]
    Core(#[from] bun_core::Error),

    #[error(transparent)]
    SpawnSys(#[from] bun_spawn_sys::Error),

    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Sys(e) => <&'static str>::from(e),
            Self::Unexpected => "Unexpected",
            Self::Core(e) => e.name(),
            Self::SpawnSys(e) => e.name(),
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
