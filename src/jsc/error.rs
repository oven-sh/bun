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
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    MakeLibUvOwned(#[from] bun_sys::MakeLibUvOwnedError),
    #[error(transparent)]
    Path(#[from] bun_paths::path_options::Error),
    #[error(transparent)]
    Bundler(#[from] bun_bundler::Error),
    #[error(transparent)]
    Watcher(#[from] bun_watcher::Error),
    #[error(transparent)]
    Install(#[from] bun_install::Error),
    #[error(transparent)]
    Ast(#[from] bun_ast::Error),
    #[error(transparent)]
    Patch(#[from] bun_patch::Error),
    #[error(transparent)]
    ToJS(#[from] bun_ast::ToJSError),
    #[error(transparent)]
    Url(#[from] bun_url::Error),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
    #[error("{0}")]
    ErrorCode(crate::error_code::ErrorCode),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
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
            Self::TarballFailedToExtract => "TarballFailedToExtract",
            Self::ServerEntryPointGenerate => "ServerEntryPointGenerate",
            Self::UnexpectedPendingResolution => "UnexpectedPendingResolution",
            Self::WorkerTerminated => "WorkerTerminated",
            Self::JSErrorObject => "JSErrorObject",
            Self::ThreadSpawnFailed => "ThreadSpawnFailed",
            Self::MissingDebugInfo => "MissingDebugInfo",
            Self::InvalidDebugInfo => "InvalidDebugInfo",
            Self::EndOfFile => "EndOfFile",
            Self::FailedToOpenSocket => "FailedToOpenSocket",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
            Self::Resolver(e) => e.name(),
            Self::MakeLibUvOwned(e) => <&'static str>::from(e),
            Self::Path(e) => <&'static str>::from(e),
            Self::Bundler(e) => e.name(),
            Self::Watcher(e) => e.name(),
            Self::Install(e) => e.name(),
            Self::Ast(e) => e.name(),
            Self::Patch(e) => e.name(),
            Self::ToJS(e) => <&'static str>::from(e),
            Self::Url(e) => e.name(),
            Self::Paths(e) => e.name(),
            Self::ErrorCode(e) => <&'static str>::from(*e),
        }
    }
}

impl From<crate::error_code::ErrorCode> for Error {
    #[inline]
    fn from(e: crate::error_code::ErrorCode) -> Self {
        Self::ErrorCode(e)
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

impl From<bun_uws::ConnectError> for Error {
    #[inline]
    fn from(_: bun_uws::ConnectError) -> Self {
        Self::FailedToOpenSocket
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
