//! How a finished directory gets into the install cache.

use core::fmt;

use bun_core::ZStr;
use bun_sys::{self as sys, Dir, E, Fd, O};

/// A cache entry being built in a directory whose name no other process knows.
/// Deleted on drop unless [`publish`](Self::publish) renamed it.
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

    /// Renames the directory to `to` in `cache_dir` and opens it.
    ///
    /// The name of a cache entry says what it holds, so the first writer wins: another
    /// install that shares the cache may publish `to` first and already be reading it.
    /// A folder there that passes `is_complete` is kept and opened. Only one that fails
    /// it is replaced.
    pub(crate) fn publish(
        mut self,
        cache_dir: Fd,
        to: &ZStr,
        is_complete: &dyn Fn(&Dir) -> bool,
    ) -> Result<Dir, RenameError> {
        const MAX_ATTEMPTS: u32 = 4;
        let cache = Dir::borrow(&cache_dir);
        let mut retry = RenameRetry::new();
        let mut attempts = 0;
        loop {
            // `rename` replaces a directory only when it is empty, so this never
            // overwrites a published folder.
            let Err(err) = retry.rename(self.parent, self.name, cache_dir, to) else {
                self.renamed = true;
                return cache.open_at(to.as_bytes()).map_err(RenameError::from);
            };
            attempts += 1;
            // What takes the name is removed in ways that cannot remove a published
            // folder, one that appears under the name meanwhile included.
            match cache.open_at_with(to.as_bytes(), O::RDONLY | O::CLOEXEC | O::NOFOLLOW) {
                Ok(published) if is_complete(&published) => return Ok(published),
                _ if attempts == MAX_ATTEMPTS => return Err(err),
                // Emptied through its own handle; `rmdir` only removes an empty folder.
                Ok(incomplete) => {
                    delete_children(&incomplete);
                    incomplete.close();
                    let _ = sys::rmdirat(cache_dir, to);
                }
                // Not a folder, or gone by now; `unlink` never removes a folder.
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

/// Deletes what `dir` holds. Nothing is looked up through the name of `dir`.
fn delete_children(dir: &Dir) {
    let mut entries = sys::iterate_dir(dir.fd());
    while let Ok(Some(entry)) = entries.next() {
        let _ = dir.delete_tree(entry.name.slice_u8());
    }
}

/// Renames of directories bun has just written.
///
/// Windows refuses to rename a directory while any process holds a file in it open without
/// `FILE_SHARE_DELETE`, which is how scanners and the indexer open new files. The renames of
/// one `RenameRetry` wait that out, together for `BUN_INSTALL_WINDOWS_RENAME_RETRY_MS`.
/// Nothing is tried again on POSIX, where an open file blocks no rename.
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

/// Links `<cache>/<name>/<version>` to the entry at `target`; auto-install resolves through
/// it. Best effort, and never replaces a link.
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
