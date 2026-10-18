#[cfg(windows)]
use core::ptr;

use bun_alloc::AllocError;
use bun_paths::{self, OSPath, OSPathSlice};
#[cfg(windows)]
use bun_paths::{OSAbsPath, SubPathSlice};
use bun_sys::{self as sys, Dir, E, EntryKind, Fd, walker_skippable, walker_skippable::Walker};

use super::path_error_for;

pub(crate) struct FileCopier {
    /// The path of `src_dir`, for the caller to set.
    #[cfg(windows)]
    pub(crate) src_path: OSAbsPath,
    pub(crate) dest: OSPath,
    pub(crate) walker: Walker,
}

impl FileCopier {
    pub(crate) fn init(
        src_dir: Fd,
        dest: OSPath,
        skip_dirnames: &[&OSPathSlice],
    ) -> Result<FileCopier, AllocError> {
        Ok(FileCopier {
            #[cfg(windows)]
            src_path: OSAbsPath::init(),
            dest,
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
        let path_error = path_error_for(sys::Tag::copyfile);
        let dest = self.dest.try_slice().map_err(path_error)?;
        // `make_open_path` is u8-only; on Windows the OS-unit path is u16 so
        // narrow it via the same infallible `from_w_path` transcode that
        // `bun_sys::make_path_w` uses. Don't synthesise EINVAL on
        // conversion — store paths are built from UTF-8 package names and are
        // always WTF-8 round-trippable.
        #[cfg(windows)]
        let mut dest_u8_buf = bun_paths::path_buffer_pool::get();
        #[cfg(windows)]
        let dest_u8: &[u8] =
            bun_paths::string_paths::from_w_path(&mut dest_u8_buf[..], dest.slice()).as_bytes();
        #[cfg(not(windows))]
        let dest_u8: &[u8] = dest.slice();
        let dest_dir =
            match bun_sys::make_path::make_open_path(&Dir::cwd(), dest_u8, Default::default()) {
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

                let (mut src, mut dest) = (self.src_path.save(), self.dest.save());
                let below = SubPathSlice::new_assume_valid(entry.path.as_slice());
                let src = src.append(below).try_slice().map_err(path_error)?;
                let dest = dest.append(below).try_slice().map_err(path_error)?;

                match entry.kind {
                    EntryKind::Directory => {
                        // SAFETY: FFI — both `slice_z()` are NUL-terminated WStrs.
                        if unsafe {
                            bun_sys::windows::CreateDirectoryExW(
                                src.slice_z().as_ptr(),
                                dest.slice_z().as_ptr(),
                                ptr::null_mut(),
                            )
                        } == 0
                        {
                            // Also taken when the directory exists, a success for make_path.
                            bun_sys::make_path::make_path::<u16>(&dest_dir, entry.path.as_slice())?;
                        }
                    }
                    EntryKind::File => {
                        if let Err(first_err) =
                            bun_sys::copy_file::copy_file(src.slice_z(), dest.slice_z())
                        {
                            // A root-level file has no parent to create: skipping it would publish a global-store entry with files missing.
                            let Some(entry_dirname) =
                                bun_paths::Dirname::dirname::<u16>(entry.path.as_slice())
                            else {
                                return Err(first_err);
                            };
                            let _ = bun_sys::make_path::make_path::<u16>(&dest_dir, entry_dirname);
                            bun_sys::copy_file::copy_file(src.slice_z(), dest.slice_z())?;
                        }
                    }
                    _ => unreachable!(),
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
                        if let Some(entry_dirname) = bun_paths::Dirname::dirname::<u8>(entry.path) {
                            let _ = bun_sys::make_path::make_path::<u8>(&dest_dir, entry_dirname);
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
