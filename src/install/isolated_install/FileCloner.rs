use bun_core::ZStr;
use bun_paths::typed::{AnyPathBuf, Pooled};
use bun_sys::{self as sys, Errno, Fd, FdDirExt, FdExt};

use super::path_error;

// macOS clonefileat only

pub(crate) struct FileCloner<'a> {
    pub cache_dir: Fd,
    pub cache_dir_subpath: &'a ZStr,
    pub dest_subpath: AnyPathBuf<Pooled>,
}

impl FileCloner<'_> {
    pub(crate) fn clone(&self) -> sys::Result<()> {
        let dest = (self.dest_subpath.z()).map_err(path_error(sys::Tag::clonefile))?;
        let clonefileat =
            || sys::clonefileat(self.cache_dir, self.cache_dir_subpath, Fd::cwd(), dest);
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
                    let _ = Fd::cwd().delete_tree(dest);
                    clonefileat()
                }

                Errno::ENOENT => {
                    let Some(parent_dest_dir) =
                        (self.dest_subpath.get().ok()).and_then(|dest| dest.parent())
                    else {
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
