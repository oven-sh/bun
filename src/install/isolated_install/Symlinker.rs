use bun_core::strings;
use bun_paths;
use bun_paths::path_options::AssumeOk as _;
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

use crate::package_manager_real::patch_package::is_patch_copy_link;

pub(crate) struct Symlinker {
    pub(crate) dest: bun_paths::Path,
    pub(crate) target: bun_paths::RelPath,
    #[cfg(windows)]
    pub(crate) fallback_junction_target: bun_paths::AbsPath,
}

impl Symlinker {
    // `&mut self` because `Path::slice_z()` writes
    // the trailing NUL into its pooled buffer and so requires `&mut`.
    pub(crate) fn symlink(&mut self) -> bun_sys::Result<()> {
        #[cfg(windows)]
        {
            // borrowck — `slice_z()` mut-borrows each path to write
            // the trailing NUL; bind the fallback first so all three borrows
            // are live disjointly when passed to `symlink_or_junction`.
            let fallback = self.fallback_junction_target.slice_z();
            return bun_sys::symlink_or_junction(
                self.dest.slice_z(),
                self.target.slice_z(),
                Some(fallback),
            );
        }
        #[cfg(not(windows))]
        {
            return bun_sys::symlink(self.target.slice_z(), self.dest.slice_z());
        }
    }

    // Ok(true) when a link was written.
    pub(crate) fn ensure_symlink(&mut self, strategy: Strategy) -> bun_sys::Result<bool> {
        match strategy {
            Strategy::ExpectMissing => {
                return match self.symlink() {
                    Ok(()) => Ok(true),
                    Err(symlink_err1) => match symlink_err1.get_errno() {
                        Errno::ENOENT => {
                            let Some(dest_parent) = self.dest.dirname() else {
                                return Err(symlink_err1);
                            };

                            let _ = Fd::cwd().make_path(dest_parent);
                            return self.symlink().map(|()| true);
                        }
                        Errno::EEXIST => {
                            let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                            return self.symlink().map(|()| true);
                        }
                        _ => Err(symlink_err1),
                    },
                };
            }
            Strategy::ExpectExisting | Strategy::ExpectExistingOrPatchCopy => {
                let mut current_link_buf = bun_paths::path_buffer_pool::get();
                let current_link_len =
                    match bun_sys::readlink(self.dest.slice_z(), &mut current_link_buf) {
                        Ok(len) => len,
                        Err(readlink_err) => {
                            return match readlink_err.get_errno() {
                                Errno::ENOENT => match self.symlink() {
                                    Ok(()) => Ok(true),
                                    Err(symlink_err) => match symlink_err.get_errno() {
                                        Errno::ENOENT => {
                                            let Some(dest_parent) = self.dest.dirname() else {
                                                return Err(symlink_err);
                                            };

                                            let _ = Fd::cwd().make_path(dest_parent);
                                            return self.symlink().map(|()| true);
                                        }
                                        _ => Err(symlink_err),
                                    },
                                },
                                // readlink failed for a reason other than NOENT —
                                // dest exists but isn't a symlink. If it's a real
                                // directory, leave it: this is the `bun patch <pkg>`
                                // workspace (a detached copy the user is editing
                                // before `--commit`), and `deleteTree` here would
                                // silently destroy their in-progress edits. If it's
                                // a regular file, replace it.
                                _ => {
                                    #[cfg(windows)]
                                    let is_dir = if let Some(a) =
                                        bun_sys::get_file_attributes(self.dest.slice_z())
                                    {
                                        a.is_directory && !a.is_reparse_point
                                    } else {
                                        false
                                    };
                                    #[cfg(not(windows))]
                                    let is_dir = if let Ok(st) = bun_sys::lstat(self.dest.slice_z())
                                    {
                                        // `mode_t` is `u16` on darwin/freebsd/android, `u32` on linux.
                                        bun_sys::posix::s_isdir(st.st_mode as u32)
                                    } else {
                                        false
                                    };
                                    if is_dir {
                                        return Ok(false);
                                    }
                                    let _ = bun_sys::unlink(self.dest.slice_z());
                                    return self.symlink().map(|()| true);
                                }
                            };
                        }
                    };
                let mut current_link: &[u8] = &current_link_buf[..current_link_len];

                // libuv adds a trailing slash to junctions.
                current_link = strings::without_trailing_slash(current_link);

                if strings::eql_long(current_link, self.target.slice_z().as_bytes(), true) {
                    return Ok(false);
                }

                #[cfg(windows)]
                if strings::eql_long(current_link, self.fallback_junction_target.slice(), true) {
                    return Ok(false);
                }

                if matches!(strategy, Strategy::ExpectExistingOrPatchCopy)
                    && self.is_link_to_patch_copy(current_link)
                {
                    return Ok(false);
                }

                #[cfg(windows)]
                {
                    // this existing link is pointing to the wrong package.
                    // on windows rmdir must be used for symlinks created to point
                    // at directories, even if the target no longer exists
                    match bun_sys::rmdir(self.dest.slice_z()) {
                        Ok(()) => {}
                        Err(err) => match err.get_errno() {
                            Errno::EPERM => {
                                let _ = bun_sys::unlink(self.dest.slice_z());
                            }
                            _ => {}
                        },
                    }
                }
                #[cfg(not(windows))]
                {
                    // this existing link is pointing to the wrong package
                    let _ = bun_sys::unlink(self.dest.slice_z());
                }

                return self.symlink().map(|()| true);
            }
        }
    }

    /// `bun patch` points the link of a dependency at its copy until `bun patch --commit`. A
    /// link to a copy that is gone, or that has no package.json, is a link with a wrong target.
    #[cold]
    fn is_link_to_patch_copy(&mut self, current_link: &[u8]) -> bool {
        if !is_patch_copy_link(self.dest.slice(), current_link) {
            return false;
        }
        let manifest = [self.dest.slice(), &[bun_paths::SEP], b"package.json"].concat();
        // `Path::from` does not check the length.
        if manifest.len() >= bun_paths::MAX_PATH_BYTES {
            return true;
        }
        let mut manifest = bun_paths::Path::<u8>::from(&*manifest).assume_ok();
        !matches!(
            bun_sys::stat(manifest.slice_z()).map_err(|err| err.get_errno()),
            Err(Errno::ENOENT | Errno::ENOTDIR)
        )
    }
}

#[derive(Clone, Copy)]
pub enum Strategy {
    ExpectExisting,
    /// `ExpectExisting`, for the links of the root and of a workspace: the link that
    /// `bun patch` points at its copy stays.
    ExpectExistingOrPatchCopy,
    ExpectMissing,
}

const _: () = assert!(core::mem::size_of::<Strategy>() == 1);
