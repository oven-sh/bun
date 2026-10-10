use bun_core::strings;
use bun_paths;
use bun_paths::path_options::AssumeOk as _;
use bun_sys::{self, Errno, Fd, FdDirExt, FdExt};

use crate::package_manager_real::patch_package::PATCH_COPY_MARKER;

pub(crate) struct Symlinker {
    pub(crate) dest: bun_paths::Path,
    pub(crate) target: bun_paths::RelPath,
    #[cfg(windows)]
    pub(crate) fallback_junction_target: bun_paths::AbsPath,
}

/// What stands at `dest` when it is not a link.
enum Occupant {
    /// A directory that the strategy keeps.
    KeptDirectory,
    Directory,
    File,
}

/// A directory that was where a link belongs, and where it is now.
pub(crate) struct Displaced {
    pub(crate) link: Box<[u8]>,
    pub(crate) moved_to: Box<[u8]>,
}

/// Tasks on any thread add to it. The main thread reports it.
pub(crate) type DisplacedList = bun_core::Mutex<Vec<Displaced>>;

/// The name beside a link for the directory that was in its place. It has no random part, so
/// one link keeps one directory at most: the last one.
pub(crate) fn displaced_name(link_name: &[u8]) -> Vec<u8> {
    [b".old_", link_name].concat()
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
    pub(crate) fn ensure_symlink(
        &mut self,
        strategy: Strategy,
        displaced: &DisplacedList,
    ) -> bun_sys::Result<bool> {
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
            Strategy::ExpectExisting | Strategy::ExpectExistingKeepDirectory => {
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
                                _ => self.replace_occupant(strategy, displaced),
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

    /// `dest` exists and is not a link. Only a directory that `bun patch` marked stays
    /// (the user edits it until `bun patch --commit`), and with
    /// `ExpectExistingKeepDirectory` every directory stays.
    #[cold]
    fn replace_occupant(
        &mut self,
        strategy: Strategy,
        displaced: &DisplacedList,
    ) -> bun_sys::Result<bool> {
        let removed = match self.occupant(strategy)? {
            Occupant::KeptDirectory => return Ok(false),
            Occupant::File => bun_sys::unlink(self.dest.slice_z()),
            Occupant::Directory => bun_sys::rmdir(self.dest.slice_z()),
        };
        match removed {
            Ok(()) => {}
            Err(err) => match err.get_errno() {
                Errno::ENOENT => {}
                // A directory that is not empty.
                Errno::ENOTEMPTY | Errno::EEXIST => {
                    return self.replace_directory(displaced).map(|()| true);
                }
                _ => return Err(err),
            },
        }
        self.symlink().map(|()| true)
    }

    fn occupant(&mut self, strategy: Strategy) -> bun_sys::Result<Occupant> {
        let keep_every_directory = matches!(strategy, Strategy::ExpectExistingKeepDirectory);

        #[cfg(windows)]
        {
            let is_directory = bun_sys::get_file_attributes(self.dest.slice_z())
                .is_some_and(|a| a.is_directory && !a.is_reparse_point);
            if !is_directory {
                return Ok(Occupant::File);
            }
            if keep_every_directory {
                return Ok(Occupant::KeptDirectory);
            }
            let mut marker = self.dest.save();
            let _ = marker.append(PATCH_COPY_MARKER);
            if bun_sys::get_file_attributes(marker.slice_z()).is_some_and(|a| a.is_directory) {
                return Ok(Occupant::KeptDirectory);
            }
            Ok(Occupant::Directory)
        }
        #[cfg(not(windows))]
        {
            // `mode_t` is `u16` on darwin/freebsd/android, `u32` on linux.
            if keep_every_directory {
                return Ok(match bun_sys::lstat(self.dest.slice_z()) {
                    Ok(st) if bun_sys::posix::s_isdir(st.st_mode as u32) => Occupant::KeptDirectory,
                    _ => Occupant::File,
                });
            }
            let mut marker = self.dest.save();
            let _ = marker.append(PATCH_COPY_MARKER);
            match bun_sys::lstat(marker.slice_z()) {
                Ok(st) if bun_sys::posix::s_isdir(st.st_mode as u32) => Ok(Occupant::KeptDirectory),
                // A file with the name of the marker is a file of the package.
                Ok(_) => Ok(Occupant::Directory),
                Err(err) => match err.get_errno() {
                    Errno::ENOENT => Ok(Occupant::Directory),
                    // `dest` is not a directory.
                    Errno::ENOTDIR => Ok(Occupant::File),
                    _ => Err(err),
                },
            }
        }
    }

    /// Moves the directory at `dest` to `displaced_name` beside it, then writes the link. The
    /// directory can hold files that exist nowhere else, so it is not deleted.
    fn replace_directory(&mut self, displaced: &DisplacedList) -> bun_sys::Result<()> {
        let name = displaced_name(self.dest.basename());
        let mut aside = bun_paths::Path::<u8>::from(&*match self.dest.dirname() {
            Some(parent) => [parent, &[bun_paths::SEP], &name].concat(),
            None => name,
        })
        .assume_ok();

        if let Err(err) = Fd::cwd().delete_tree(aside.slice()).and_then(|()| {
            bun_sys::renameat(Fd::cwd(), self.dest.slice_z(), Fd::cwd(), aside.slice_z())
        }) {
            return Err(err.with_path_dest(self.dest.slice(), aside.slice()));
        }
        if let Err(err) = self.symlink() {
            // When the directory cannot move back, this error names where it is.
            bun_sys::renameat(Fd::cwd(), aside.slice_z(), Fd::cwd(), self.dest.slice_z())?;
            return Err(err);
        }

        displaced.lock().push(Displaced {
            link: Box::from(self.dest.slice()),
            moved_to: Box::from(aside.slice()),
        });
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub enum Strategy {
    /// A link with another target is written again. A file is replaced. A directory that
    /// `bun patch` did not mark moves aside.
    ExpectExisting,
    /// `ExpectExisting`, but every directory stays where it is.
    ExpectExistingKeepDirectory,
    ExpectMissing,
}

const _: () = assert!(core::mem::size_of::<Strategy>() == 1);
