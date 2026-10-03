#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Fail")]
    Fail,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Alloc(#[from] bun_alloc::AllocError),
    #[error(transparent)]
    MakeLibUvOwned(#[from] bun_sys::MakeLibUvOwnedError),
    #[error(transparent)]
    Paths(#[from] bun_paths::Error),
}

impl Error {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Fail => "Fail",
            Self::Sys(e) => <&'static str>::from(e),
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
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;

/// Why `Archiver::extract_to_dir` or `Archiver::extract_to_disk` stopped.
/// [`Error`] keeps an errno at most. This keeps what a caller needs to report
/// the failure.
#[derive(Debug)]
pub enum ExtractFailure {
    /// The destination directory could not be opened.
    Destination(bun_sys::Error),
    /// A syscall failed while an entry was written.
    Entry {
        error: bun_sys::Error,
        /// The entry's path relative to the destination. UTF-8 on Windows.
        path: Box<[u8]>,
    },
    /// libarchive could not read the archive. The bytes are its message, empty
    /// if it set none.
    Archive(Box<[u8]>),
    Other(Error),
}

impl From<ExtractFailure> for Error {
    fn from(failure: ExtractFailure) -> Self {
        match failure {
            ExtractFailure::Destination(error) | ExtractFailure::Entry { error, .. } => {
                Self::Sys(error.into())
            }
            ExtractFailure::Archive(_) => Self::Fail,
            ExtractFailure::Other(error) => error,
        }
    }
}
