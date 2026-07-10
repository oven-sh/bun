#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Parse(#[from] crate::ParseErr),
    #[error(transparent)]
    Spawn(#[from] bun_spawn::Error),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Sys(e) => <&'static str>::from(e),
            Self::Parse(e) => <&'static str>::from(e),
            Self::Spawn(e) => e.name(),
        }
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
