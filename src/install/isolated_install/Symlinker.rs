use bun_paths;
use bun_str::strings;
use bun_sys::{self, Errno, Fd};

pub struct Symlinker {
    // TODO(port): bun.Path/RelPath/AbsPath are comptime-config generic (`.{ .sep = .auto }`);
    // mapped to non-generic bun_paths types here — Phase B may need a `<const SEP: Sep>` param.
    pub dest: bun_paths::Path,
    pub target: bun_paths::RelPath,
    pub fallback_junction_target: bun_paths::AbsPath,
}

impl Symlinker {
    pub fn symlink(&self) -> bun_sys::Result<()> {
        #[cfg(windows)]
        {
            return bun_sys::symlink_or_junction(
                self.dest.slice_z(),
                self.target.slice_z(),
                self.fallback_junction_target.slice_z(),
            );
        }
        #[cfg(not(windows))]
        {
            return bun_sys::symlink(self.target.slice_z(), self.dest.slice_z());
        }
    }

    pub fn ensure_symlink(&self, strategy: Strategy) -> bun_sys::Result<()> {
        match strategy {
            Strategy::IgnoreFailure => {
                return match self.symlink() {
                    Ok(()) => Ok(()),
                    Err(symlink_err) => match symlink_err.errno() {
                        Errno::NOENT => {
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
                    Err(symlink_err1) => match symlink_err1.errno() {
                        Errno::NOENT => {
                            let Some(dest_parent) = self.dest.dirname() else {
                                return Err(symlink_err1);
                            };

                            let _ = Fd::cwd().make_path(dest_parent);
                            return self.symlink();
                        }
                        Errno::EXIST => {
                            let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                            return self.symlink();
                        }
                        _ => Err(symlink_err1),
                    },
                };
            }
            Strategy::ExpectExisting => {
                let mut current_link_buf = bun_paths::path_buffer_pool().get();
                let mut current_link: &[u8] =
                    match bun_sys::readlink(self.dest.slice_z(), &mut current_link_buf) {
                        Ok(res) => res,
                        Err(readlink_err) => {
                            return match readlink_err.errno() {
                                Errno::NOENT => match self.symlink() {
                                    Ok(()) => Ok(()),
                                    Err(symlink_err) => match symlink_err.errno() {
                                        Errno::NOENT => {
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
                                    let is_dir =
                                        if let Some(st) = bun_sys::lstat(self.dest.slice_z()).ok() {
                                            // TODO(port): @intCast(st.mode) — target width of S.ISDIR arg
                                            bun_sys::posix::s_isdir(st.mode as _)
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
                        Err(err) => match err.errno() {
                            Errno::PERM => {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/Symlinker.zig (143 lines)
//   confidence: medium
//   todos:      2
//   notes:      bun_paths::Path/RelPath/AbsPath sep-config generics, Errno variant names, and S.ISDIR mapping need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
