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
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
    /// `EXDEV`, which only `bun_sys::beneath` answers to this crate: a symlink is absolute or leads out of the destination.
    #[error("{0}")]
    LeavesDestination(bun_sys::Error),
}

/// Why the contents of an entry did not reach the file.
#[derive(Debug, thiserror::Error)]
pub enum ReadDataError {
    #[error(transparent)]
    Archive(#[from] bun_tar::Error),
    #[error("{0}")]
    Sys(bun_sys::Error),
}

impl From<bun_sys::Error> for ReadDataError {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e)
    }
}

impl Error {
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Fail => "Fail",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::MakeLibUvOwned(e) => <&'static str>::from(e),
            Self::Paths(e) => e.name(),
            Self::LeavesDestination(_) => "EXDEV",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_tar::Error> for Error {
    fn from(e: bun_tar::Error) -> Self {
        match e {
            bun_tar::Error::Alloc(e) => Self::Alloc(e),
            _ => Self::Fail,
        }
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        match e.get_errno() {
            #[cfg(not(windows))]
            bun_sys::E::EXDEV => Self::LeavesDestination(e),
            _ => Self::Sys(e.into()),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
