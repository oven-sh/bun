#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("KQueueError")]
    KQueueError,
    #[error(transparent)]
    Sys(#[from] bun_errno::SystemErrno),
    #[cfg(windows)]
    #[error(transparent)]
    Windows(#[from] crate::windows_watcher::Error),
}

impl Error {
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn name(&self) -> &'static str {
        match self {
            Self::KQueueError => "KQueueError",
            Self::Sys(e) => <&'static str>::from(e),
            #[cfg(windows)]
            Self::Windows(e) => <&'static str>::from(e),
        }
    }

    /// Names the exhausted limit when `inotify_init1(2)` / `kqueue(2)` failed
    /// with `EMFILE` or `ENFILE`, so the caller can print it as advice next to
    /// the errno. `None` for every other error.
    pub fn limit_hint(self) -> Option<&'static str> {
        #[cfg(not(unix))]
        {
            None
        }
        #[cfg(unix)]
        {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            const EMFILE: &str = "this process is out of file descriptors (ulimit -n), or this user is out of inotify instances (sysctl fs.inotify.max_user_instances). Raise the limit or close other file watchers.";
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            const EMFILE: &str =
                "this process is out of file descriptors. Raise the limit with \"ulimit -n\".";
            #[cfg(any(target_os = "linux", target_os = "android"))]
            const ENFILE: &str = "the system is out of file descriptors. Close other programs or raise sysctl fs.file-max.";
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            const ENFILE: &str = "the system is out of file descriptors. Close other programs or raise sysctl kern.maxfiles.";

            match self {
                Self::Sys(bun_errno::SystemErrno::EMFILE) => Some(EMFILE),
                Self::Sys(bun_errno::SystemErrno::ENFILE) => Some(ENFILE),
                _ => None,
            }
        }
    }
}

impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}

impl From<bun_sys::Error> for Error {
    #[inline]
    fn from(e: bun_sys::Error) -> Self {
        Self::Sys(e.into())
    }
}

pub type Result<T, E = Error> = core::result::Result<T, E>;
