use bun_core::ZStr;
use bun_sys::{self as sys, Errno, Fd, FdDirExt, FdExt};

// macOS clonefileat only

pub(crate) struct FileCloner<'a> {
    pub cache_dir: Fd,
    pub cache_dir_subpath: &'a ZStr,
    pub dest_subpath: &'a ZStr,
}

impl FileCloner<'_> {
    fn clonefileat(&self) -> sys::Result<()> {
        sys::clonefileat(
            self.cache_dir,
            self.cache_dir_subpath,
            Fd::cwd(),
            self.dest_subpath,
        )
    }

    pub(crate) fn clone(&self) -> sys::Result<()> {
        match self.clonefileat() {
            Ok(()) => Ok(()),
            Err(err) => match err.get_errno() {
                Errno::EEXIST => {
                    // Stale leftover (an earlier crash, or a re-run after the
                    // global-store staging directory wasn't cleaned). The
                    // global-store entry is published by an entry-level
                    // rename in `commitGlobalStoreEntry`, so it's always safe
                    // to wipe and re-clone here — we're only ever writing
                    // into a per-process staging directory or a project-local
                    // path, never into a published shared directory.
                    let _ = Fd::cwd().delete_tree(self.dest_subpath);
                    self.clonefileat()
                }

                Errno::ENOENT => {
                    let Some(parent_dest_dir) = bun_paths::dirname(self.dest_subpath) else {
                        return Err(err);
                    };
                    let _ = Fd::cwd().make_path(parent_dest_dir);
                    self.clonefileat()
                }
                _ => Err(err),
            },
        }
    }
}
