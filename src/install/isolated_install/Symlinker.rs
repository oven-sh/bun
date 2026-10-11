use bun_core::strings;
use bun_paths;
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

pub(crate) struct Symlinker {
    pub(crate) dest: bun_paths::Path,
    pub(crate) target: bun_paths::RelPath,
    /// The directories of `dest` after `dest[..real_len]` may be links that came with the project.
    pub(crate) real_len: usize,
    #[cfg(windows)]
    pub(crate) fallback_junction_target: bun_paths::AbsPath,
}

impl Symlinker {
    /// True if it looked at a directory, which may be gone now.
    fn remove_planted_parents(&mut self) -> bun_sys::Result<bool> {
        let Some(parent) = self.dest.dirname().filter(|dir| dir.len() > self.real_len) else {
            return Ok(false);
        };
        crate::prune::remove_planted_links(parent, self.real_len)?;
        self.real_len = parent.len();
        Ok(true)
    }

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
                self.remove_planted_parents()?;
                let Err(symlink_err1) = self.symlink() else {
                    return Ok(true);
                };
                match symlink_err1.get_errno() {
                    Errno::ENOENT => {
                        let Some(dest_parent) = self.dest.dirname() else {
                            return Err(symlink_err1);
                        };
                        let _ = Fd::cwd().make_path(dest_parent);
                    }
                    Errno::EEXIST => {
                        let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                    }
                    _ => return Err(symlink_err1),
                }
                self.symlink().map(|()| true)
            }
            Strategy::ExpectExisting => {
                let mut current_link_buf = bun_paths::path_buffer_pool::get();
                let current_link_len =
                    match bun_sys::readlink(self.dest.slice_z(), &mut current_link_buf) {
                        Ok(len) => len,
                        Err(readlink_err) => {
                            if self.remove_planted_parents()? {
                                return self.ensure_symlink(strategy);
                            }
                            return match readlink_err.get_errno() {
                                Errno::ENOENT => {
                                    let mut linked = self.symlink();
                                    if linked
                                        .as_ref()
                                        .is_err_and(|err| err.get_errno() == Errno::ENOENT)
                                        && let Some(dest_parent) = self.dest.dirname()
                                    {
                                        let _ = Fd::cwd().make_path(dest_parent);
                                        linked = self.symlink();
                                    }
                                    match linked {
                                        // Another install made it since the readlink.
                                        Err(err) if err.get_errno() == Errno::EEXIST => {
                                            self.ensure_symlink(strategy)
                                        }
                                        linked => linked.map(|()| true),
                                    }
                                }
                                // Kept: the copy `bun patch <pkg>` made, a mount point (EBUSY).
                                _ => {
                                    let has_package_json = {
                                        let mut dest = self.dest.save();
                                        let _ = dest.append(b"package.json");
                                        bun_sys::exists_z(dest.slice_z())
                                    };
                                    if has_package_json
                                        || bun_sys::rmdir(self.dest.slice_z())
                                            .is_err_and(|err| err.get_errno() == Errno::EBUSY)
                                    {
                                        return Ok(false);
                                    }
                                    let _ = Fd::cwd().delete_tree(self.dest.slice_z());
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

                if self.remove_planted_parents()? {
                    return self.ensure_symlink(strategy);
                }

                // The wrong package. On Windows a directory link, dangling or not, needs rmdir.
                if cfg!(not(windows))
                    || bun_sys::rmdir(self.dest.slice_z())
                        .is_err_and(|err| err.get_errno() == Errno::EPERM)
                {
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
