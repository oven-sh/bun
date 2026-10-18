#[cfg(windows)]
use core::ptr;

use bun_alloc::AllocError;
use bun_paths::{self, OSPathChar, OSPathSlice};
use bun_sys::{self as sys, Dir, E, EntryKind, Fd, walker_skippable, walker_skippable::Walker};

#[cfg(windows)]
use super::hardlinker::OsAbsPathBuf;
use super::hardlinker::OsPathBuf;
#[cfg(not(windows))]
use super::path_error;

pub(crate) struct FileCopier {
    #[cfg(windows)]
    pub(crate) src_path: OsAbsPathBuf,
    pub(crate) dest_subpath: OsPathBuf,
    pub(crate) walker: Walker,
}

impl FileCopier {
    pub(crate) fn init(
        src_dir: Fd,
        #[cfg(windows)] src_path: OsAbsPathBuf,
        dest_subpath: OsPathBuf,
        skip_dirnames: &[&OSPathSlice],
    ) -> Result<FileCopier, AllocError> {
        Ok(FileCopier {
            #[cfg(windows)]
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
        // `make_open_path` is u8-only; on Windows the OS-unit path is u16 so
        // narrow it via the same infallible `from_w_path` transcode that
        // `bun_sys::make_path_w` uses. Don't synthesise EINVAL on
        // conversion — store paths are built from UTF-8 package names and are
        // always WTF-8 round-trippable.
        #[cfg(windows)]
        let mut dest_u8_buf = bun_paths::path_buffer_pool::get();
        #[cfg(windows)]
        let dest_subpath_u8: &[u8] =
            bun_paths::string_paths::from_w_path(&mut dest_u8_buf[..], self.dest_subpath.slice())
                .as_bytes();
        #[cfg(not(windows))]
        let dest_subpath_u8: &[u8] = (self.dest_subpath.get())
            .map_err(path_error(sys::Tag::copyfile))?
            .as_bytes();
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

                // A `path.save()` ResetScope would hold `&mut Path` and keep
                // `self.src_path` / `self.dest_subpath` exclusively borrowed
                // for the rest of the iteration. Capture the saved lengths and
                // restore via `set_length` after the body instead.
                let src_saved_len = self.src_path.len();
                let dest_saved_len = self.dest_subpath.len();
                let appended = self.src_path.append(entry.path.as_slice()).is_ok()
                    && self.dest_subpath.append(entry.path.as_slice()).is_ok();

                let result: sys::Result<()> = match entry.kind {
                    _ if !appended => {
                        sys::Result::Err(sys::Error::from_code(E::ENAMETOOLONG, sys::Tag::copyfile))
                    }
                    EntryKind::Directory => {
                        // SAFETY: FFI — both `slice_z()` are NUL-terminated WStrs.
                        if unsafe {
                            bun_sys::windows::CreateDirectoryExW(
                                self.src_path.slice_z().as_ptr(),
                                self.dest_subpath.slice_z().as_ptr(),
                                ptr::null_mut(),
                            )
                        } == 0
                        {
                            // Also taken when the directory exists, a success for make_path.
                            bun_sys::make_path::make_path::<u16>(&dest_dir, entry.path.as_slice())
                        } else {
                            sys::Result::Ok(())
                        }
                    }
                    EntryKind::File => {
                        match bun_sys::copy_file::copy_file(
                            self.src_path.slice_z(),
                            self.dest_subpath.slice_z(),
                        ) {
                            sys::Result::Ok(()) => sys::Result::Ok(()),
                            sys::Result::Err(first_err) => {
                                // Retry after creating the parent directory.
                                // For root-level files (`index.js`,
                                // `package.json`, `LICENSE`) `dirname` is
                                // null and there is no missing parent to
                                // create — `dest_dir` itself was already
                                // opened above — so the original error is the
                                // real failure and must propagate. Silently
                                // continuing here would let a staged
                                // global-store entry be renamed into place
                                // with files missing.
                                match bun_paths::Dirname::dirname::<u16>(entry.path.as_slice()) {
                                    None => sys::Result::Err(first_err),
                                    Some(entry_dirname) => {
                                        let _ = bun_sys::make_path::make_path::<u16>(
                                            &dest_dir,
                                            entry_dirname,
                                        );
                                        bun_sys::copy_file::copy_file(
                                            self.src_path.slice_z(),
                                            self.dest_subpath.slice_z(),
                                        )
                                    }
                                }
                            }
                        }
                    }
                    _ => unreachable!(),
                };

                self.src_path.set_length(src_saved_len);
                self.dest_subpath.set_length(dest_saved_len);

                result?;
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
                        if let Some(entry_dirname) =
                            bun_paths::Dirname::dirname::<OSPathChar>(entry.path)
                        {
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
                    // SAFETY: fchmod is safe to call with any fd + mode; errors are ignored (`_ =`).
                    unsafe {
                        let _ = bun_sys::c::fchmod(dest.handle().native(), stat.st_mode);
                    }
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
