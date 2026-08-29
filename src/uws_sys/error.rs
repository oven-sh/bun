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

pub type Result<T, E = Error> = core::result::Result<T, E>;
