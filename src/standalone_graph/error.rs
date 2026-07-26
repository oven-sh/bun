#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Corrupted module graph: entry point ID is greater than module list count")]
    CorruptedModuleGraphEntryPointIDIsGreaterThanModuleListCount,
    #[error("TargetNotFound")]
    TargetNotFound,
    #[error("NetworkError")]
    NetworkError,
    #[error("InvalidResponse")]
    InvalidResponse,
    #[error("ExtractionFailed")]
    ExtractionFailed,
    #[error("UnsupportedTarget")]
    UnsupportedTarget,
    #[error("InvalidSourceMap")]
    InvalidSourceMap,
    #[error("SourceMapTooLarge")]
    SourceMapTooLarge,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Http(#[from] bun_http::Error),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
    #[error(transparent)]
    Options(#[from] bun_options_types::Error),
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
            Self::CorruptedModuleGraphEntryPointIDIsGreaterThanModuleListCount => {
                "Corrupted module graph: entry point ID is greater than module list count"
            }
            Self::TargetNotFound => "TargetNotFound",
            Self::NetworkError => "NetworkError",
            Self::InvalidResponse => "InvalidResponse",
            Self::ExtractionFailed => "ExtractionFailed",
            Self::UnsupportedTarget => "UnsupportedTarget",
            Self::InvalidSourceMap => "InvalidSourceMap",
            Self::SourceMapTooLarge => "SourceMapTooLarge",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Http(e) => e.name(),
            Self::Paths(e) => e.name(),
            Self::Options(e) => e.name(),
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
