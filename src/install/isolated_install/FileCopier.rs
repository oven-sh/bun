use bun_alloc::AllocError;
use bun_paths::{OSPathChar, OSPathSlice, OsPath};
use bun_sys::{self as sys, Dir, E, EntryKind, Fd, walker_skippable, walker_skippable::Walker};

pub(crate) struct FileCopier {
    pub(crate) src_path: OsPath,
    pub(crate) dest_subpath: OsPath,
    pub(crate) walker: Walker,
}

impl FileCopier {
    pub(crate) fn init(
        src_dir: Fd,
        src_path: OsPath,
        dest_subpath: OsPath,
        skip_dirnames: &[&OSPathSlice],
    ) -> Result<FileCopier, AllocError> {
        Ok(FileCopier {
            src_path,
            dest_subpath,
            walker: {
                let mut w = walker_skippable::walk(
                    src_dir,
                    // bun.default_allocator → deleted (global mimalloc)
                    &[],
                    skip_dirnames,
                )?;
                w.resolve_unknown_entry_types = true;
                w
            },
        })
    }

    // `Walker` owns its resources and drops automatically, so no explicit
    // `Drop` impl is needed.

    pub(crate) fn copy(&mut self) -> sys::Result<()> {
        #[cfg(windows)]
        let dest_subpath_u8 = &{
            let mut path = bun_paths::Path::from(&self.dest_subpath);
            path.remove_win32_prefix();
            path
        };
        #[cfg(not(windows))]
        let dest_subpath_u8 = &self.dest_subpath;
        let dest_dir = match bun_sys::make_path::make_open_path(
            &Dir::cwd(),
            dest_subpath_u8,
            Default::default(),
        ) {
            Ok(d) => d,
            Err(e) => {
                // TODO: remove the need for this and implement openDir makePath makeOpenPath in bun
                let errno: E = match e.get_errno() {
                    E::EACCES => E::EPERM,
                    other => other,
                };
                #[cfg(windows)]
                let errno = if errno == E::ENOTDIR {
                    E::ENOENT
                } else {
                    errno
                };

                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::copyfile));
            }
        };

        #[cfg(not(windows))]
        let mut copy_file_state = bun_sys::copy_file::CopyFileState::default();

        while let Some(entry) = self.walker.next()? {
            #[cfg(windows)]
            {
                match entry.kind {
                    EntryKind::Directory | EntryKind::File => {}
                    _ => continue,
                }

                let too_long = sys::Tag::copyfile.too_long();
                let src = self.src_path.child(entry.path).map_err(too_long)?;
                let dest = self.dest_subpath.child(entry.path).map_err(too_long)?;

                if entry.kind == EntryKind::Directory {
                    if bun_sys::windows::CreateDirectoryExW(&src, &dest).is_err() {
                        // Also taken when the directory exists, a success for make_path.
                        bun_sys::make_path::make_path::<OSPathChar>(&dest_dir, entry.path)?;
                    }
                } else if let Err(first_err) = bun_sys::copy_file::copy_file(&src, &dest) {
                    // `dest_dir` exists, so a file that is directly in it has no missing parent.
                    let Some(entry_dirname) = bun_paths::dirname(entry.path) else {
                        return Err(first_err);
                    };
                    let _ = bun_sys::make_path::make_path::<OSPathChar>(&dest_dir, entry_dirname);
                    bun_sys::copy_file::copy_file(&src, &dest)?;
                }
            }
            #[cfg(not(windows))]
            {
                if entry.kind != EntryKind::File {
                    continue;
                }

                let src = bun_sys::openat(entry.dir, entry.basename, bun_sys::O::RDONLY, 0)?;
                let src = bun_sys::File::from_fd(src);

                let dest = match dest_dir.create_file_z(entry.path, Default::default()) {
                    Ok(f) => f,
                    Err(_) => {
                        if let Some(entry_dirname) = bun_paths::dirname(entry.path) {
                            let _ = bun_sys::make_path::make_path::<OSPathChar>(
                                &dest_dir,
                                entry_dirname,
                            );
                        }

                        dest_dir.create_file_z(entry.path, Default::default())?
                    }
                };

                #[cfg(unix)]
                {
                    let stat = bun_sys::fstat(src.handle())?;
                    let _ = bun_sys::c::fchmod(dest.handle().native(), stat.st_mode);
                }

                bun_sys::copy_file::copy_file_with_state(
                    src.handle(),
                    dest.handle(),
                    &mut copy_file_state,
                )?;
            }
        }

        sys::Result::Ok(())
    }
}
