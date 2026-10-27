#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[error(transparent)]
    Parse(#[from] crate::ParseErr),
    #[error(transparent)]
    Spawn(#[from] bun_spawn::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Sys(e) => <&'static str>::from(e),
            Self::Parse(e) => <&'static str>::from(e),
            Self::Spawn(e) => e.name(),
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

#[derive(Debug)]
pub enum ApplyError {
    Sys(bun_sys::Error),
    /// The hunk's context and deleted lines match nowhere in the target file.
    HunkDoesNotApply {
        path: Box<[u8]>,
        /// 1-based.
        hunk: usize,
        /// The `-` start from the hunk header.
        line: u32,
    },
}

impl From<bun_sys::Error> for ApplyError {
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e)
    }
}

impl core::fmt::Display for ApplyError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Sys(e) => core::fmt::Display::fmt(e, f),
            Self::HunkDoesNotApply { path, hunk, line } => write!(
                f,
                "hunk #{} does not apply to {} (expected at line {})",
                hunk,
                bstr::BStr::new(path),
                line
            ),
        }
    }
}
