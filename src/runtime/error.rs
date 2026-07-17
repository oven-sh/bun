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
    #[error("Panic")]
    Panic,
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
    #[error("StreamAlreadyUsed")]
    StreamAlreadyUsed,
    #[error("InvalidStream")]
    InvalidStream,
    #[error("UnsupportedStreamType")]
    UnsupportedStreamType,
    #[error("JSError")]
    JSError,
    #[error("ERR_TLS_CERT_ALTNAME_INVALID")]
    ERR_TLS_CERT_ALTNAME_INVALID,
    #[error("RequestBodyNotReusable")]
    RequestBodyNotReusable,
    #[error("DNSResolveFailed")]
    DNSResolveFailed,
    #[error("ConnectionClosed")]
    ConnectionClosed,
    #[error("FailedToOpenSocket")]
    FailedToOpenSocket,
    #[error("TooManyRedirects")]
    TooManyRedirects,
    #[error("ConnectionRefused")]
    ConnectionRefused,
    #[error("RedirectURLInvalid")]
    RedirectURLInvalid,
    #[error("UNABLE_TO_GET_ISSUER_CERT")]
    UNABLE_TO_GET_ISSUER_CERT,
    #[error("UNABLE_TO_GET_CRL")]
    UNABLE_TO_GET_CRL,
    #[error("UNABLE_TO_DECRYPT_CERT_SIGNATURE")]
    UNABLE_TO_DECRYPT_CERT_SIGNATURE,
    #[error("UNABLE_TO_DECRYPT_CRL_SIGNATURE")]
    UNABLE_TO_DECRYPT_CRL_SIGNATURE,
    #[error("UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY")]
    UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY,
    #[error("CERT_SIGNATURE_FAILURE")]
    CERT_SIGNATURE_FAILURE,
    #[error("CRL_SIGNATURE_FAILURE")]
    CRL_SIGNATURE_FAILURE,
    #[error("CERT_NOT_YET_VALID")]
    CERT_NOT_YET_VALID,
    #[error("CRL_NOT_YET_VALID")]
    CRL_NOT_YET_VALID,
    #[error("CERT_HAS_EXPIRED")]
    CERT_HAS_EXPIRED,
    #[error("CRL_HAS_EXPIRED")]
    CRL_HAS_EXPIRED,
    #[error("ERROR_IN_CERT_NOT_BEFORE_FIELD")]
    ERROR_IN_CERT_NOT_BEFORE_FIELD,
    #[error("ERROR_IN_CERT_NOT_AFTER_FIELD")]
    ERROR_IN_CERT_NOT_AFTER_FIELD,
    #[error("ERROR_IN_CRL_LAST_UPDATE_FIELD")]
    ERROR_IN_CRL_LAST_UPDATE_FIELD,
    #[error("ERROR_IN_CRL_NEXT_UPDATE_FIELD")]
    ERROR_IN_CRL_NEXT_UPDATE_FIELD,
    #[error("OUT_OF_MEM")]
    OUT_OF_MEM,
    #[error("DEPTH_ZERO_SELF_SIGNED_CERT")]
    DEPTH_ZERO_SELF_SIGNED_CERT,
    #[error("SELF_SIGNED_CERT_IN_CHAIN")]
    SELF_SIGNED_CERT_IN_CHAIN,
    #[error("UNABLE_TO_GET_ISSUER_CERT_LOCALLY")]
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
    #[error("UNABLE_TO_VERIFY_LEAF_SIGNATURE")]
    UNABLE_TO_VERIFY_LEAF_SIGNATURE,
    #[error("CERT_CHAIN_TOO_LONG")]
    CERT_CHAIN_TOO_LONG,
    #[error("CERT_REVOKED")]
    CERT_REVOKED,
    #[error("INVALID_CA")]
    INVALID_CA,
    #[error("INVALID_NON_CA")]
    INVALID_NON_CA,
    #[error("PATH_LENGTH_EXCEEDED")]
    PATH_LENGTH_EXCEEDED,
    #[error("PROXY_PATH_LENGTH_EXCEEDED")]
    PROXY_PATH_LENGTH_EXCEEDED,
    #[error("PROXY_CERTIFICATES_NOT_ALLOWED")]
    PROXY_CERTIFICATES_NOT_ALLOWED,
    #[error("INVALID_PURPOSE")]
    INVALID_PURPOSE,
    #[error("CERT_UNTRUSTED")]
    CERT_UNTRUSTED,
    #[error("CERT_REJECTED")]
    CERT_REJECTED,
    #[error("APPLICATION_VERIFICATION")]
    APPLICATION_VERIFICATION,
    #[error("SUBJECT_ISSUER_MISMATCH")]
    SUBJECT_ISSUER_MISMATCH,
    #[error("AKID_SKID_MISMATCH")]
    AKID_SKID_MISMATCH,
    #[error("AKID_ISSUER_SERIAL_MISMATCH")]
    AKID_ISSUER_SERIAL_MISMATCH,
    #[error("KEYUSAGE_NO_CERTSIGN")]
    KEYUSAGE_NO_CERTSIGN,
    #[error("UNABLE_TO_GET_CRL_ISSUER")]
    UNABLE_TO_GET_CRL_ISSUER,
    #[error("UNHANDLED_CRITICAL_EXTENSION")]
    UNHANDLED_CRITICAL_EXTENSION,
    #[error("KEYUSAGE_NO_CRL_SIGN")]
    KEYUSAGE_NO_CRL_SIGN,
    #[error("KEYUSAGE_NO_DIGITAL_SIGNATURE")]
    KEYUSAGE_NO_DIGITAL_SIGNATURE,
    #[error("UNHANDLED_CRITICAL_CRL_EXTENSION")]
    UNHANDLED_CRITICAL_CRL_EXTENSION,
    #[error("INVALID_EXTENSION")]
    INVALID_EXTENSION,
    #[error("INVALID_POLICY_EXTENSION")]
    INVALID_POLICY_EXTENSION,
    #[error("NO_EXPLICIT_POLICY")]
    NO_EXPLICIT_POLICY,
    #[error("DIFFERENT_CRL_SCOPE")]
    DIFFERENT_CRL_SCOPE,
    #[error("UNSUPPORTED_EXTENSION_FEATURE")]
    UNSUPPORTED_EXTENSION_FEATURE,
    #[error("UNNESTED_RESOURCE")]
    UNNESTED_RESOURCE,
    #[error("PERMITTED_VIOLATION")]
    PERMITTED_VIOLATION,
    #[error("EXCLUDED_VIOLATION")]
    EXCLUDED_VIOLATION,
    #[error("SUBTREE_MINMAX")]
    SUBTREE_MINMAX,
    #[error("UNSUPPORTED_CONSTRAINT_TYPE")]
    UNSUPPORTED_CONSTRAINT_TYPE,
    #[error("UNSUPPORTED_CONSTRAINT_SYNTAX")]
    UNSUPPORTED_CONSTRAINT_SYNTAX,
    #[error("UNSUPPORTED_NAME_SYNTAX")]
    UNSUPPORTED_NAME_SYNTAX,
    #[error("CRL_PATH_VALIDATION_ERROR")]
    CRL_PATH_VALIDATION_ERROR,
    #[error("SUITE_B_INVALID_VERSION")]
    SUITE_B_INVALID_VERSION,
    #[error("SUITE_B_INVALID_ALGORITHM")]
    SUITE_B_INVALID_ALGORITHM,
    #[error("SUITE_B_INVALID_CURVE")]
    SUITE_B_INVALID_CURVE,
    #[error("SUITE_B_INVALID_SIGNATURE_ALGORITHM")]
    SUITE_B_INVALID_SIGNATURE_ALGORITHM,
    #[error("SUITE_B_LOS_NOT_ALLOWED")]
    SUITE_B_LOS_NOT_ALLOWED,
    #[error("SUITE_B_CANNOT_SIGN_P_384_WITH_P_256")]
    SUITE_B_CANNOT_SIGN_P_384_WITH_P_256,
    #[error("HOSTNAME_MISMATCH")]
    HOSTNAME_MISMATCH,
    #[error("EMAIL_MISMATCH")]
    EMAIL_MISMATCH,
    #[error("IP_ADDRESS_MISMATCH")]
    IP_ADDRESS_MISMATCH,
    #[error("INVALID_CALL")]
    INVALID_CALL,
    #[error("STORE_LOOKUP")]
    STORE_LOOKUP,
    #[error("NAME_CONSTRAINTS_WITHOUT_SANS")]
    NAME_CONSTRAINTS_WITHOUT_SANS,
    #[error("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR")]
    UNKNOWN_CERTIFICATE_VERIFICATION_ERROR,
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
    #[error("JSTerminated")]
    JSTerminated,
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
    #[error("EndOfStream")]
    EndOfStream,
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
    #[error("InstallFailed")]
    InstallFailed,
    #[error("InvalidPackageJSON")]
    InvalidPackageJSON,
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
    #[error("PathAlreadyExists")]
    PathAlreadyExists,
    #[error("InvalidTarget")]
    InvalidTarget,
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
    #[error("OpenFailed")]
    OpenFailed,
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
    #[error("UnableToDecode")]
    UnableToDecode,
    #[error("UnableToEncode")]
    UnableToEncode,
    #[error("SocketClosed")]
    SocketClosed,
    #[error("InvalidHeaderName")]
    InvalidHeaderName,
    #[error("StackOverflow")]
    StackOverflow,
    #[error("Test")]
    Test,
    #[error("FormatError")]
    FormatError,
    #[error("ReadError")]
    ReadError,
    #[error("OpenError")]
    OpenError,
    #[error("CompilationFailed")]
    CompilationFailed,
    #[error("MissingTranspileExtra")]
    MissingTranspileExtra,
    #[error("UnexpectedPendingResolution")]
    UnexpectedPendingResolution,
    #[error("AsyncModule")]
    AsyncModule,
    #[error("NotSupported")]
    NotSupported,
    #[error("BlobNotFound")]
    BlobNotFound,
    #[error("JSErrorObject")]
    JSErrorObject,
    #[error("PluginError")]
    PluginError,
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
    #[error("Name")]
    Name,
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
    #[error("ExceptionOcurred")]
    ExceptionOcurred,
    #[error("EscapeCalledTwice")]
    EscapeCalledTwice,
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
    #[error(transparent)]
    TerminalInit(crate::api::bun_terminal_body::InitError),
    #[error(transparent)]
    DirIterator(#[from] crate::node::dir_iterator::IteratorError),
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

impl From<bun_jsc::JsTerminated> for Error {
    #[inline]
    fn from(_: bun_jsc::JsTerminated) -> Self {
        Self::JSTerminated
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
            Self::Panic => "Panic",
            Self::NoTest => "NoTest",
            Self::TestNotActive => "TestNotActive",
            Self::SnapshotInConcurrentGroup => "SnapshotInConcurrentGroup",
            Self::SyntaxError => "SyntaxError",
            Self::FmtError => "FmtError",
            Self::StreamAlreadyUsed => "StreamAlreadyUsed",
            Self::InvalidStream => "InvalidStream",
            Self::UnsupportedStreamType => "UnsupportedStreamType",
            Self::JSError => "JSError",
            Self::ERR_TLS_CERT_ALTNAME_INVALID => "ERR_TLS_CERT_ALTNAME_INVALID",
            Self::RequestBodyNotReusable => "RequestBodyNotReusable",
            Self::DNSResolveFailed => "DNSResolveFailed",
            Self::ConnectionClosed => "ConnectionClosed",
            Self::FailedToOpenSocket => "FailedToOpenSocket",
            Self::TooManyRedirects => "TooManyRedirects",
            Self::ConnectionRefused => "ConnectionRefused",
            Self::RedirectURLInvalid => "RedirectURLInvalid",
            Self::UNABLE_TO_GET_ISSUER_CERT => "UNABLE_TO_GET_ISSUER_CERT",
            Self::UNABLE_TO_GET_CRL => "UNABLE_TO_GET_CRL",
            Self::UNABLE_TO_DECRYPT_CERT_SIGNATURE => "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
            Self::UNABLE_TO_DECRYPT_CRL_SIGNATURE => "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
            Self::UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY => "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
            Self::CERT_SIGNATURE_FAILURE => "CERT_SIGNATURE_FAILURE",
            Self::CRL_SIGNATURE_FAILURE => "CRL_SIGNATURE_FAILURE",
            Self::CERT_NOT_YET_VALID => "CERT_NOT_YET_VALID",
            Self::CRL_NOT_YET_VALID => "CRL_NOT_YET_VALID",
            Self::CERT_HAS_EXPIRED => "CERT_HAS_EXPIRED",
            Self::CRL_HAS_EXPIRED => "CRL_HAS_EXPIRED",
            Self::ERROR_IN_CERT_NOT_BEFORE_FIELD => "ERROR_IN_CERT_NOT_BEFORE_FIELD",
            Self::ERROR_IN_CERT_NOT_AFTER_FIELD => "ERROR_IN_CERT_NOT_AFTER_FIELD",
            Self::ERROR_IN_CRL_LAST_UPDATE_FIELD => "ERROR_IN_CRL_LAST_UPDATE_FIELD",
            Self::ERROR_IN_CRL_NEXT_UPDATE_FIELD => "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
            Self::OUT_OF_MEM => "OUT_OF_MEM",
            Self::DEPTH_ZERO_SELF_SIGNED_CERT => "DEPTH_ZERO_SELF_SIGNED_CERT",
            Self::SELF_SIGNED_CERT_IN_CHAIN => "SELF_SIGNED_CERT_IN_CHAIN",
            Self::UNABLE_TO_GET_ISSUER_CERT_LOCALLY => "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            Self::UNABLE_TO_VERIFY_LEAF_SIGNATURE => "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            Self::CERT_CHAIN_TOO_LONG => "CERT_CHAIN_TOO_LONG",
            Self::CERT_REVOKED => "CERT_REVOKED",
            Self::INVALID_CA => "INVALID_CA",
            Self::INVALID_NON_CA => "INVALID_NON_CA",
            Self::PATH_LENGTH_EXCEEDED => "PATH_LENGTH_EXCEEDED",
            Self::PROXY_PATH_LENGTH_EXCEEDED => "PROXY_PATH_LENGTH_EXCEEDED",
            Self::PROXY_CERTIFICATES_NOT_ALLOWED => "PROXY_CERTIFICATES_NOT_ALLOWED",
            Self::INVALID_PURPOSE => "INVALID_PURPOSE",
            Self::CERT_UNTRUSTED => "CERT_UNTRUSTED",
            Self::CERT_REJECTED => "CERT_REJECTED",
            Self::APPLICATION_VERIFICATION => "APPLICATION_VERIFICATION",
            Self::SUBJECT_ISSUER_MISMATCH => "SUBJECT_ISSUER_MISMATCH",
            Self::AKID_SKID_MISMATCH => "AKID_SKID_MISMATCH",
            Self::AKID_ISSUER_SERIAL_MISMATCH => "AKID_ISSUER_SERIAL_MISMATCH",
            Self::KEYUSAGE_NO_CERTSIGN => "KEYUSAGE_NO_CERTSIGN",
            Self::UNABLE_TO_GET_CRL_ISSUER => "UNABLE_TO_GET_CRL_ISSUER",
            Self::UNHANDLED_CRITICAL_EXTENSION => "UNHANDLED_CRITICAL_EXTENSION",
            Self::KEYUSAGE_NO_CRL_SIGN => "KEYUSAGE_NO_CRL_SIGN",
            Self::KEYUSAGE_NO_DIGITAL_SIGNATURE => "KEYUSAGE_NO_DIGITAL_SIGNATURE",
            Self::UNHANDLED_CRITICAL_CRL_EXTENSION => "UNHANDLED_CRITICAL_CRL_EXTENSION",
            Self::INVALID_EXTENSION => "INVALID_EXTENSION",
            Self::INVALID_POLICY_EXTENSION => "INVALID_POLICY_EXTENSION",
            Self::NO_EXPLICIT_POLICY => "NO_EXPLICIT_POLICY",
            Self::DIFFERENT_CRL_SCOPE => "DIFFERENT_CRL_SCOPE",
            Self::UNSUPPORTED_EXTENSION_FEATURE => "UNSUPPORTED_EXTENSION_FEATURE",
            Self::UNNESTED_RESOURCE => "UNNESTED_RESOURCE",
            Self::PERMITTED_VIOLATION => "PERMITTED_VIOLATION",
            Self::EXCLUDED_VIOLATION => "EXCLUDED_VIOLATION",
            Self::SUBTREE_MINMAX => "SUBTREE_MINMAX",
            Self::UNSUPPORTED_CONSTRAINT_TYPE => "UNSUPPORTED_CONSTRAINT_TYPE",
            Self::UNSUPPORTED_CONSTRAINT_SYNTAX => "UNSUPPORTED_CONSTRAINT_SYNTAX",
            Self::UNSUPPORTED_NAME_SYNTAX => "UNSUPPORTED_NAME_SYNTAX",
            Self::CRL_PATH_VALIDATION_ERROR => "CRL_PATH_VALIDATION_ERROR",
            Self::SUITE_B_INVALID_VERSION => "SUITE_B_INVALID_VERSION",
            Self::SUITE_B_INVALID_ALGORITHM => "SUITE_B_INVALID_ALGORITHM",
            Self::SUITE_B_INVALID_CURVE => "SUITE_B_INVALID_CURVE",
            Self::SUITE_B_INVALID_SIGNATURE_ALGORITHM => "SUITE_B_INVALID_SIGNATURE_ALGORITHM",
            Self::SUITE_B_LOS_NOT_ALLOWED => "SUITE_B_LOS_NOT_ALLOWED",
            Self::SUITE_B_CANNOT_SIGN_P_384_WITH_P_256 => "SUITE_B_CANNOT_SIGN_P_384_WITH_P_256",
            Self::HOSTNAME_MISMATCH => "HOSTNAME_MISMATCH",
            Self::EMAIL_MISMATCH => "EMAIL_MISMATCH",
            Self::IP_ADDRESS_MISMATCH => "IP_ADDRESS_MISMATCH",
            Self::INVALID_CALL => "INVALID_CALL",
            Self::STORE_LOOKUP => "STORE_LOOKUP",
            Self::NAME_CONSTRAINTS_WITHOUT_SANS => "NAME_CONSTRAINTS_WITHOUT_SANS",
            Self::UNKNOWN_CERTIFICATE_VERIFICATION_ERROR => {
                "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR"
            }
            Self::MissingCredentials => "MissingCredentials",
            Self::InvalidMethod => "InvalidMethod",
            Self::InvalidPath => "InvalidPath",
            Self::InvalidEndpoint => "InvalidEndpoint",
            Self::InvalidSessionToken => "InvalidSessionToken",
            Self::SignError => "SignError",
            Self::JSTerminated => "JSTerminated",
            Self::FailedToParseMultipartData => "failed to parse multipart data",
            Self::BoundaryIsTooLong => "boundary is too long",
            Self::MissingFinalBoundary => "missing final boundary",
            Self::IsMissingHeaderEnd => "is missing header end",
            Self::IsMissingHeaderLineEnd => "is missing header line end",
            Self::IsMissingHeaderColonSeparator => "is missing header colon separator",
            Self::EndOfStream => "EndOfStream",
            Self::TooSmall => "TooSmall",
            Self::InvalidValue => "InvalidValue",
            Self::ConnectionFailed => "ConnectionFailed",
            Self::InvalidOptions => "InvalidOptions",
            Self::FailedToInitPipe => "FailedToInitPipe",
            Self::FailedToBindPipe => "FailedToBindPipe",
            Self::MissingPackageJSON => "MissingPackageJSON",
            Self::InstallFailed => "InstallFailed",
            Self::InvalidPackageJSON => "InvalidPackageJSON",
            Self::HTTPForbidden => "HTTPForbidden",
            Self::ExampleNotFound => "ExampleNotFound",
            Self::GitHubRepositoryNotFound => "GitHubRepositoryNotFound",
            Self::HTTPTooManyRequests => "HTTPTooManyRequests",
            Self::NPMIsDown => "NPMIsDown",
            Self::HTTPError => "HTTPError",
            Self::PathAlreadyExists => "PathAlreadyExists",
            Self::InvalidTarget => "InvalidTarget",
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
            Self::OpenFailed => "OpenFailed",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::InvalidLoader => "InvalidLoader",
            Self::InvalidJSXRuntime => "InvalidJSXRuntime",
            Self::ThreadSpawnFailed => "ThreadSpawnFailed",
            Self::CouldntReadCurrentDirectory => "CouldntReadCurrentDirectory",
            Self::FailedToGetTempPath => "FailedToGetTempPath",
            Self::UnexpectedCreatingStdin => "UnexpectedCreatingStdin",
            Self::UnableToDecode => "UnableToDecode",
            Self::UnableToEncode => "UnableToEncode",
            Self::SocketClosed => "SocketClosed",
            Self::InvalidHeaderName => "InvalidHeaderName",
            Self::StackOverflow => "StackOverflow",
            Self::Test => "Test",
            Self::FormatError => "FormatError",
            Self::ReadError => "ReadError",
            Self::OpenError => "OpenError",
            Self::CompilationFailed => "CompilationFailed",
            Self::MissingTranspileExtra => "MissingTranspileExtra",
            Self::UnexpectedPendingResolution => "UnexpectedPendingResolution",
            Self::AsyncModule => "AsyncModule",
            Self::NotSupported => "NotSupported",
            Self::BlobNotFound => "BlobNotFound",
            Self::JSErrorObject => "JSErrorObject",
            Self::PluginError => "PluginError",
            Self::InvalidRoutePattern => "InvalidRoutePattern",
            Self::InvalidRequest => "InvalidRequest",
            Self::FailedToCreateCoreFoudationSourceLoop => "FailedToCreateCoreFoudationSourceLoop",
            Self::eol => "eol",
            Self::fmt => "fmt",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::Name => "Name",
            Self::FailedToSpawnFSEventsThread => "FailedToSpawnFSEventsThread",
            Self::CompilationError => "CompilationError",
            Self::DeferredErrors => "DeferredErrors",
            Self::TCCMissing => "TCCMissing",
            Self::ChromeNotFound => "ChromeNotFound",
            Self::WatchFailed => "WatchFailed",
            Self::Unsupported => "Unsupported",
            Self::ExceptionOcurred => "ExceptionOcurred",
            Self::EscapeCalledTwice => "EscapeCalledTwice",
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
            Self::TerminalInit(e) => <&'static str>::from(e),
            Self::DirIterator(e) => <&'static str>::from(e),
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
