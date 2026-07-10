#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Fail")]
    Fail,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    MakeLibUvOwned(#[from] bun_sys::MakeLibUvOwnedError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Fail => "Fail",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::MakeLibUvOwned(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
