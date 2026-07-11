#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("FileNotFound")]
    FileNotFound,
    #[error("AccessDenied")]
    AccessDenied,
    #[error("NotDir")]
    NotDir,
    #[error("NameTooLong")]
    NameTooLong,
    #[error("FileTooBig")]
    FileTooBig,
    #[error("SymLinkLoop")]
    SymLinkLoop,
    #[error("ProcessFdQuotaExceeded")]
    ProcessFdQuotaExceeded,
    #[error("SystemFdQuotaExceeded")]
    SystemFdQuotaExceeded,
    #[error("SystemResources")]
    SystemResources,
    #[error("ReadOnlyFileSystem")]
    ReadOnlyFileSystem,
    #[error("FileSystem")]
    FileSystem,
    #[error("FileBusy")]
    FileBusy,
    #[error("DeviceBusy")]
    DeviceBusy,
    #[error("InvalidUtf8")]
    InvalidUtf8,
    #[error("InvalidWtf8")]
    InvalidWtf8,
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
    #[error("TarballFailedToDownload")]
    TarballFailedToDownload,
    #[error("BadRequest")]
    BadRequest,
    #[error("TooManyRequests")]
    TooManyRequests,
    #[error("HTTPInternalServerError")]
    HTTPInternalServerError,
    #[error("UnexpectedNotModified")]
    UnexpectedNotModified,
    #[error("PackageFailedToParse")]
    PackageFailedToParse,
    #[error("BufferTooSmall")]
    BufferTooSmall,
    #[error("DanglingSymlink")]
    DanglingSymlink,
    #[error("UnsupportedYarnLockfileVersion")]
    UnsupportedYarnLockfileVersion,
    #[error("InvalidPackageJSON")]
    InvalidPackageJSON,
    #[error("LockfileResolveFailed")]
    LockfileResolveFailed,
    #[error("DistTagNotFound")]
    DistTagNotFound,
    #[error("NoMatchingVersion")]
    NoMatchingVersion,
    #[error("TooRecentVersion")]
    TooRecentVersion,
    #[error("MissingPackageJSON")]
    MissingPackageJSON,
    #[error("InstallFailed")]
    InstallFailed,
    #[error("HTTPError")]
    HTTPError,
    #[error("Failed")]
    Failed,
    #[error("UnrecognizedDependencyFormat")]
    UnrecognizedDependencyFormat,
    #[error("No global directory found")]
    NoGlobalDirectoryFound,
    #[error("InvalidPackageID")]
    InvalidPackageID,
    #[error("PartialInstallFailed")]
    PartialInstallFailed,
    #[error("NoPackagesInstalled")]
    NoPackagesInstalled,
    #[error("SecurityScannerInWorkspace")]
    SecurityScannerInWorkspace,
    #[error("SecurityScannerRetryFailed")]
    SecurityScannerRetryFailed,
    #[error("IPCPipeFailed")]
    IPCPipeFailed,
    #[error("JSONPipeWriterFailed")]
    JSONPipeWriterFailed,
    #[error("ProcessWatchFailed")]
    ProcessWatchFailed,
    #[error("SecurityScannerProcessFailedWithoutExitStatus")]
    SecurityScannerProcessFailedWithoutExitStatus,
    #[error("NoSecurityScanData")]
    NoSecurityScanData,
    #[error("InvalidIPCMessage")]
    InvalidIPCMessage,
    #[error("InvalidIPCFormat")]
    InvalidIPCFormat,
    #[error("MissingIPCType")]
    MissingIPCType,
    #[error("InvalidIPCType")]
    InvalidIPCType,
    #[error("MissingErrorCode")]
    MissingErrorCode,
    #[error("InvalidErrorCode")]
    InvalidErrorCode,
    #[error("UnknownErrorCode")]
    UnknownErrorCode,
    #[error("SecurityScannerNotFound")]
    SecurityScannerNotFound,
    #[error("SecurityScannerNotInDependencies")]
    SecurityScannerNotInDependencies,
    #[error("InvalidScannerVersion")]
    InvalidScannerVersion,
    #[error("ScannerFailed")]
    ScannerFailed,
    #[error("UnknownMessageType")]
    UnknownMessageType,
    #[error("MissingAdvisoriesField")]
    MissingAdvisoriesField,
    #[error("SecurityScannerFailed")]
    SecurityScannerFailed,
    #[error("SecurityScannerTerminated")]
    SecurityScannerTerminated,
    #[error("InvalidAdvisoriesFormat")]
    InvalidAdvisoriesFormat,
    #[error("InvalidAdvisoryFormat")]
    InvalidAdvisoryFormat,
    #[error("MissingPackageField")]
    MissingPackageField,
    #[error("InvalidPackageField")]
    InvalidPackageField,
    #[error("EmptyPackageField")]
    EmptyPackageField,
    #[error("InvalidDescriptionField")]
    InvalidDescriptionField,
    #[error("InvalidUrlField")]
    InvalidUrlField,
    #[error("MissingLevelField")]
    MissingLevelField,
    #[error("InvalidLevelField")]
    InvalidLevelField,
    #[error("InvalidLevelValue")]
    InvalidLevelValue,
    #[error("Missing global bin directory: try setting $BUN_INSTALL")]
    MissingGlobalBinDirectoryTrySettingBUNINSTALL,
    #[error("InvalidURL")]
    InvalidURL,
    #[error("Fail")]
    Fail,
    #[error("IntegrityCheckFailed")]
    IntegrityCheckFailed,
    #[error("RepositoryNotFound")]
    RepositoryNotFound,
    #[error("DebugTextLockfileRoundTrip")]
    DebugTextLockfileRoundTrip,
    #[error("NoPackage")]
    NoPackage,
    #[error("BrokenPipe")]
    BrokenPipe,
    #[error("WriteFailed")]
    WriteFailed,
    #[error("InvalidCharacter")]
    InvalidCharacter,
    #[error("InvalidLockfile")]
    InvalidLockfile,
    #[error("Unexpected lockfile version")]
    UnexpectedLockfileVersion,
    #[error("Outdated lockfile version")]
    OutdatedLockfileVersion,
    #[error("Lockfile is missing data")]
    LockfileIsMissingData,
    #[error("Lockfile is malformed (expected 0 at the end)")]
    LockfileIsMalformedExpected0AtTheEnd,
    #[error("CorruptLockfile")]
    CorruptLockfile,
    #[error("Lockfile is missing resolution data")]
    LockfileIsMissingResolutionData,
    #[error("MissingPackageName")]
    MissingPackageName,
    #[error("GlobError")]
    GlobError,
    #[error("Invalid")]
    Invalid,
    #[error("Lockfile validation failed: list is impossibly long")]
    LockfileValidationFailedListIsImpossiblyLong,
    #[error("Lockfile validation failed: alignment mismatch")]
    LockfileValidationFailedAlignmentMismatch,
    #[error("Lockfile validation failed: unexpected number of package fields")]
    LockfileValidationFailedUnexpectedNumberOfPackageFields,
    #[error("Lockfile validation failed: invalid package list range")]
    LockfileValidationFailedInvalidPackageListRange,
    #[error("Lockfile validation failed: invalid resolution tag")]
    LockfileValidationFailedInvalidResolutionTag,
    #[error("Lockfile validation failed: invalid package meta")]
    LockfileValidationFailedInvalidPackageMeta,
    #[error("Lockfile validation failed: invalid bin tag")]
    LockfileValidationFailedInvalidBinTag,
    #[error("Lockfile validation failed: invalid package scripts")]
    LockfileValidationFailedInvalidPackageScripts,
    #[error("NPMLockfileVersionMismatch")]
    NPMLockfileVersionMismatch,
    #[error("InvalidNPMLockfile")]
    InvalidNPMLockfile,
    #[error("PathTooLong")]
    PathTooLong,
    #[error("LockfileWorkspaceMissingResolved")]
    LockfileWorkspaceMissingResolved,
    #[error("NotAllPackagesGotResolved")]
    NotAllPackagesGotResolved,
    #[error("DependencyLoop")]
    DependencyLoop,
    #[error("NotSupported")]
    NotSupported,
    #[error("Unexpected")]
    Unexpected,
    #[error("NotSameFileSystem")]
    NotSameFileSystem,
    #[error("FailedToCopyFile")]
    FailedToCopyFile,
    #[error("InvalidBinCount")]
    InvalidBinCount,
    #[error("InvalidBinContent")]
    InvalidBinContent,

    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Resolver(#[from] bun_resolver::Error),
    #[error(transparent)]
    Spawn(#[from] bun_spawn::Error),
    #[error(transparent)]
    Http(#[from] bun_http::Error),
    #[error(transparent)]
    PackageManifest(#[from] crate::PackageManifestError),
    #[error(transparent)]
    Dotenv(#[from] bun_dotenv::Error),
    #[error(transparent)]
    Parsers(#[from] bun_parsers::Error),
    #[error(transparent)]
    Bunfig(#[from] bun_bunfig::Error),
    #[error(transparent)]
    Transpiler(#[from] bun_transpiler::Error),
    #[error(transparent)]
    Zlib(#[from] bun_zlib::ZlibError),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
    #[error(transparent)]
    PathOptions(#[from] bun_paths::path_options::Error),
    #[error(transparent)]
    Fmt(#[from] core::fmt::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::FileNotFound => "FileNotFound",
            Self::AccessDenied => "AccessDenied",
            Self::NotDir => "NotDir",
            Self::NameTooLong => "NameTooLong",
            Self::FileTooBig => "FileTooBig",
            Self::SymLinkLoop => "SymLinkLoop",
            Self::ProcessFdQuotaExceeded => "ProcessFdQuotaExceeded",
            Self::SystemFdQuotaExceeded => "SystemFdQuotaExceeded",
            Self::SystemResources => "SystemResources",
            Self::ReadOnlyFileSystem => "ReadOnlyFileSystem",
            Self::FileSystem => "FileSystem",
            Self::FileBusy => "FileBusy",
            Self::DeviceBusy => "DeviceBusy",
            Self::InvalidUtf8 => "InvalidUtf8",
            Self::InvalidWtf8 => "InvalidWtf8",
            Self::TarballHTTP400 => "TarballHTTP400",
            Self::TarballHTTP401 => "TarballHTTP401",
            Self::TarballHTTP402 => "TarballHTTP402",
            Self::TarballHTTP403 => "TarballHTTP403",
            Self::TarballHTTP404 => "TarballHTTP404",
            Self::TarballHTTP4xx => "TarballHTTP4xx",
            Self::TarballHTTP5xx => "TarballHTTP5xx",
            Self::TarballFailedToExtract => "TarballFailedToExtract",
            Self::TarballFailedToDownload => "TarballFailedToDownload",
            Self::BadRequest => "BadRequest",
            Self::TooManyRequests => "TooManyRequests",
            Self::HTTPInternalServerError => "HTTPInternalServerError",
            Self::UnexpectedNotModified => "UnexpectedNotModified",
            Self::PackageFailedToParse => "PackageFailedToParse",
            Self::BufferTooSmall => "BufferTooSmall",
            Self::DanglingSymlink => "DanglingSymlink",
            Self::UnsupportedYarnLockfileVersion => "UnsupportedYarnLockfileVersion",
            Self::InvalidPackageJSON => "InvalidPackageJSON",
            Self::LockfileResolveFailed => "LockfileResolveFailed",
            Self::DistTagNotFound => "DistTagNotFound",
            Self::NoMatchingVersion => "NoMatchingVersion",
            Self::TooRecentVersion => "TooRecentVersion",
            Self::MissingPackageJSON => "MissingPackageJSON",
            Self::InstallFailed => "InstallFailed",
            Self::HTTPError => "HTTPError",
            Self::Failed => "Failed",
            Self::UnrecognizedDependencyFormat => "UnrecognizedDependencyFormat",
            Self::NoGlobalDirectoryFound => "No global directory found",
            Self::InvalidPackageID => "InvalidPackageID",
            Self::PartialInstallFailed => "PartialInstallFailed",
            Self::NoPackagesInstalled => "NoPackagesInstalled",
            Self::SecurityScannerInWorkspace => "SecurityScannerInWorkspace",
            Self::SecurityScannerRetryFailed => "SecurityScannerRetryFailed",
            Self::IPCPipeFailed => "IPCPipeFailed",
            Self::JSONPipeWriterFailed => "JSONPipeWriterFailed",
            Self::ProcessWatchFailed => "ProcessWatchFailed",
            Self::SecurityScannerProcessFailedWithoutExitStatus => {
                "SecurityScannerProcessFailedWithoutExitStatus"
            }
            Self::NoSecurityScanData => "NoSecurityScanData",
            Self::InvalidIPCMessage => "InvalidIPCMessage",
            Self::InvalidIPCFormat => "InvalidIPCFormat",
            Self::MissingIPCType => "MissingIPCType",
            Self::InvalidIPCType => "InvalidIPCType",
            Self::MissingErrorCode => "MissingErrorCode",
            Self::InvalidErrorCode => "InvalidErrorCode",
            Self::UnknownErrorCode => "UnknownErrorCode",
            Self::SecurityScannerNotFound => "SecurityScannerNotFound",
            Self::SecurityScannerNotInDependencies => "SecurityScannerNotInDependencies",
            Self::InvalidScannerVersion => "InvalidScannerVersion",
            Self::ScannerFailed => "ScannerFailed",
            Self::UnknownMessageType => "UnknownMessageType",
            Self::MissingAdvisoriesField => "MissingAdvisoriesField",
            Self::SecurityScannerFailed => "SecurityScannerFailed",
            Self::SecurityScannerTerminated => "SecurityScannerTerminated",
            Self::InvalidAdvisoriesFormat => "InvalidAdvisoriesFormat",
            Self::InvalidAdvisoryFormat => "InvalidAdvisoryFormat",
            Self::MissingPackageField => "MissingPackageField",
            Self::InvalidPackageField => "InvalidPackageField",
            Self::EmptyPackageField => "EmptyPackageField",
            Self::InvalidDescriptionField => "InvalidDescriptionField",
            Self::InvalidUrlField => "InvalidUrlField",
            Self::MissingLevelField => "MissingLevelField",
            Self::InvalidLevelField => "InvalidLevelField",
            Self::InvalidLevelValue => "InvalidLevelValue",
            Self::MissingGlobalBinDirectoryTrySettingBUNINSTALL => {
                "Missing global bin directory: try setting $BUN_INSTALL"
            }
            Self::InvalidURL => "InvalidURL",
            Self::Fail => "Fail",
            Self::IntegrityCheckFailed => "IntegrityCheckFailed",
            Self::RepositoryNotFound => "RepositoryNotFound",
            Self::DebugTextLockfileRoundTrip => "DebugTextLockfileRoundTrip",
            Self::NoPackage => "NoPackage",
            Self::BrokenPipe => "BrokenPipe",
            Self::WriteFailed => "WriteFailed",
            Self::InvalidCharacter => "InvalidCharacter",
            Self::InvalidLockfile => "InvalidLockfile",
            Self::UnexpectedLockfileVersion => "Unexpected lockfile version",
            Self::OutdatedLockfileVersion => "Outdated lockfile version",
            Self::LockfileIsMissingData => "Lockfile is missing data",
            Self::LockfileIsMalformedExpected0AtTheEnd => {
                "Lockfile is malformed (expected 0 at the end)"
            }
            Self::CorruptLockfile => "CorruptLockfile",
            Self::LockfileIsMissingResolutionData => "Lockfile is missing resolution data",
            Self::MissingPackageName => "MissingPackageName",
            Self::GlobError => "GlobError",
            Self::Invalid => "Invalid",
            Self::LockfileValidationFailedListIsImpossiblyLong => {
                "Lockfile validation failed: list is impossibly long"
            }
            Self::LockfileValidationFailedAlignmentMismatch => {
                "Lockfile validation failed: alignment mismatch"
            }
            Self::LockfileValidationFailedUnexpectedNumberOfPackageFields => {
                "Lockfile validation failed: unexpected number of package fields"
            }
            Self::LockfileValidationFailedInvalidPackageListRange => {
                "Lockfile validation failed: invalid package list range"
            }
            Self::LockfileValidationFailedInvalidResolutionTag => {
                "Lockfile validation failed: invalid resolution tag"
            }
            Self::LockfileValidationFailedInvalidPackageMeta => {
                "Lockfile validation failed: invalid package meta"
            }
            Self::LockfileValidationFailedInvalidBinTag => {
                "Lockfile validation failed: invalid bin tag"
            }
            Self::LockfileValidationFailedInvalidPackageScripts => {
                "Lockfile validation failed: invalid package scripts"
            }
            Self::NPMLockfileVersionMismatch => "NPMLockfileVersionMismatch",
            Self::InvalidNPMLockfile => "InvalidNPMLockfile",
            Self::PathTooLong => "PathTooLong",
            Self::LockfileWorkspaceMissingResolved => "LockfileWorkspaceMissingResolved",
            Self::NotAllPackagesGotResolved => "NotAllPackagesGotResolved",
            Self::DependencyLoop => "DependencyLoop",
            Self::NotSupported => "NotSupported",
            Self::Unexpected => "Unexpected",
            Self::NotSameFileSystem => "NotSameFileSystem",
            Self::FailedToCopyFile => "FailedToCopyFile",
            Self::InvalidBinCount => "InvalidBinCount",
            Self::InvalidBinContent => "InvalidBinContent",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
            Self::Resolver(e) => e.name(),
            Self::Spawn(e) => e.name(),
            Self::Http(e) => e.name(),
            Self::PackageManifest(e) => <&'static str>::from(e),
            Self::Dotenv(e) => e.name(),
            Self::Parsers(e) => e.name(),
            Self::Bunfig(e) => e.name(),
            Self::Transpiler(e) => e.name(),
            Self::Zlib(e) => <&'static str>::from(e),
            Self::Paths(e) => e.name(),
            Self::PathOptions(e) => <&'static str>::from(e),
            Self::Fmt(_) => "FmtError",
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        Error::name(self).as_bytes()
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

impl From<bun_libarchive::Error> for Error {
    fn from(e: bun_libarchive::Error) -> Self {
        match e {
            bun_libarchive::Error::Fail => Self::Fail,
            bun_libarchive::Error::Sys(s) => Self::Sys(s),
            bun_libarchive::Error::Alloc(a) => Self::Alloc(a),
            bun_libarchive::Error::MakeLibUvOwned(_) => Self::SystemFdQuotaExceeded,
            bun_libarchive::Error::Paths(p) => Self::Paths(p),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::WriteFailed
    }
}

impl From<crate::lockfile_real::tree::SubtreeError> for Error {
    fn from(e: crate::lockfile_real::tree::SubtreeError) -> Self {
        use crate::lockfile_real::tree::SubtreeError as E;
        match e {
            E::OutOfMemory => Self::Alloc(bun_alloc::AllocError),
            E::DependencyLoop => Self::DependencyLoop,
        }
    }
}

impl From<crate::lockfile_real::bun_lock::ParseError> for Error {
    fn from(e: crate::lockfile_real::bun_lock::ParseError) -> Self {
        match e {
            crate::lockfile_real::bun_lock::ParseError::OutOfMemory => {
                Self::Alloc(bun_alloc::AllocError)
            }
            _ => Self::InvalidLockfile,
        }
    }
}

impl From<crate::pnpm::MigratePnpmLockfileError> for Error {
    fn from(e: crate::pnpm::MigratePnpmLockfileError) -> Self {
        use crate::pnpm::MigratePnpmLockfileError as E;
        match e {
            E::OutOfMemory => Self::Alloc(bun_alloc::AllocError),
            E::DependencyLoop => Self::DependencyLoop,
            _ => Self::InvalidLockfile,
        }
    }
}

impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        match e {
            Error::Core(inner) => inner,
            Error::Alloc(a) => bun_core::Error::Alloc(a),
            Error::WriteFailed => bun_core::Error::WriteFailed,
            Error::InvalidCharacter => bun_core::Error::InvalidCharacter,
            _ => bun_core::Error::Unexpected,
        }
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
