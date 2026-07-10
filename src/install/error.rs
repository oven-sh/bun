#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
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
    #[error("EISNOTDIR")]
    EISNOTDIR,
    #[error("EACCESS")]
    EACCESS,
    #[error("GlobError")]
    GlobError,
    #[error("PermissionDenied")]
    PermissionDenied,
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
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
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
            Self::SecurityScannerProcessFailedWithoutExitStatus => "SecurityScannerProcessFailedWithoutExitStatus",
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
            Self::MissingGlobalBinDirectoryTrySettingBUNINSTALL => "Missing global bin directory: try setting $BUN_INSTALL",
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
            Self::LockfileIsMalformedExpected0AtTheEnd => "Lockfile is malformed (expected 0 at the end)",
            Self::CorruptLockfile => "CorruptLockfile",
            Self::LockfileIsMissingResolutionData => "Lockfile is missing resolution data",
            Self::MissingPackageName => "MissingPackageName",
            Self::EISNOTDIR => "EISNOTDIR",
            Self::EACCESS => "EACCESS",
            Self::GlobError => "GlobError",
            Self::PermissionDenied => "PermissionDenied",
            Self::Invalid => "Invalid",
            Self::LockfileValidationFailedListIsImpossiblyLong => "Lockfile validation failed: list is impossibly long",
            Self::LockfileValidationFailedAlignmentMismatch => "Lockfile validation failed: alignment mismatch",
            Self::LockfileValidationFailedUnexpectedNumberOfPackageFields => "Lockfile validation failed: unexpected number of package fields",
            Self::LockfileValidationFailedInvalidPackageListRange => "Lockfile validation failed: invalid package list range",
            Self::LockfileValidationFailedInvalidResolutionTag => "Lockfile validation failed: invalid resolution tag",
            Self::LockfileValidationFailedInvalidPackageMeta => "Lockfile validation failed: invalid package meta",
            Self::LockfileValidationFailedInvalidBinTag => "Lockfile validation failed: invalid bin tag",
            Self::LockfileValidationFailedInvalidPackageScripts => "Lockfile validation failed: invalid package scripts",
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
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
