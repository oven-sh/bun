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
    #[error("ParseErrorAlreadyLogged")]
    ParseErrorAlreadyLogged,
    #[error("SecurityScannerConfigured")]
    SecurityScannerConfigured,
    #[error("UnreadableConfig")]
    UnreadableConfig,
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
            Self::ParseErrorAlreadyLogged => "ParseErrorAlreadyLogged",
            Self::SecurityScannerConfigured => "SecurityScannerConfigured",
            Self::UnreadableConfig => "UnreadableConfig",
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

    /// EMFILE or ENFILE: this process, or the system, had no free descriptor
    /// for an open. The path can name anything, or nothing.
    #[inline]
    pub(crate) fn is_out_of_descriptors(self) -> bool {
        use bun_errno::SystemErrno as E;
        matches!(self, Self::Sys(E::EMFILE | E::ENFILE))
    }
}

/// The errors of this thread that say that the process had no free descriptor
/// ([`Error::is_out_of_descriptors`]). What the resolver has after such an error
/// is a guess. It caches nothing of a guess, and a resolution that had one does
/// not succeed.
pub(crate) mod short_of_descriptors {
    use core::cell::Cell;

    use super::Error;

    thread_local! {
        static SEEN: Cell<(u32, Option<Error>)> = const { Cell::new((0, None)) };
    }

    /// Whether `err` is such an error. Counts it.
    #[inline]
    pub(crate) fn note(err: Error) -> bool {
        let short = err.is_out_of_descriptors();
        if short {
            count(err);
        }
        short
    }

    #[cold]
    fn count(err: Error) {
        SEEN.with(|seen| seen.set((seen.get().0.wrapping_add(1), Some(err))));
    }

    /// The count now, for [`since`] and [`rewind`].
    pub(crate) fn mark() -> u32 {
        SEEN.with(|seen| seen.get().0)
    }

    /// The last such error after `mark`.
    pub(crate) fn since(mark: u32) -> Option<Error> {
        let (count, last) = SEEN.with(Cell::get);
        if count == mark { None } else { last }
    }

    /// Forgets the errors after `mark`: what had them runs again.
    pub(crate) fn rewind(mark: u32) {
        SEEN.with(|seen| seen.set((mark, seen.get().1)));
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
