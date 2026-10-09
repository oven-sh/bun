#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("KQueueError")]
    KQueueError,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[cfg(windows)]
    #[error(transparent)]
    Windows(#[from] crate::windows_watcher::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::KQueueError => "KQueueError",
            Self::Sys(e) => <&'static str>::from(e),
            #[cfg(windows)]
            Self::Windows(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_sys::Error> for Error {
    #[inline]
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
