use bun_core::strings;
use bun_paths;
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

pub struct Symlinker {
    // TODO(port): bun.Path/RelPath/AbsPath are comptime-config generic (`.{ .sep = .auto }`);
    // mapped to non-generic bun_paths types here — Phase B may need a `<const SEP: Sep>` param.
    pub dest: bun_paths::Path,
    pub target: bun_paths::RelPath,
    pub fallback_junction_target: bun_paths::AbsPath,
}

impl Symlinker {
    // PORT NOTE: `&mut self` (vs Zig `*const`) because `Path::slice_z()` writes
    // the trailing NUL into its pooled buffer and so requires `&mut`.
    pub fn symlink(&mut self) -> bun_sys::Result<()> {
        #[cfg(windows)]
        {
            // PORT NOTE: borrowck — `slice_z()` mut-borrows each path to write
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

    pub fn ensure_symlink(&mut self, strategy: Strategy) -> bun_sys::Result<()> {
        match strategy {
            Strategy::IgnoreFailure => {
                return match self.symlink() {
                    Ok(()) => Ok(()),
                    Err(symlink_err) => match symlink_err.get_errno() {
                        Errno::ENOENT => {
                            let Some(dest_parent) = self.dest.dirname() else {
                                return Ok(());
                            };

                            let _ = Fd::cwd().make_path(dest_parent);
                            let _ = self.symlink();
                            return Ok(());
                        }
                        _ => Ok(()),
                    },
                };
            }
            Strategy::ExpectMissing => {
                return match self.symlink() {
                    Ok(()) => Ok(()),
                    Err(symlink_err1) => match symlink_err1.get_errno() {
                        Errno::ENOENT => {
                            let Some(dest_parent) = self.dest.dirname() else {
                                return Err(symlink_err1);
                            };

                            let _ = Fd::cwd().make_path(dest_parent);
                            return self.symlink();
                        }
                        Errno::EEXIST => {
                            let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                            return self.symlink();
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
                                    Ok(()) => Ok(()),
                                    Err(symlink_err) => match symlink_err.get_errno() {
                                        Errno::ENOENT => {
                                            let Some(dest_parent) = self.dest.dirname() else {
                                                return Err(symlink_err);
                                            };

                                            let _ = Fd::cwd().make_path(dest_parent);
                                            return self.symlink();
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
                                    let is_dir = if let Some(st) =
                                        bun_sys::lstat(self.dest.slice_z()).ok()
                                    {
                                        bun_sys::posix::s_isdir(st.st_mode as u32)
                                    } else {
                                        false
                                    };
                                    if is_dir {
                                        return Ok(());
                                    }
                                    let _ = bun_sys::unlink(self.dest.slice_z());
                                    return self.symlink();
                                }
                            };
                        }
                    };
                let mut current_link: &[u8] = &current_link_buf[..current_link_len];

                // libuv adds a trailing slash to junctions.
                current_link = strings::without_trailing_slash(current_link);

                if strings::eql_long(current_link, self.target.slice_z().as_bytes(), true) {
                    return Ok(());
                }

                #[cfg(windows)]
                {
                    if strings::eql_long(current_link, self.fallback_junction_target.slice(), true)
                    {
                        return Ok(());
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

                return self.symlink();
            }
        }
    }
}

pub enum Strategy {
    ExpectExisting,
    ExpectMissing,
    IgnoreFailure,
}

// ported from: src/install/isolated_install/Symlinker.zig
