#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("Unusable")]
    Unusable,
    #[error("InvalidDataURL")]
    InvalidDataURL,
    #[error("MissingResolveDir")]
    MissingResolveDir,
    #[error("InvalidResolveDir")]
    InvalidResolveDir,
    #[error("ModuleNotFound")]
    ModuleNotFound,
    #[error("VersionSpecifierNotAllowedHere")]
    VersionSpecifierNotAllowedHere,
    #[error("ParseErrorAlreadyLogged")]
    ParseErrorAlreadyLogged,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    Core(#[from] bun_core::Error),
    #[error(transparent)]
    Overflow(#[from] bun_core::bounded_array::OverflowError),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Unusable => "Unusable",
            Self::InvalidDataURL => "InvalidDataURL",
            Self::MissingResolveDir => "MissingResolveDir",
            Self::InvalidResolveDir => "InvalidResolveDir",
            Self::ModuleNotFound => "ModuleNotFound",
            Self::VersionSpecifierNotAllowedHere => "VersionSpecifierNotAllowedHere",
            Self::ParseErrorAlreadyLogged => "ParseErrorAlreadyLogged",
            Self::Sys(e) => <&'static str>::from(e),
            Self::Alloc(_) => "OutOfMemory",
            Self::Core(e) => e.name(),
            Self::Overflow(_) => "Overflow",
        }
    }

    pub(crate) fn into_core(self) -> bun_core::Error {
        match self {
            Self::Alloc(a) => bun_core::Error::Alloc(a),
            Self::Core(e) => e,
            Self::Sys(bun_errno::SystemErrno::ENOENT) => bun_core::Error::FileNotFound,
            Self::Sys(bun_errno::SystemErrno::EACCES) => bun_core::Error::AccessDenied,
            Self::Sys(bun_errno::SystemErrno::ENAMETOOLONG) => bun_core::Error::NameTooLong,
            Self::Sys(bun_errno::SystemErrno::ENOSPC) => bun_core::Error::NoSpaceLeft,
            _ => bun_core::Error::Unexpected,
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
