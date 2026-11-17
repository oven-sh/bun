#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Sys(e) => <&'static str>::from(e),
            Self::Core(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

/// The result does not fit a fixed-size buffer. The path is unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NameTooLong;

impl From<NameTooLong> for bun_errno::SystemErrno {
    #[inline]
    fn from(_: NameTooLong) -> Self {
        Self::ENAMETOOLONG
    }
}

impl From<NameTooLong> for Error {
    #[inline]
    fn from(error: NameTooLong) -> Self {
        Self::Sys(error.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
