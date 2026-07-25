#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Clobber")]
    Clobber,
    #[error("SyntaxError")]
    SyntaxError,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    /// Node-shaped resolution failures: the `Msg` text is already Node's
    /// final message; `ResolveMessage` derives `code`/`name` from the tag
    /// and passes the text through untouched.
    #[error("ModuleNotFound")]
    ModuleNotFoundNode,
    #[error("PackagePathNotExported")]
    PackagePathNotExported,
    #[error("PackageImportNotDefined")]
    PackageImportNotDefined,
    #[error("InvalidPackageTarget")]
    InvalidPackageTarget,
    #[error("InvalidPackageConfig")]
    InvalidPackageConfig,
    #[error("InvalidModuleSpecifier")]
    InvalidModuleSpecifier,
    #[error("UnsupportedDirImport")]
    UnsupportedDirImport,
    #[error("UnsupportedEsmUrlScheme")]
    UnsupportedEsmUrlScheme,
    #[error("UnknownModuleFormat")]
    UnknownModuleFormat,
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Clobber => "Clobber",
            Self::SyntaxError => "SyntaxError",
            Self::ModuleNotFound | Self::ModuleNotFoundNode => "ModuleNotFound",
            Self::PackagePathNotExported => "PackagePathNotExported",
            Self::PackageImportNotDefined => "PackageImportNotDefined",
            Self::InvalidPackageTarget => "InvalidPackageTarget",
            Self::InvalidPackageConfig => "InvalidPackageConfig",
            Self::InvalidModuleSpecifier => "InvalidModuleSpecifier",
            Self::UnsupportedDirImport => "UnsupportedDirImport",
            Self::UnsupportedEsmUrlScheme => "UnsupportedEsmUrlScheme",
            Self::UnknownModuleFormat => "UnknownModuleFormat",
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
