use bun_paths::path_options::{Kind, PathSeparators};
use bun_paths::{AutoRelPath, Path};
use bun_sys::{self as sys, Errno, Fd, FdDirExt, FdExt};

// macOS clonefileat only

#[allow(dead_code)]
pub(crate) struct FileCloner<'a> {
    pub cache_dir: Fd,
    pub cache_dir_subpath: &'a mut AutoRelPath,
    pub dest_subpath: Path<u8, { Kind::ANY }, { PathSeparators::AUTO }>,
}

impl FileCloner<'_> {
    #[allow(dead_code)]
    fn clonefileat(&mut self) -> sys::Result<()> {
        sys::clonefileat(
            self.cache_dir,
            self.cache_dir_subpath.slice_z(),
            Fd::cwd(),
            self.dest_subpath.slice_z(),
        )
    }

    #[allow(dead_code)]
    pub(crate) fn clone(&mut self) -> sys::Result<()> {
        match self.clonefileat() {
            Ok(()) => Ok(()),
            Err(err) => match err.get_errno() {
                Errno::EEXIST => {
                    let _ = Fd::cwd().delete_tree(self.dest_subpath.slice());
                    self.clonefileat()
                }

                Errno::ENOENT => {
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

// ported from: src/install/isolated_install/FileCloner.zig
