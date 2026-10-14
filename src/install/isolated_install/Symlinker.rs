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

/// What `ensure_symlink` did.
pub(crate) enum Link {
    /// The link was correct, or what is at `dest` stays as it is.
    Unchanged,
    Written,
    /// A directory was at `dest`. It is at this path now, and the link is written.
    Moved(Box<[u8]>),
    /// A directory is at `dest` and could not move. No link is written.
    Kept(Box<bun_sys::Error>),
}

/// The name of a moved directory starts with this. A random part follows: nothing is replaced.
pub(crate) const DISPLACED_PREFIX: &[u8] = b".old_";

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

    pub(crate) fn ensure_symlink(&mut self, strategy: Strategy) -> bun_sys::Result<Link> {
        match strategy {
            Strategy::ExpectMissing => {
                return match self.symlink() {
                    Ok(()) => Ok(Link::Written),
                    Err(symlink_err1) => match symlink_err1.get_errno() {
                        Errno::ENOENT => {
                            let Some(dest_parent) = self.dest.dirname() else {
                                return Err(symlink_err1);
                            };

                            let _ = Fd::cwd().make_path(dest_parent);
                            return self.symlink().map(|()| Link::Written);
                        }
                        Errno::EEXIST => {
                            let _ = Fd::cwd().delete_tree(self.dest.slice_z());
                            return self.symlink().map(|()| Link::Written);
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
                                    Ok(()) => Ok(Link::Written),
                                    Err(symlink_err) => match symlink_err.get_errno() {
                                        Errno::ENOENT => {
                                            let Some(dest_parent) = self.dest.dirname() else {
                                                return Err(symlink_err);
                                            };

                                            let _ = Fd::cwd().make_path(dest_parent);
                                            return self.symlink().map(|()| Link::Written);
                                        }
                                        _ => Err(symlink_err),
                                    },
                                },
                                _ => match strategy {
                                    Strategy::ExpectExistingOrPatchCopy => self.replace_occupant(),
                                    _ => self.replace_file_keep_directory(),
                                },
                            };
                        }
                    };
                let mut current_link: &[u8] = &current_link_buf[..current_link_len];

                // libuv adds a trailing slash to junctions.
                current_link = strings::without_trailing_slash(current_link);

                if strings::eql_long(current_link, self.target.slice_z().as_bytes(), true) {
                    return Ok(Link::Unchanged);
                }

                #[cfg(windows)]
                if strings::eql_long(current_link, self.fallback_junction_target.slice(), true) {
                    return Ok(Link::Unchanged);
                }

                if matches!(strategy, Strategy::ExpectExistingOrPatchCopy)
                    && self.is_link_to_patch_copy(current_link)
                {
                    return Ok(Link::Unchanged);
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

                return self.symlink().map(|()| Link::Written);
            }
        }
    }

    /// True for the link of `bun patch` to its copy, when the copy still has a package.json.
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

    fn dest_is_directory(&mut self) -> bool {
        #[cfg(windows)]
        {
            bun_sys::get_file_attributes(self.dest.slice_z())
                .is_some_and(|a| a.is_directory && !a.is_reparse_point)
        }
        #[cfg(not(windows))]
        {
            // `mode_t` is `u16` on darwin/freebsd/android, `u32` on linux.
            bun_sys::lstat(self.dest.slice_z())
                .is_ok_and(|st| bun_sys::posix::s_isdir(st.st_mode as u32))
        }
    }

    /// True when a directory between the project and `dest` is a link, so `dest` is outside it.
    fn dest_is_behind_link(&self) -> bool {
        let project = strings::without_trailing_slash(bun_core::top_level_dir());
        let mut dir = self.dest.dirname();
        while let Some(path) = dir.filter(|path| path.len() > project.len()) {
            if is_link(path) {
                return true;
            }
            dir = bun_paths::dirname(path);
        }
        false
    }

    fn replace_file(&mut self) -> bun_sys::Result<Link> {
        let _ = bun_sys::unlink(self.dest.slice_z());
        self.symlink().map(|()| Link::Written)
    }

    /// `dest` exists and is not a link. A directory stays and a file is replaced.
    #[cold]
    fn replace_file_keep_directory(&mut self) -> bun_sys::Result<Link> {
        if self.dest_is_directory() {
            return Ok(Link::Unchanged);
        }
        self.replace_file()
    }

    /// `dest` is a file (replaced) or a directory (moved aside, or kept with a warning).
    #[cold]
    fn replace_occupant(&mut self) -> bun_sys::Result<Link> {
        // Kept: `.bun`, `.bin` and `.cache` of node_modules itself, and what is behind a link.
        if self.dest.basename().first() == Some(&b'.') || self.dest_is_behind_link() {
            return self.replace_file_keep_directory();
        }
        #[cfg(windows)]
        if !self.dest_is_directory() {
            return self.replace_file();
        }

        let err = match bun_sys::rmdir(self.dest.slice_z()) {
            Ok(()) => return self.symlink().map(|()| Link::Written),
            Err(err) => err,
        };
        match err.get_errno() {
            Errno::ENOENT => self.symlink().map(|()| Link::Written),
            Errno::ENOTDIR => self.replace_file(),
            // A directory that is not empty.
            Errno::ENOTEMPTY | Errno::EEXIST => self.move_aside(),
            // For example a mount point. `bun_sys::rmdir` names its syscall `unlink`.
            _ if self.dest_is_directory() => Ok(Link::Kept(Box::new(
                err.with_path_and_syscall(self.dest.slice(), bun_sys::Tag::rmdir),
            ))),
            _ => self.replace_file(),
        }
    }

    /// Moves the directory at `dest` to a new name beside it, then writes the link.
    fn move_aside(&mut self) -> bun_sys::Result<Link> {
        let mut aside = [
            self.dest.dirname().unwrap_or(b"."),
            &[bun_paths::SEP],
            DISPLACED_PREFIX,
            self.dest.basename(),
        ]
        .concat();
        {
            use std::io::Write as _;
            let random = bun_core::fast_random();
            let _ = write!(
                aside,
                "-{}",
                bun_core::fmt::hex_lower(bun_core::bytes_of(&random))
            );
        }
        // `Path::from` does not check the length.
        if aside.len() >= bun_paths::MAX_PATH_BYTES {
            return Ok(Link::Kept(Box::new(
                bun_sys::Error::from_code(Errno::ENAMETOOLONG, bun_sys::Tag::rename)
                    .with_path_dest(self.dest.slice(), &aside),
            )));
        }
        let mut aside_path = bun_paths::Path::<u8>::from(&*aside).assume_ok();

        if let Err(err) = bun_sys::renameat(
            Fd::cwd(),
            self.dest.slice_z(),
            Fd::cwd(),
            aside_path.slice_z(),
        ) {
            return Ok(Link::Kept(Box::new(
                err.with_path_dest(self.dest.slice(), &aside),
            )));
        }
        if let Err(err) = self.symlink() {
            return Err(
                match bun_sys::renameat(
                    Fd::cwd(),
                    aside_path.slice_z(),
                    Fd::cwd(),
                    self.dest.slice_z(),
                ) {
                    Ok(()) => err,
                    // The directory is not where it was. This error names where it is.
                    Err(_) => err.with_path_dest(self.dest.slice(), &aside),
                },
            );
        }
        Ok(Link::Moved(aside.into_boxed_slice()))
    }
}

fn is_link(path: &[u8]) -> bool {
    let mut path = bun_paths::Path::<u8>::from(path).assume_ok();
    #[cfg(windows)]
    {
        bun_sys::get_file_attributes(path.slice_z()).is_some_and(|a| a.is_reparse_point)
    }
    #[cfg(not(windows))]
    {
        bun_sys::lstat(path.slice_z()).is_ok_and(|st| bun_sys::posix::s_islnk(st.st_mode as u32))
    }
}

#[derive(Clone, Copy)]
pub enum Strategy {
    /// A link with another target is written again. A file is replaced. A directory stays.
    ExpectExisting,
    /// For root and workspace links: the link of `bun patch` to its copy stays, a directory moves.
    ExpectExistingOrPatchCopy,
    ExpectMissing,
}

const _: () = assert!(core::mem::size_of::<Strategy>() == 1);
