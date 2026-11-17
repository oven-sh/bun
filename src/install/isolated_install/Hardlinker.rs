use bun_alloc::AllocError;
use bun_paths::{NameTooLong, OSPath, OSPathSlice};
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdExt};

// The walker opens each directory from its parent, so `entry.path` can have any length.
pub(crate) struct Hardlinker {
    pub(crate) src: OSPath,
    pub(crate) dest: OSPath,
    pub(crate) walker: Walker,
}

fn name_too_long(_: NameTooLong) -> sys::Error {
    sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::link)
}

impl Hardlinker {
    pub(crate) fn init(
        folder_dir: Fd,
        src: OSPath,
        dest: OSPath,
        skip_dirnames: &[&OSPathSlice],
    ) -> Result<Hardlinker, AllocError> {
        Ok(Hardlinker {
            src,
            dest,
            walker: {
                let mut w = bun_sys::walker_skippable::walk(
                    folder_dir,
                    // bun.default_allocator dropped — global mimalloc
                    &[],
                    skip_dirnames,
                )?;
                w.resolve_unknown_entry_types = true;
                w
            },
        })
    }

    pub(crate) fn link(&mut self) -> sys::Result<()> {
        if crate::PackageManager::verbose_install() {
            bun_core::pretty_errorln!(
                "Hardlinking {} to {}",
                bun_core::fmt::fmt_os_path(&self.src, Default::default()),
                bun_core::fmt::fmt_os_path(&self.dest, Default::default()),
            );
            bun_core::output::flush();
        }

        #[cfg(windows)]
        {
            let mut cwd_buf = bun_paths::w_path_buffer_pool::get();
            let dest_cwd: &[u16] = match sys::get_fd_path_w(Fd::cwd(), &mut cwd_buf[..]) {
                Ok(s) => &*s,
                Err(_) => return Err(sys::Error::from_code(sys::E::ACCES, sys::Tag::link)),
            };

            while let Some(entry) = self.walker.next()? {
                let src = self.src.push_scoped(entry.path).map_err(name_too_long)?;
                let dest = self.dest.push_scoped(entry.path).map_err(name_too_long)?;

                match entry.kind {
                    EntryKind::Directory => {
                        sys::make_path::make_path(&sys::Dir::cwd(), &dest)?;
                    }
                    EntryKind::File => {
                        // `dest` is absolute for an entry of the global virtual store.
                        let mut destfile_path =
                            OSPath::resolve(&[dest_cwd, &dest]).map_err(name_too_long)?;
                        destfile_path.make_nt_path().map_err(name_too_long)?;

                        let Err(link_err1) = sys::link_w(&src, &destfile_path) else {
                            continue;
                        };
                        let print_retry = |reason: &str| {
                            if crate::PackageManager::verbose_install() {
                                bun_core::pretty_errorln!(
                                    "Hardlinking {} to a path that {}: {}",
                                    bun_core::fmt::fmt_os_path(&src, Default::default()),
                                    reason,
                                    bun_core::fmt::EscapeControlChars(bun_core::fmt::fmt_os_path(
                                        &destfile_path,
                                        Default::default()
                                    )),
                                );
                            }
                        };
                        match link_err1.get_errno() {
                            sys::E::UV_EEXIST | sys::E::EEXIST => {
                                print_retry("already exists");
                                let _ = Fd::cwd().delete_tree(&bun_paths::Path::from(&dest));
                            }
                            sys::E::UV_ENOENT | sys::E::ENOENT => {
                                print_retry("doesn't exist");
                                let Some(dest_parent) = dest.dirname() else {
                                    return Err(link_err1);
                                };
                                let _ = sys::make_path::make_path(&sys::Dir::cwd(), dest_parent);
                            }
                            _ => return Err(link_err1),
                        }
                        sys::link_w(&src, &destfile_path)?;
                    }
                    _ => {}
                }
            }

            return Ok(());
        }

        #[cfg(not(windows))]
        {
            while let Some(entry) = self.walker.next()? {
                let dest = self.dest.push_scoped(entry.path).map_err(name_too_long)?;

                match entry.kind {
                    EntryKind::Directory => Fd::cwd().make_path(&dest)?,
                    EntryKind::File => {
                        let (dir, name) = (entry.dir, entry.basename);
                        let Err(link_err1) = sys::linkat(dir, name, Fd::cwd(), &dest) else {
                            continue;
                        };
                        match link_err1.get_errno() {
                            sys::E::EEXIST => {
                                let _ = Fd::cwd().delete_tree(&dest);
                            }
                            sys::E::ENOENT => {
                                let Some(dest_parent) = dest.dirname() else {
                                    return Err(link_err1);
                                };
                                let _ = Fd::cwd().make_path(dest_parent);
                            }
                            _ => return Err(link_err1),
                        }
                        sys::linkat(dir, name, Fd::cwd(), &dest)?;
                    }
                    _ => {}
                }
            }

            Ok(())
        }
    }
}
