//! Moves a finished directory into the install cache.

use core::fmt;

use bun_core::ZStr;
use bun_sys::{self as sys, Dir, E, Fd, O};

/// A cache entry being built under a name no other process knows. Deleted on drop if unpublished.
pub(crate) struct StagedEntry<'a> {
    parent: Fd,
    name: &'a ZStr,
    renamed: bool,
}

impl<'a> StagedEntry<'a> {
    pub(crate) fn new(parent: Fd, name: &'a ZStr) -> Self {
        Self {
            parent,
            name,
            renamed: false,
        }
    }

    pub(crate) fn name(&self) -> &'a ZStr {
        self.name
    }

    pub(crate) fn publish_and_open(
        self,
        cache_dir: Fd,
        to: &ZStr,
        is_complete: &dyn Fn(&Dir) -> bool,
    ) -> Result<Dir, RenameError> {
        match self.publish(cache_dir, to, is_complete)? {
            Some(kept) => Ok(kept),
            None => Ok(Dir::borrow(&cache_dir).open_at(to.as_bytes())?),
        }
    }

    /// The first writer wins: if a folder at `to` passes `is_complete`, it's kept and returned.
    pub(crate) fn publish(
        mut self,
        cache_dir: Fd,
        to: &ZStr,
        is_complete: &dyn Fn(&Dir) -> bool,
    ) -> Result<Option<Dir>, RenameError> {
        const MAX_ATTEMPTS: u32 = 4;
        let cache = Dir::borrow(&cache_dir);
        let mut retry = RenameRetry::new();
        let mut attempts = 0;
        let mut emptying_err: Option<sys::Error> = None;
        loop {
            // `rename` only replaces an empty directory, so it never replaces a published folder.
            let Err(err) = retry.rename(self.parent, self.name, cache_dir, to) else {
                self.renamed = true;
                return Ok(None);
            };
            attempts += 1;
            // Nothing below can remove a published folder, even one that appears in the meantime.
            match cache.open_at_with(to.as_bytes(), O::RDONLY | O::CLOEXEC | O::NOFOLLOW) {
                Ok(published) if is_complete(&published) => return Ok(Some(published)),
                // Prefer the error from emptying the folder, because it explains why the rename
                // kept failing.
                _ if attempts == MAX_ATTEMPTS => {
                    return Err(emptying_err.map_or(err, RenameError::from));
                }
                // Emptied through its own handle. `rmdir` only removes an empty folder.
                Ok(incomplete) => {
                    emptying_err = incomplete.delete_children().err();
                    incomplete.close();
                    let _ = sys::rmdirat(cache_dir, to);
                }
                // It isn't a folder, or it's gone by now. `unlink` never removes a folder.
                Err(_) => {
                    let _ = sys::unlinkat(cache_dir, to);
                }
            }
        }
    }
}

impl Drop for StagedEntry<'_> {
    fn drop(&mut self) {
        if !self.renamed {
            let _ = Dir::borrow(&self.parent).delete_tree(self.name.as_bytes());
        }
    }
}

/// Windows can't rename a directory while a virus scanner has one of its new files open. All the
/// waits share one time budget.
pub(crate) struct RenameRetry {
    #[cfg(windows)]
    started: Option<std::time::Instant>,
    #[cfg(windows)]
    backoff_ms: u64,
}

impl RenameRetry {
    pub(crate) fn new() -> Self {
        Self {
            #[cfg(windows)]
            started: None,
            #[cfg(windows)]
            backoff_ms: 0,
        }
    }

    #[cfg(not(windows))]
    pub(crate) fn rename(
        &mut self,
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
    ) -> Result<(), RenameError> {
        sys::renameat(from_dir, from, to_dir, to).map_err(RenameError::from)
    }

    #[cfg(windows)]
    pub(crate) fn rename(
        &mut self,
        from_dir: Fd,
        from: &ZStr,
        to_dir: Fd,
        to: &ZStr,
    ) -> Result<(), RenameError> {
        loop {
            let Err(err) = sys::renameat(from_dir, from, to_dir, to) else {
                return Ok(());
            };
            // A directory at `to` fails the rename with the same errors, and no wait helps.
            if !matches!(err.get_errno(), E::EPERM | E::EACCES | E::EBUSY)
                || sys::exists_at_type(to_dir, to).is_ok()
            {
                return Err(err.into());
            }
            let waited_ms = self
                .started
                .get_or_insert_with(std::time::Instant::now)
                .elapsed()
                .as_millis() as u64;
            if waited_ms
                >= bun_core::env_var::BUN_INSTALL_WINDOWS_RENAME_RETRY_MS
                    .get()
                    .unwrap()
            {
                return Err(RenameError {
                    err,
                    gave_up_after_ms: Some(waited_ms),
                });
            }
            // 10 ms more each time, up to 100 ms, as graceful-fs does.
            self.backoff_ms = (self.backoff_ms + 10).min(100);
            std::thread::sleep(core::time::Duration::from_millis(self.backoff_ms));
        }
    }
}

pub(crate) struct RenameError {
    pub(crate) err: sys::Error,
    /// Set when the budget of a [`RenameRetry`] ran out.
    pub(crate) gave_up_after_ms: Option<u64>,
}

impl From<sys::Error> for RenameError {
    fn from(err: sys::Error) -> Self {
        Self {
            err,
            gave_up_after_ms: None,
        }
    }
}

impl fmt::Display for RenameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.err, f)?;
        match self.gave_up_after_ms {
            Some(ms) => write!(
                f,
                " (gave up after retrying for {ms}ms; usually another process such as antivirus has a file in the directory open. Set BUN_INSTALL_WINDOWS_RENAME_RETRY_MS to wait longer)",
            ),
            None => Ok(()),
        }
    }
}

/// `<cache>/<name>/<version>`, for auto-install. Best effort, and never replaces a link.
pub(crate) fn create_index_link(
    cache_dir: Fd,
    cache_dir_path: &[u8],
    name: &[u8],
    version: &[u8],
    target: &ZStr,
) {
    if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX
        .get()
        .unwrap_or(false)
    {
        return;
    }
    let mut link_buf = bun_paths::path_buffer_pool::get();
    #[cfg(windows)]
    {
        if Dir::borrow(&cache_dir).make_path(name).is_err() {
            return;
        }
        let link = bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Windows>(
            cache_dir_path,
            &mut link_buf[..],
            &[name, version],
        );
        let _ = sys::sys_uv::symlink_uv(target, link, sys::windows::libuv::UV_FS_SYMLINK_JUNCTION);
    }
    #[cfg(not(windows))]
    {
        let _ = cache_dir_path;
        let link = bun_paths::resolve_path::join_z_buf::<bun_paths::platform::Auto>(
            &mut link_buf[..],
            &[name, version],
        );
        if let Err(err) = sys::symlinkat(target, cache_dir, link)
            && err.get_errno() == E::ENOENT
            && Dir::borrow(&cache_dir).make_path(name).is_ok()
        {
            let _ = sys::symlinkat(target, cache_dir, link);
        }
    }
}
