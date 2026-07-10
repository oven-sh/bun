#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("RequestBodyTooLarge")]
    RequestBodyTooLarge,
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::RequestBodyTooLarge => "RequestBodyTooLarge",
            Self::FailedToOpenSocket => "FailedToOpenSocket",
            Self::Alloc(_) => "OutOfMemory",
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
