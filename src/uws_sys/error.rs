#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("RequestBodyTooLarge")]
    RequestBodyTooLarge,
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::RequestBodyTooLarge => "RequestBodyTooLarge",
            Self::FailedToOpenSocket => "FailedToOpenSocket",
            Self::Alloc(_) => "OutOfMemory",
            Self::Sys(e) => <&'static str>::from(e),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
