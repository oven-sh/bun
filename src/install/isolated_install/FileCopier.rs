#[cfg(windows)]
use core::ptr;

use bun_alloc::AllocError;
use bun_core::{Error, err};
#[cfg(not(windows))]
use bun_core::{Global, Output, fmt as bun_fmt};
use bun_paths::{self, OSPathChar, OSPathSlice};
use bun_sys::{self as sys, Dir, E, EntryKind, Fd, walker_skippable, walker_skippable::Walker};

type AbsPathAutoOs =
    bun_paths::AbsPath<OSPathChar, { bun_paths::path_options::PathSeparators::AUTO }>;
type PathAutoOs = bun_paths::Path<
    OSPathChar,
    { bun_paths::path_options::Kind::ANY },
    { bun_paths::path_options::PathSeparators::AUTO },
>;

pub struct FileCopier {
    pub src_path: AbsPathAutoOs,
    pub dest_subpath: PathAutoOs,
    pub walker: Walker,
}

impl FileCopier {
    pub fn init(
        src_dir: Fd,
        src_path: AbsPathAutoOs,
        dest_subpath: PathAutoOs,
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

    // Zig `deinit` only called `this.walker.deinit()`; `Walker` owns its
    // resources and drops automatically, so no explicit `Drop` impl is needed.

    pub fn copy(&mut self) -> sys::Result<()> {
        #[cfg(windows)]
        let mut dest_u8_buf = bun_paths::path_buffer_pool::get();
        #[cfg(windows)]
        let dest_subpath_u8: &[u8] =
            bun_paths::string_paths::from_w_path(&mut dest_u8_buf[..], self.dest_subpath.slice())
                .as_bytes();
        #[cfg(not(windows))]
        let dest_subpath_u8: &[u8] = self.dest_subpath.slice_z().as_bytes();
        let dest_dir = match bun_sys::make_path::make_open_path(
            &Dir::cwd(),
            dest_subpath_u8,
            Default::default(),
        ) {
            Ok(d) => d,
            Err(e) => {
                // TODO: remove the need for this and implement openDir makePath makeOpenPath in bun
                let errno: E = {
                    // `@as(anyerror, err)` → match against interned bun_core::Error tags.
                    let e: Error = e;
                    if e == err!("AccessDenied") {
                        E::EPERM
                    } else if e == err!("FileTooBig") {
                        E::EFBIG
                    } else if e == err!("SymLinkLoop") {
                        E::ELOOP
                    } else if e == err!("ProcessFdQuotaExceeded") {
                        E::ENFILE
                    } else if e == err!("NameTooLong") {
                        E::ENAMETOOLONG
                    } else if e == err!("SystemFdQuotaExceeded") {
                        E::EMFILE
                    } else if e == err!("SystemResources") {
                        E::ENOMEM
                    } else if e == err!("ReadOnlyFileSystem") {
                        E::EROFS
                    } else if e == err!("FileSystem") {
                        E::EIO
                    } else if e == err!("FileBusy") || e == err!("DeviceBusy") {
                        E::EBUSY
                    }
                    // One of the path components was not a directory.
                    // This error is unreachable if `sub_path` does not contain a path separator.
                    else if e == err!("NotDir") {
                        E::ENOTDIR
                    }
                    // On Windows, file paths must be valid Unicode.
                    // On Windows, file paths cannot contain these characters:
                    // '/', '*', '?', '"', '<', '>', '|'
                    else if e == err!("InvalidUtf8")
                        || e == err!("InvalidWtf8")
                        || e == err!("BadPathName")
                    {
                        E::EINVAL
                    } else if e == err!("FileNotFound") {
                        E::ENOENT
                    } else if e == err!("IsDir") {
                        E::EISDIR
                    } else {
                        E::EFAULT
                    }
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

        loop {
            let entry = {
                let res = self.walker.next()?;
                match res {
                    Some(entry) => entry,
                    None => break,
                }
            };

            #[cfg(windows)]
            {
                match entry.kind {
                    EntryKind::Directory | EntryKind::File => {}
                    _ => continue,
                }

                let src_saved_len = self.src_path.len();
                let _ = self.src_path.append(entry.path.as_slice());

                let dest_saved_len = self.dest_subpath.len();
                let _ = self.dest_subpath.append(entry.path.as_slice());

                let result: sys::Result<()> = match entry.kind {
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
                            let _ = bun_sys::make_path::make_path::<u16>(
                                &dest_dir,
                                entry.path.as_slice(),
                            );
                        }
                        sys::Result::Ok(())
                    }
                    EntryKind::File => {
                        match bun_sys::copy_file::copy_file(
                            self.src_path.slice_z(),
                            self.dest_subpath.slice_z(),
                        ) {
                            sys::Result::Ok(()) => sys::Result::Ok(()),
                            sys::Result::Err(first_err) => {
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

                if let sys::Result::Err(err) = result {
                    return sys::Result::Err(err);
                }
            }
            #[cfg(not(windows))]
            {
                if entry.kind != EntryKind::File {
                    continue;
                }

                let src = match bun_sys::openat(entry.dir, entry.basename, bun_sys::O::RDONLY, 0) {
                    sys::Result::Ok(fd) => bun_sys::File::from_fd(fd),
                    sys::Result::Err(err) => {
                        return sys::Result::Err(err);
                    }
                };

                let dest = match dest_dir.create_file_z(entry.path, Default::default()) {
                    Ok(f) => f,
                    Err(_) => 'dest: {
                        if let Some(entry_dirname) =
                            bun_paths::Dirname::dirname::<OSPathChar>(entry.path)
                        {
                            let _ = bun_sys::make_path::make_path::<OSPathChar>(
                                &dest_dir,
                                entry_dirname,
                            );
                        }

                        match dest_dir.create_file_z(entry.path, Default::default()) {
                            Ok(f) => break 'dest f,
                            Err(err) => {
                                Output::pretty_errorln(format_args!(
                                    "<r><red>{}<r>: copy file {}",
                                    err.name(),
                                    bun_fmt::fmt_os_path(entry.path, Default::default()),
                                ));
                                Global::exit(1);
                            }
                        }
                    }
                };

                #[cfg(unix)]
                {
                    let stat = match bun_sys::fstat(src.handle()) {
                        sys::Result::Ok(s) => s,
                        sys::Result::Err(_) => continue,
                    };
                    // SAFETY: fchmod is safe to call with any fd + mode; errors are ignored (`_ =`).
                    unsafe {
                        let _ = bun_sys::c::fchmod(dest.handle().native(), stat.st_mode);
                    }
                }

                match bun_sys::copy_file::copy_file_with_state(
                    src.handle(),
                    dest.handle(),
                    &mut copy_file_state,
                ) {
                    sys::Result::Ok(()) => {}
                    sys::Result::Err(err) => {
                        return sys::Result::Err(err);
                    }
                }
            }
        }

        sys::Result::Ok(())
    }
}

// ported from: src/install/isolated_install/FileCopier.zig
