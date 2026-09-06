#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Fail")]
    Fail,
    /// libarchive could not parse the input (damaged header, truncated
    /// archive, ...). Carries `archive_error_string()`.
    #[error("{}", bstr::BStr::new(.0))]
    Archive(Box<[u8]>),
    /// A syscall failed while writing an entry to disk. Keeps the errno,
    /// syscall tag and path so callers can surface them.
    #[error("{0}")]
    Sys(bun_sys::Error),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    MakeLibUvOwned(#[from] bun_sys::MakeLibUvOwnedError),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Fail => "Fail",
            Self::Archive(_) => "InvalidArchive",
            Self::Sys(e) => e
                .get_error_code_tag_name()
                .map_or("UNKNOWN", |(name, _)| name),
            Self::Alloc(_) => "OutOfMemory",
            Self::MakeLibUvOwned(e) => <&'static str>::from(e),
            Self::Paths(e) => e.name(),
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
        Self::Sys(e)
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
