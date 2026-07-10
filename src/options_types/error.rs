#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("UnsupportedTarget")]
    UnsupportedTarget,
    #[error("BufferTooSmall")]
    BufferTooSmall,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::UnsupportedTarget => "UnsupportedTarget",
            Self::BufferTooSmall => "BufferTooSmall",
            Self::Sys(e) => <&'static str>::from(e),
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
