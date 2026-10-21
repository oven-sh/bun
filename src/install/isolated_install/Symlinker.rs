use bun_core::strings;
use bun_paths;
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

pub(crate) struct Symlinker {
    pub(crate) dest: bun_paths::Path,
    pub(crate) target: bun_paths::RelPath,
    /// The directories of `dest` after `dest[..real_len]` may be links that came with the project.
    pub(crate) real_len: usize,
    /// When greater than `real_len`, `dest[..node_modules_len]` is a workspace's `node_modules`. If
    /// that folder is a symlink, `ensure_symlink` fails with `ELOOP` before writing anything.
    pub(crate) node_modules_len: usize,
    /// True if `dest` is inside a symlinked `node_modules` (see `LinkedNodeModules`). A file or
    /// directory that is already at `dest` is then kept, and linking fails.
    pub(crate) is_behind_link: bool,
    /// Windows only: the link points to the absolute `fallback_junction_target` instead of the
    /// relative `target`. `LinkedNodeModules::resolve` explains why.
    pub(crate) is_absolute: bool,
    #[cfg(windows)]
    pub(crate) fallback_junction_target: bun_paths::AbsPath,
}

impl Symlinker {
    /// True if it looked at a directory, which may be gone now.
    fn remove_planted_parents(&mut self) -> bun_sys::Result<bool> {
        let Some(parent) = self.dest.dirname().filter(|dir| dir.len() > self.real_len) else {
            return Ok(false);
        };
        if self.real_len < self.node_modules_len {
            let mut buf = bun_paths::path_buffer_pool::get();
            let node_modules =
                bun_paths::resolve_path::z(&parent[..self.node_modules_len], &mut buf);
            if crate::prune::LinkedNodeModules::is_at(node_modules) == Some(true) {
                return Err(bun_sys::Error::from_code(Errno::ELOOP, bun_sys::Tag::lstat));
            }
            self.real_len = self.node_modules_len;
        }
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
            if self.is_absolute {
                return bun_sys::symlink_or_junction(self.dest.slice_z(), fallback, None);
            }
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
        self.ensure(strategy, true)
    }

    /// If `may_retry` is set and `symlink` fails with `EEXIST` right after `readlink` found nothing
    /// at `dest`, this runs once more to check what appeared there.
    fn ensure(&mut self, strategy: Strategy, may_retry: bool) -> bun_sys::Result<bool> {
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
                    Errno::EEXIST if !self.is_behind_link => {
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
                                return self.ensure(strategy, may_retry);
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
                                        Err(err)
                                            if may_retry && err.get_errno() == Errno::EEXIST =>
                                        {
                                            self.ensure(strategy, false)
                                        }
                                        linked => linked.map(|()| true),
                                    }
                                }
                                // Keep it. It's the copy that `bun patch <pkg>` made, or a mount
                                // point (EBUSY).
                                _ => {
                                    let has_package_json = {
                                        let mut dest = self.dest.save();
                                        if dest.try_append(b"package.json").is_err() {
                                            return Err(bun_sys::Error::from_code(
                                                Errno::ENAMETOOLONG,
                                                bun_sys::Tag::access,
                                            ));
                                        }
                                        bun_sys::exists_z(dest.slice_z())
                                    };
                                    if has_package_json {
                                        return Ok(false);
                                    }
                                    if !self.is_behind_link {
                                        if bun_sys::rmdir(self.dest.slice_z())
                                            .is_err_and(|err| err.get_errno() == Errno::EBUSY)
                                        {
                                            return Ok(false);
                                        }
                                        let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                                    }
                                    return self.symlink().map(|()| true);
                                }
                            };
                        }
                    };
                let mut current_link: &[u8] = &current_link_buf[..current_link_len];

                // libuv adds a trailing slash to junctions.
                current_link = strings::without_trailing_slash(current_link);

                if !self.is_absolute
                    && strings::eql_long(current_link, self.target.slice_z().as_bytes(), true)
                {
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
                    return self.ensure(strategy, may_retry);
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
