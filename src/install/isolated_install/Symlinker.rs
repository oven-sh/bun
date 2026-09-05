use bun_core::strings;
use bun_paths;
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

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
            Strategy::ExpectExisting => {
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
                                // A real directory with a package.json is a `bun patch` workspace: keep it.
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
                                        let has_package_json = {
                                            let mut dest = self.dest.save();
                                            let _ = dest.append(b"package.json");
                                            bun_sys::exists_z(dest.slice_z())
                                        };
                                        if has_package_json {
                                            return Ok(false);
                                        }
                                        let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                                    } else {
                                        let _ = bun_sys::unlink(self.dest.slice_z());
                                    }
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
}

#[derive(Clone, Copy)]
pub enum Strategy {
    ExpectExisting,
    ExpectMissing,
}
