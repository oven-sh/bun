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
}

impl Error {
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
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
