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
}

impl Error {
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
        }
    }
}

impl From<bun_sys::Error> for Error {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.get_errno())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
