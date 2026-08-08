#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// An explicit `--env-file` could not be opened. The loader has already
    /// printed the detailed message; callers should exit non-zero without
    /// adding a second generic line.
    #[error("EnvFileNotFound")]
    EnvFileNotFound,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::EnvFileNotFound => "EnvFileNotFound",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
