use core::ops::Deref;

use bun_core::{ZStr, strings};
use bun_paths::typed::{Path, PathBuf, Pooled, View};
use bun_paths::{self, component};
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

use super::path_error;

pub(crate) struct Symlinker<'a, V: View<Unit = u8> + ?Sized> {
    pub(crate) dest: &'a mut PathBuf<V, Pooled>,
    /// Relative to the directory of `dest`. MISFIT: no view is NUL-terminated, so the type is lost.
    pub(crate) target: &'a ZStr,
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

// MISFIT: `View` does not lead to `Path`, so `parent()` is reached through `Deref`.
impl<V: View<Unit = u8> + Deref<Target = Path> + ?Sized> Symlinker<'_, V> {
    /// True if it looked at a directory, which may be gone now.
    fn remove_planted_parents(&mut self) -> bun_sys::Result<bool> {
        let dest = self.dest.get().map_err(path_error(bun_sys::Tag::lstat))?;
        let Some(parent) =
            (dest.parent().map(Path::as_bytes)).filter(|dir| dir.len() > self.real_len)
        else {
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

    pub(crate) fn symlink(&self) -> bun_sys::Result<()> {
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
            let dest = self.dest.z().map_err(path_error(bun_sys::Tag::symlink))?;
            return bun_sys::symlink(self.target, dest);
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
                let dest = self.dest.get().map_err(path_error(bun_sys::Tag::symlink))?;
                match symlink_err1.get_errno() {
                    Errno::ENOENT => {
                        let Some(dest_parent) = dest.parent() else {
                            return Err(symlink_err1);
                        };
                        let _ = Fd::cwd().make_path(dest_parent.as_bytes());
                    }
                    Errno::EEXIST if !self.is_behind_link => {
                        let _ = Fd::cwd().delete_tree(dest.as_bytes());
                    }
                    _ => return Err(symlink_err1),
                }
                self.symlink().map(|()| true)
            }
            Strategy::ExpectExisting => {
                let dest = self.dest.z().map_err(path_error(bun_sys::Tag::readlink))?;
                let mut current_link_buf = bun_paths::path_buffer_pool::get();
                let current_link_len = match bun_sys::readlink(dest, &mut current_link_buf) {
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
                                    && let Some(dest_parent) =
                                        self.dest.get().ok().and_then(|dest| dest.parent())
                                {
                                    let _ = Fd::cwd().make_path(dest_parent.as_bytes());
                                    linked = self.symlink();
                                }
                                match linked {
                                    // Another install made it since the readlink.
                                    Err(err) if may_retry && err.get_errno() == Errno::EEXIST => {
                                        self.ensure(strategy, false)
                                    }
                                    linked => linked.map(|()| true),
                                }
                            }
                            // Kept: the copy `bun patch <pkg>` made, a mount point (EBUSY).
                            _ => {
                                let mark = self.dest.mark();
                                let has_package_json = (self.dest.push(component!("package.json")))
                                    .z()
                                    .is_ok_and(bun_sys::exists_z);
                                self.dest.back_to(mark);
                                if has_package_json {
                                    return Ok(false);
                                }
                                if !self.is_behind_link {
                                    let dest =
                                        self.dest.z().map_err(path_error(bun_sys::Tag::rmdir))?;
                                    if bun_sys::rmdir(dest)
                                        .is_err_and(|err| err.get_errno() == Errno::EBUSY)
                                    {
                                        return Ok(false);
                                    }
                                    let _ = Fd::cwd().delete_tree(dest);
                                }
                                return self.symlink().map(|()| true);
                            }
                        };
                    }
                };
                let mut current_link: &[u8] = &current_link_buf[..current_link_len];

                // libuv adds a trailing slash to junctions.
                current_link = strings::without_trailing_slash(current_link);

                if !self.is_absolute && strings::eql_long(current_link, self.target, true) {
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
                let dest = self.dest.z().map_err(path_error(bun_sys::Tag::unlink))?;
                if cfg!(not(windows))
                    || bun_sys::rmdir(dest).is_err_and(|err| err.get_errno() == Errno::EPERM)
                {
                    let _ = bun_sys::unlink(dest);
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
