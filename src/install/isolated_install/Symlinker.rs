#[cfg(not(windows))]
use bun_core::ZStr;
use bun_core::strings;
use bun_paths;
use bun_sys::{self, Errno, Fd};
#[cfg(windows)]
use bun_sys::{FdDirExt, FdExt};

/// Writes one dependency link. POSIX creates, reads and removes it with `*at`
/// calls on `dir` and the last component of `dest`, so no level above the link
/// is resolved by path again. Windows stays on paths: its `symlinkat` and
/// `readlinkat` resolve the directory's path first, and junctions need one.
pub(crate) struct Symlinker {
    /// The directory that holds the link. Not owned.
    #[cfg(not(windows))]
    pub(crate) dir: Fd,
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
            return bun_sys::symlinkat(self.target.slice_z(), self.dir, name(&mut self.dest));
        }
    }

    // Ok(true) when a link was written.
    pub(crate) fn ensure_symlink(&mut self, strategy: Strategy) -> bun_sys::Result<bool> {
        match strategy {
            Strategy::ExpectMissing => {
                return match self.symlink() {
                    Ok(()) => Ok(true),
                    Err(symlink_err1) => match symlink_err1.get_errno() {
                        #[cfg(windows)]
                        Errno::ENOENT => {
                            let Some(dest_parent) = self.dest.dirname() else {
                                return Err(symlink_err1);
                            };

                            let _ = Fd::cwd().make_path(dest_parent);
                            return self.symlink().map(|()| true);
                        }
                        Errno::EEXIST => {
                            self.delete_tree();
                            return self.symlink().map(|()| true);
                        }
                        _ => Err(symlink_err1),
                    },
                };
            }
            Strategy::ExpectExisting => {
                let mut current_link_buf = bun_paths::path_buffer_pool::get();
                let current_link_len = match self.readlink(&mut current_link_buf) {
                    Ok(len) => len,
                    Err(readlink_err) => {
                        return match readlink_err.get_errno() {
                            Errno::ENOENT => match self.symlink() {
                                Ok(()) => Ok(true),
                                Err(symlink_err) => match symlink_err.get_errno() {
                                    #[cfg(windows)]
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
                                if self.is_directory() {
                                    return Ok(false);
                                }
                                self.unlink_file();
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
                {
                    if strings::eql_long(current_link, self.fallback_junction_target.slice(), true)
                    {
                        return Ok(false);
                    }
                }

                // this existing link is pointing to the wrong package
                self.unlink_link();
                return self.symlink().map(|()| true);
            }
        }
    }

    fn readlink(&mut self, buf: &mut bun_paths::PathBuffer) -> bun_sys::Result<usize> {
        #[cfg(windows)]
        {
            return bun_sys::readlink(self.dest.slice_z(), &mut buf[..]);
        }
        #[cfg(not(windows))]
        {
            return bun_sys::readlinkat(self.dir, name(&mut self.dest), &mut buf[..]);
        }
    }

    /// Whether `dest` is a real directory (not a symlink or junction to one).
    fn is_directory(&mut self) -> bool {
        #[cfg(windows)]
        {
            return if let Some(a) = bun_sys::get_file_attributes(self.dest.slice_z()) {
                a.is_directory && !a.is_reparse_point
            } else {
                false
            };
        }
        #[cfg(not(windows))]
        {
            return if let Ok(st) = bun_sys::lstatat(self.dir, name(&mut self.dest)) {
                // `mode_t` is `u16` on darwin/freebsd/android, `u32` on linux.
                bun_sys::posix::s_isdir(st.st_mode as u32)
            } else {
                false
            };
        }
    }

    /// Remove a regular file at `dest`.
    fn unlink_file(&mut self) {
        #[cfg(windows)]
        {
            let _ = bun_sys::unlink(self.dest.slice_z());
        }
        #[cfg(not(windows))]
        {
            let _ = bun_sys::unlinkat(self.dir, name(&mut self.dest));
        }
    }

    /// Remove an existing symlink (or junction) at `dest`.
    fn unlink_link(&mut self) {
        #[cfg(windows)]
        {
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
            let _ = bun_sys::unlinkat(self.dir, name(&mut self.dest));
        }
    }

    /// Remove whatever is at `dest`, recursively when it is a real directory.
    fn delete_tree(&mut self) {
        #[cfg(windows)]
        {
            let _ = Fd::cwd().delete_tree(self.dest.slice_z());
        }
        #[cfg(not(windows))]
        {
            let _ = bun_sys::Dir::borrow(&self.dir).delete_tree(self.dest.basename());
        }
    }
}

/// The last component of `dest`: the link's name inside `Symlinker::dir`.
#[cfg(not(windows))]
fn name(dest: &mut bun_paths::Path) -> &ZStr {
    let name_len = dest.basename().len();
    let dest = dest.slice_z();
    ZStr::from_slice_with_nul(&dest.as_bytes_with_nul()[dest.len() - name_len..])
}

#[derive(Clone, Copy)]
pub enum Strategy {
    ExpectExisting,
    ExpectMissing,
}
