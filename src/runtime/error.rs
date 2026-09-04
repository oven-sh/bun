#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("SnapshotFailed")]
    SnapshotFailed,
    #[error("FailedToMakeSnapshotDirectory")]
    FailedToMakeSnapshotDirectory,
    #[error("FailedToOpenSnapshotFile")]
    FailedToOpenSnapshotFile,
    #[error("SnapshotCreationNotAllowedInCI")]
    SnapshotCreationNotAllowedInCI,
    #[error("WriteError")]
    WriteError,
    #[error("ParseError")]
    ParseError,
    #[error("FailedToWriteSnapshotFile")]
    FailedToWriteSnapshotFile,
    #[error("NoTest")]
    NoTest,
    #[error("TestNotActive")]
    TestNotActive,
    #[error("SnapshotInConcurrentGroup")]
    SnapshotInConcurrentGroup,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("FmtError")]
    FmtError,
    #[error("JSError")]
    JSError,
    #[error("ERR_TLS_CERT_ALTNAME_INVALID")]
    ERR_TLS_CERT_ALTNAME_INVALID,
    #[error("ConnectionClosed")]
    ConnectionClosed,
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error("MissingCredentials")]
    MissingCredentials,
    #[error("InvalidMethod")]
    InvalidMethod,
    #[error("InvalidPath")]
    InvalidPath,
    #[error("InvalidEndpoint")]
    InvalidEndpoint,
    #[error("InvalidSessionToken")]
    InvalidSessionToken,
    #[error("SignError")]
    SignError,
    #[error("failed to parse multipart data")]
    FailedToParseMultipartData,
    #[error("boundary is too long")]
    BoundaryIsTooLong,
    #[error("missing final boundary")]
    MissingFinalBoundary,
    #[error("is missing header end")]
    IsMissingHeaderEnd,
    #[error("is missing header line end")]
    IsMissingHeaderLineEnd,
    #[error("is missing header colon separator")]
    IsMissingHeaderColonSeparator,
    #[error("TooSmall")]
    TooSmall,
    #[error("InvalidValue")]
    InvalidValue,
    #[error("ConnectionFailed")]
    ConnectionFailed,
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("FailedToInitPipe")]
    FailedToInitPipe,
    #[error("FailedToBindPipe")]
    FailedToBindPipe,
    #[error("MissingPackageJSON")]
    MissingPackageJSON,
    #[error("HTTPForbidden")]
    HTTPForbidden,
    #[error("ExampleNotFound")]
    ExampleNotFound,
    #[error("GitHubRepositoryNotFound")]
    GitHubRepositoryNotFound,
    #[error("HTTPTooManyRequests")]
    HTTPTooManyRequests,
    #[error("NPMIsDown")]
    NPMIsDown,
    #[error("HTTPError")]
    HTTPError,
    #[error("MissingEntryPoint")]
    MissingEntryPoint,
    #[error("UnrecognizedCommand")]
    UnrecognizedCommand,
    #[error("MissingShell")]
    MissingShell,
    #[error("NotFound")]
    NotFound,
    #[error("InvalidRoot")]
    InvalidRoot,
    #[error("EmptyKey")]
    EmptyKey,
    #[error("ExpectedObject")]
    ExpectedObject,
    #[error("FormatFailed")]
    FormatFailed,
    #[error("SelfExePathFailed")]
    SelfExePathFailed,
    #[error("SpawnFailed")]
    SpawnFailed,
    #[error("PipeStartFailed")]
    PipeStartFailed,
    #[error("ChannelAdoptFailed")]
    ChannelAdoptFailed,
    #[error("ProcessWatchFailed")]
    ProcessWatchFailed,
    #[error("JUnitReportFailed")]
    JUnitReportFailed,
    #[error("lcovCoverageError")]
    lcovCoverageError,
    #[error("HTTP404")]
    HTTP404,
    #[error("GitHubIsDown")]
    GitHubIsDown,
    #[error("UpgradeFailedMissingExecutable")]
    UpgradeFailedMissingExecutable,
    #[error("UpgradeFailedBecauseOfMissingExecutableDir")]
    UpgradeFailedBecauseOfMissingExecutableDir,
    #[error("NoBinFound")]
    NoBinFound,
    #[error("NeedToInstall")]
    NeedToInstall,
    #[error("PathTooLong")]
    PathTooLong,
    #[error("AssertionError")]
    AssertionError,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error("InvalidLoader")]
    InvalidLoader,
    #[error("InvalidJSXRuntime")]
    InvalidJSXRuntime,
    #[error("ThreadSpawnFailed")]
    ThreadSpawnFailed,
    #[error("CouldntReadCurrentDirectory")]
    CouldntReadCurrentDirectory,
    #[error("FailedToGetTempPath")]
    FailedToGetTempPath,
    #[error("UnexpectedCreatingStdin")]
    UnexpectedCreatingStdin,
    #[error("UnableToEncode")]
    UnableToEncode,
    #[error("InvalidHeaderName")]
    InvalidHeaderName,
    #[error("FormatError")]
    FormatError,
    #[error("ReadError")]
    ReadError,
    #[error("OpenError")]
    OpenError,
    #[error("CompilationFailed")]
    CompilationFailed,
    #[error("UnexpectedPendingResolution")]
    UnexpectedPendingResolution,
    #[error("AsyncModule")]
    AsyncModule,
    #[error("BlobNotFound")]
    BlobNotFound,
    #[error("JSErrorObject")]
    JSErrorObject,
    #[error("InvalidRoutePattern")]
    InvalidRoutePattern,
    #[error("InvalidRequest")]
    InvalidRequest,
    #[error("FailedToCreateCoreFoudationSourceLoop")]
    FailedToCreateCoreFoudationSourceLoop,
    #[error("eol")]
    eol,
    #[error("fmt")]
    fmt,
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("FailedToSpawnFSEventsThread")]
    FailedToSpawnFSEventsThread,
    #[error("CompilationError")]
    CompilationError,
    #[error("DeferredErrors")]
    DeferredErrors,
    #[error("TCCMissing")]
    TCCMissing,
    #[error("ChromeNotFound")]
    ChromeNotFound,
    #[error("WatchFailed")]
    WatchFailed,
    #[error("Unsupported")]
    Unsupported,
    #[error("UnsupportedAlgorithm")]
    UnsupportedAlgorithm,
    #[error("PasswordVerificationFailed")]
    PasswordVerificationFailed,
    #[error("InvalidEncoding")]
    InvalidEncoding,
    #[error("WeakParameters")]
    WeakParameters,
    #[error("Unexpected")]
    Unexpected,
    #[error("BoringSSLError")]
    BoringSSLError,
    #[error("WriteFailed")]
    WriteFailed,
    #[error("FileNotFound")]
    FileNotFound,
    #[error("AccessDenied")]
    AccessDenied,
    #[error("PermissionDenied")]
    PermissionDenied,
    #[error("SymLinkLoop")]
    SymLinkLoop,
    #[error("NameTooLong")]
    NameTooLong,
    #[error("SystemResources")]
    SystemResources,
    #[error("ReadOnlyFileSystem")]
    ReadOnlyFileSystem,
    #[error("FileSystem")]
    FileSystem,
    #[error("FileBusy")]
    FileBusy,
    #[error("NotDir")]
    NotDir,
    #[error("IsDir")]
    IsDir,
    #[error("DirNotEmpty")]
    DirNotEmpty,
    #[error("SystemFdQuotaExceeded")]
    SystemFdQuotaExceeded,
    #[error("ProcessFdQuotaExceeded")]
    ProcessFdQuotaExceeded,
    #[error("BadPathName")]
    BadPathName,
    #[error("FileTooBig")]
    FileTooBig,
    #[error("NoDevice")]
    NoDevice,

    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    ShellLexer(#[from] bun_shell_parser::LexerError),
    #[error(transparent)]
    ShellParse(#[from] bun_shell_parser::ParseError),
    #[error(transparent)]
    Shell(#[from] bun_shell_parser::Error),
    #[error(transparent)]
    Jsc(#[from] bun_jsc::CrateError),
    #[error(transparent)]
    Bundler(#[from] bun_bundler::Error),
    #[error(transparent)]
    Spawn(#[from] bun_spawn::Error),
    #[error(transparent)]
    Install(#[from] bun_install::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
    #[error(transparent)]
    Parsers(#[from] bun_parsers::Error),
    #[error(transparent)]
    Bunfig(#[from] bun_bunfig::Error),
    #[error(transparent)]
    JsParser(#[from] bun_js_parser::Error),
    #[error(transparent)]
    JsLexer(#[from] bun_js_parser::lexer::Error),
    #[error(transparent)]
    StdFmt(#[from] std::fmt::Error),
    #[error(transparent)]
    Clap(#[from] bun_clap::Error),
    #[error(transparent)]
    Zlib(#[from] bun_zlib::ZlibError),
    #[error(transparent)]
    Http(#[from] bun_http::Error),
    #[error(transparent)]
    Hpack(#[from] bun_http::lshpack::HpackError),
    #[error(transparent)]
    JsPrinter(#[from] bun_js_printer::Error),
    #[error(transparent)]
    Sourcemap(#[from] bun_sourcemap::Error),
    #[error(transparent)]
    StandaloneGraph(#[from] bun_standalone_graph::Error),
    #[error("JSError")]
    Js(bun_jsc::JsError),
}

impl From<bun_sys::Error> for Error {
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

impl From<bun_uws::ssl_wrapper::InitError> for Error {
    #[inline]
    fn from(e: bun_uws::ssl_wrapper::InitError) -> Self {
        match e {
            bun_uws::ssl_wrapper::InitError::OutOfMemory => Self::Alloc(bun_alloc::AllocError),
            bun_uws::ssl_wrapper::InitError::InvalidOptions => Self::InvalidOptions,
        }
    }
}

impl From<bun_libarchive::Error> for Error {
    fn from(e: bun_libarchive::Error) -> Self {
        match e {
            bun_libarchive::Error::Sys(s) => Self::Sys(s),
            bun_libarchive::Error::Alloc(a) => Self::Alloc(a),
            _ => Self::Unexpected,
        }
    }
}

impl From<Error> for bun_bundler::Error {
    fn from(e: Error) -> Self {
        match e {
            Error::Bundler(inner) => inner,
            Error::Sys(s) => bun_bundler::Error::Sys(s),
            Error::Alloc(a) => bun_bundler::Error::Alloc(a),
            Error::Core(c) => bun_bundler::Error::Core(c),
            Error::Resolver(r) => bun_bundler::Error::Resolver(r),
            _ => bun_bundler::Error::Core(bun_core::Error::Unexpected),
        }
    }
}

impl From<bun_jsc::JsError> for Error {
    fn from(e: bun_jsc::JsError) -> Self {
        Self::Js(e)
    }
}

impl From<bun_shell_parser::braces::ParserError> for Error {
    #[inline]
    fn from(e: bun_shell_parser::braces::ParserError) -> Self {
        Self::Shell(e.into())
    }
}

impl From<Error> for bun_jsc::JsError {
    #[inline]
    fn from(e: Error) -> Self {
        match e {
            Error::Alloc(_) => bun_jsc::JsError::OutOfMemory,
            Error::Js(js) => js,
            Error::Jsc(jsc) => jsc.into(),
            _ => bun_jsc::JsError::Thrown,
        }
    }
}

impl From<Error> for bun_jsc::CrateError {
    #[inline]
    fn from(e: Error) -> Self {
        match e {
            Error::Sys(s) => Self::Sys(s),
            Error::Alloc(a) => Self::Alloc(a),
            Error::Core(c) => Self::Core(c),
            Error::Resolver(r) => Self::Resolver(r),
            Error::Bundler(b) => Self::Bundler(b),
            Error::Install(i) => Self::Install(i),
            Error::Jsc(j) => j,
            Error::JSError | Error::Js(_) => Self::JSError,
            _ => Self::Core(bun_core::Error::Unexpected),
        }
    }
}

impl From<Error> for bun_uws_sys::Error {
    #[inline]
    fn from(e: Error) -> Self {
        match e {
            Error::Alloc(a) => bun_uws_sys::Error::Alloc(a),
            Error::Sys(s) => bun_uws_sys::Error::Sys(s),
            _ => bun_uws_sys::Error::RequestBodyTooLarge,
        }
    }
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::SnapshotFailed => "SnapshotFailed",
            Self::FailedToMakeSnapshotDirectory => "FailedToMakeSnapshotDirectory",
            Self::FailedToOpenSnapshotFile => "FailedToOpenSnapshotFile",
            Self::SnapshotCreationNotAllowedInCI => "SnapshotCreationNotAllowedInCI",
            Self::WriteError => "WriteError",
            Self::ParseError => "ParseError",
            Self::FailedToWriteSnapshotFile => "FailedToWriteSnapshotFile",
            Self::NoTest => "NoTest",
            Self::TestNotActive => "TestNotActive",
            Self::SnapshotInConcurrentGroup => "SnapshotInConcurrentGroup",
            Self::SyntaxError => "SyntaxError",
            Self::FmtError => "FmtError",
            Self::JSError => "JSError",
            Self::ERR_TLS_CERT_ALTNAME_INVALID => "ERR_TLS_CERT_ALTNAME_INVALID",
            Self::ConnectionClosed => "ConnectionClosed",
            Self::FailedToOpenSocket => "FailedToOpenSocket",
            Self::MissingCredentials => "MissingCredentials",
            Self::InvalidMethod => "InvalidMethod",
            Self::InvalidPath => "InvalidPath",
            Self::InvalidEndpoint => "InvalidEndpoint",
            Self::InvalidSessionToken => "InvalidSessionToken",
            Self::SignError => "SignError",
            Self::FailedToParseMultipartData => "failed to parse multipart data",
            Self::BoundaryIsTooLong => "boundary is too long",
            Self::MissingFinalBoundary => "missing final boundary",
            Self::IsMissingHeaderEnd => "is missing header end",
            Self::IsMissingHeaderLineEnd => "is missing header line end",
            Self::IsMissingHeaderColonSeparator => "is missing header colon separator",
            Self::TooSmall => "TooSmall",
            Self::InvalidValue => "InvalidValue",
            Self::ConnectionFailed => "ConnectionFailed",
            Self::InvalidOptions => "InvalidOptions",
            Self::FailedToInitPipe => "FailedToInitPipe",
            Self::FailedToBindPipe => "FailedToBindPipe",
            Self::MissingPackageJSON => "MissingPackageJSON",
            Self::HTTPForbidden => "HTTPForbidden",
            Self::ExampleNotFound => "ExampleNotFound",
            Self::GitHubRepositoryNotFound => "GitHubRepositoryNotFound",
            Self::HTTPTooManyRequests => "HTTPTooManyRequests",
            Self::NPMIsDown => "NPMIsDown",
            Self::HTTPError => "HTTPError",
            Self::MissingEntryPoint => "MissingEntryPoint",
            Self::UnrecognizedCommand => "UnrecognizedCommand",
            Self::MissingShell => "MissingShell",
            Self::NotFound => "NotFound",
            Self::InvalidRoot => "InvalidRoot",
            Self::EmptyKey => "EmptyKey",
            Self::ExpectedObject => "ExpectedObject",
            Self::FormatFailed => "FormatFailed",
            Self::SelfExePathFailed => "SelfExePathFailed",
            Self::SpawnFailed => "SpawnFailed",
            Self::PipeStartFailed => "PipeStartFailed",
            Self::ChannelAdoptFailed => "ChannelAdoptFailed",
            Self::ProcessWatchFailed => "ProcessWatchFailed",
            Self::JUnitReportFailed => "JUnitReportFailed",
            Self::lcovCoverageError => "lcovCoverageError",
            Self::HTTP404 => "HTTP404",
            Self::GitHubIsDown => "GitHubIsDown",
            Self::UpgradeFailedMissingExecutable => "UpgradeFailedMissingExecutable",
            Self::UpgradeFailedBecauseOfMissingExecutableDir => {
                "UpgradeFailedBecauseOfMissingExecutableDir"
            }
            Self::NoBinFound => "NoBinFound",
            Self::NeedToInstall => "NeedToInstall",
            Self::PathTooLong => "PathTooLong",
            Self::AssertionError => "AssertionError",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::InvalidLoader => "InvalidLoader",
            Self::InvalidJSXRuntime => "InvalidJSXRuntime",
            Self::ThreadSpawnFailed => "ThreadSpawnFailed",
            Self::CouldntReadCurrentDirectory => "CouldntReadCurrentDirectory",
            Self::FailedToGetTempPath => "FailedToGetTempPath",
            Self::UnexpectedCreatingStdin => "UnexpectedCreatingStdin",
            Self::UnableToEncode => "UnableToEncode",
            Self::InvalidHeaderName => "InvalidHeaderName",
            Self::FormatError => "FormatError",
            Self::ReadError => "ReadError",
            Self::OpenError => "OpenError",
            Self::CompilationFailed => "CompilationFailed",
            Self::UnexpectedPendingResolution => "UnexpectedPendingResolution",
            Self::AsyncModule => "AsyncModule",
            Self::BlobNotFound => "BlobNotFound",
            Self::JSErrorObject => "JSErrorObject",
            Self::InvalidRoutePattern => "InvalidRoutePattern",
            Self::InvalidRequest => "InvalidRequest",
            Self::FailedToCreateCoreFoudationSourceLoop => "FailedToCreateCoreFoudationSourceLoop",
            Self::eol => "eol",
            Self::fmt => "fmt",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::FailedToSpawnFSEventsThread => "FailedToSpawnFSEventsThread",
            Self::CompilationError => "CompilationError",
            Self::DeferredErrors => "DeferredErrors",
            Self::TCCMissing => "TCCMissing",
            Self::ChromeNotFound => "ChromeNotFound",
            Self::WatchFailed => "WatchFailed",
            Self::Unsupported => "Unsupported",
            Self::UnsupportedAlgorithm => "UnsupportedAlgorithm",
            Self::PasswordVerificationFailed => "PasswordVerificationFailed",
            Self::InvalidEncoding => "InvalidEncoding",
            Self::WeakParameters => "WeakParameters",
            Self::Unexpected => "Unexpected",
            Self::BoringSSLError => "BoringSSLError",
            Self::WriteFailed => "WriteFailed",
            Self::FileNotFound => "FileNotFound",
            Self::AccessDenied => "AccessDenied",
            Self::PermissionDenied => "PermissionDenied",
            Self::SymLinkLoop => "SymLinkLoop",
            Self::NameTooLong => "NameTooLong",
            Self::SystemResources => "SystemResources",
            Self::ReadOnlyFileSystem => "ReadOnlyFileSystem",
            Self::FileSystem => "FileSystem",
            Self::FileBusy => "FileBusy",
            Self::NotDir => "NotDir",
            Self::IsDir => "IsDir",
            Self::DirNotEmpty => "DirNotEmpty",
            Self::SystemFdQuotaExceeded => "SystemFdQuotaExceeded",
            Self::ProcessFdQuotaExceeded => "ProcessFdQuotaExceeded",
            Self::BadPathName => "BadPathName",
            Self::FileTooBig => "FileTooBig",
            Self::NoDevice => "NoDevice",
            Self::Core(e) => e.name(),
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::ShellLexer(e) => <&'static str>::from(e),
            Self::ShellParse(e) => <&'static str>::from(e),
            Self::Shell(e) => e.name(),
            Self::Jsc(e) => e.name(),
            Self::Bundler(e) => e.name(),
            Self::Spawn(e) => e.name(),
            Self::Install(e) => e.name(),
            Self::Resolver(e) => e.name(),
            Self::Paths(e) => e.name(),
            Self::Parsers(e) => e.name(),
            Self::Bunfig(e) => e.name(),
            Self::JsParser(e) => e.name(),
            Self::JsLexer(e) => <&'static str>::from(e),
            Self::StdFmt(_) => "FmtError",
            Self::Clap(e) => e.name(),
            Self::Zlib(e) => <&'static str>::from(e),
            Self::Http(e) => e.name(),
            Self::Hpack(e) => <&'static str>::from(e),
            Self::JsPrinter(e) => e.name(),
            Self::Sourcemap(e) => e.name(),
            Self::StandaloneGraph(e) => e.name(),
            Self::Js(bun_jsc::JsError::OutOfMemory) => "OutOfMemory",
            Self::Js(_) => "JSError",
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::WriteFailed
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        Error::name(self).as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
