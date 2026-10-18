use bun_paths::typed::{Path, SubPath, Z};
use bun_sys::{self as sys, Errno, Fd, FdDirExt, FdExt};

// macOS clonefileat only

pub(crate) struct FileCloner<'a> {
    pub cache_dir: Fd,
    pub cache_dir_subpath: &'a Z<SubPath>,
    pub dest_subpath: &'a Z<Path>,
}

impl FileCloner<'_> {
    pub(crate) fn clone(&self) -> sys::Result<()> {
        let dest = self.dest_subpath;
        let clonefileat = || {
            sys::clonefileat(
                self.cache_dir,
                self.cache_dir_subpath.z(),
                Fd::cwd(),
                dest.z(),
            )
        };
        match clonefileat() {
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
                    let _ = Fd::cwd().delete_tree(dest.as_bytes());
                    clonefileat()
                }

                Errno::ENOENT => {
                    let Some(parent_dest_dir) = dest.parent() else {
                        return Err(err);
                    };
                    let _ = Fd::cwd().make_path(parent_dest_dir.as_bytes());
                    clonefileat()
                }
                _ => Err(err),
            },
        }
    }
}
