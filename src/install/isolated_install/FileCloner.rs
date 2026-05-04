use bun_paths::{AutoRelPath, Path};
use bun_sys::{self as sys, Errno, Fd};

// macOS clonefileat only

pub struct FileCloner {
    pub cache_dir: Fd,
    pub cache_dir_subpath: AutoRelPath,
    // TODO(port): bun.Path(.{ .sep = .auto, .unit = .os }) — const-generic options on bun_paths::Path
    pub dest_subpath: Path,
}

impl FileCloner {
    fn clonefileat(&mut self) -> sys::Result<()> {
        sys::clonefileat(
            self.cache_dir,
            self.cache_dir_subpath.slice_z(),
            Fd::cwd(),
            self.dest_subpath.slice_z(),
        )
    }

    pub fn clone(&mut self) -> sys::Result<()> {
        match self.clonefileat() {
            Ok(()) => Ok(()),
            Err(err) => match err.get_errno() {
                Errno::EXIST => {
                    // Stale leftover (an earlier crash, or a re-run after the
                    // global-store staging directory wasn't cleaned). The
                    // global-store entry is published by an entry-level
                    // rename in `commitGlobalStoreEntry`, so it's always safe
                    // to wipe and re-clone here — we're only ever writing
                    // into a per-process staging directory or a project-local
                    // path, never into a published shared directory.
                    let _ = Fd::cwd().delete_tree(self.dest_subpath.slice());
                    self.clonefileat()
                }

                Errno::NOENT => {
                    let Some(parent_dest_dir) = self.dest_subpath.dirname() else {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/FileCloner.zig (47 lines)
//   confidence: medium
//   todos:      1
//   notes:      bun.Path/bun.AutoRelPath const-generic shape undefined; make_path drops comptime u8 type param
// ──────────────────────────────────────────────────────────────────────────
