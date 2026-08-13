#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("MissingDebugInfo")]
    MissingDebugInfo,
    #[error("UnsupportedOperatingSystem")]
    UnsupportedOperatingSystem,
    #[error("Unexpected")]
    Unexpected,
    #[error("InvalidDebugInfo")]
    InvalidDebugInfo,
    #[error("EndOfFile")]
    EndOfFile,

    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),

    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),

    #[error(transparent)]
    Core(#[from] bun_core::Error),
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Error::Sys(bun_errno::SystemErrno::from(e))
    }
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::MissingDebugInfo => "MissingDebugInfo",
            Self::UnsupportedOperatingSystem => "UnsupportedOperatingSystem",
            Self::Unexpected => "Unexpected",
            Self::InvalidDebugInfo => "InvalidDebugInfo",
            Self::EndOfFile => "EndOfFile",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
