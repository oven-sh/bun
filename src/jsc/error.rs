#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("JSTerminated")]
    JSTerminated,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error("InvalidDataURL")]
    InvalidDataURL,
    #[error("InvalidURL")]
    InvalidURL,
    #[error("ParserError")]
    ParserError,
    #[error("StaleCache")]
    StaleCache,
    #[error("InvalidModuleType")]
    InvalidModuleType,
    #[error("UnknownEncoding")]
    UnknownEncoding,
    #[error("WriteFailed")]
    WriteFailed,
    #[error("MissingData")]
    MissingData,
    #[error("InvalidHash")]
    InvalidHash,
    #[error("CacheDisabled")]
    CacheDisabled,
    #[error("InvalidInputHash")]
    InvalidInputHash,
    #[error("MismatchedFeatureHash")]
    MismatchedFeatureHash,
    #[error("WriteError")]
    WriteError,
    #[error("TranspilerJobGenerationMismatch")]
    TranspilerJobGenerationMismatch,
    #[error("ParseError")]
    ParseError,
    #[error("JSError")]
    JSError,
    #[error("PackageManifestHTTP400")]
    PackageManifestHTTP400,
    #[error("PackageManifestHTTP401")]
    PackageManifestHTTP401,
    #[error("PackageManifestHTTP402")]
    PackageManifestHTTP402,
    #[error("PackageManifestHTTP403")]
    PackageManifestHTTP403,
    #[error("PackageManifestHTTP404")]
    PackageManifestHTTP404,
    #[error("PackageManifestHTTP4xx")]
    PackageManifestHTTP4xx,
    #[error("PackageManifestHTTP5xx")]
    PackageManifestHTTP5xx,
    #[error("DistTagNotFound")]
    DistTagNotFound,
    #[error("NoMatchingVersion")]
    NoMatchingVersion,
    #[error("TarballHTTP400")]
    TarballHTTP400,
    #[error("TarballHTTP401")]
    TarballHTTP401,
    #[error("TarballHTTP402")]
    TarballHTTP402,
    #[error("TarballHTTP403")]
    TarballHTTP403,
    #[error("TarballHTTP404")]
    TarballHTTP404,
    #[error("TarballHTTP4xx")]
    TarballHTTP4xx,
    #[error("TarballHTTP5xx")]
    TarballHTTP5xx,
    #[error("TarballFailedToExtract")]
    TarballFailedToExtract,
    #[error("ServerEntryPointGenerate")]
    ServerEntryPointGenerate,
    #[error("UnexpectedPendingResolution")]
    UnexpectedPendingResolution,
    #[error("WorkerTerminated")]
    WorkerTerminated,
    #[error("JSErrorObject")]
    JSErrorObject,
    #[error("ThreadSpawnFailed")]
    ThreadSpawnFailed,
    #[error("MissingDebugInfo")]
    MissingDebugInfo,
    #[error("InvalidDebugInfo")]
    InvalidDebugInfo,
    #[error("EndOfFile")]
    EndOfFile,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::JSTerminated => "JSTerminated",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::InvalidDataURL => "InvalidDataURL",
            Self::InvalidURL => "InvalidURL",
            Self::ParserError => "ParserError",
            Self::StaleCache => "StaleCache",
            Self::InvalidModuleType => "InvalidModuleType",
            Self::UnknownEncoding => "UnknownEncoding",
            Self::WriteFailed => "WriteFailed",
            Self::MissingData => "MissingData",
            Self::InvalidHash => "InvalidHash",
            Self::CacheDisabled => "CacheDisabled",
            Self::InvalidInputHash => "InvalidInputHash",
            Self::MismatchedFeatureHash => "MismatchedFeatureHash",
            Self::WriteError => "WriteError",
            Self::TranspilerJobGenerationMismatch => "TranspilerJobGenerationMismatch",
            Self::ParseError => "ParseError",
            Self::JSError => "JSError",
            Self::PackageManifestHTTP400 => "PackageManifestHTTP400",
            Self::PackageManifestHTTP401 => "PackageManifestHTTP401",
            Self::PackageManifestHTTP402 => "PackageManifestHTTP402",
            Self::PackageManifestHTTP403 => "PackageManifestHTTP403",
            Self::PackageManifestHTTP404 => "PackageManifestHTTP404",
            Self::PackageManifestHTTP4xx => "PackageManifestHTTP4xx",
            Self::PackageManifestHTTP5xx => "PackageManifestHTTP5xx",
            Self::DistTagNotFound => "DistTagNotFound",
            Self::NoMatchingVersion => "NoMatchingVersion",
            Self::TarballHTTP400 => "TarballHTTP400",
            Self::TarballHTTP401 => "TarballHTTP401",
            Self::TarballHTTP402 => "TarballHTTP402",
            Self::TarballHTTP403 => "TarballHTTP403",
            Self::TarballHTTP404 => "TarballHTTP404",
            Self::TarballHTTP4xx => "TarballHTTP4xx",
            Self::TarballHTTP5xx => "TarballHTTP5xx",
            Self::TarballFailedToExtract => "TarballFailedToExtract",
            Self::ServerEntryPointGenerate => "ServerEntryPointGenerate",
            Self::UnexpectedPendingResolution => "UnexpectedPendingResolution",
            Self::WorkerTerminated => "WorkerTerminated",
            Self::JSErrorObject => "JSErrorObject",
            Self::ThreadSpawnFailed => "ThreadSpawnFailed",
            Self::MissingDebugInfo => "MissingDebugInfo",
            Self::InvalidDebugInfo => "InvalidDebugInfo",
            Self::EndOfFile => "EndOfFile",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
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
        Self::Sys(e.get_errno())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
