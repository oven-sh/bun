#[cfg(windows)]
use core::ptr;

use bun_alloc::AllocError;
use bun_core::{Error, Global, Output, err, fmt as bun_fmt};
use bun_paths::{self, OSPathChar, OSPathSlice};
use bun_sys::{self as sys, Dir, E, EntryKind, Fd, walker_skippable, walker_skippable::Walker};

// `bun.AbsPath(.{ .sep = .auto, .unit = .os })` / `bun.Path(...)` are
// comptime-configured path-builder types. `.unit = .os` means u8 on POSIX,
// u16 on Windows — encoded via `OSPathChar` so `slice()`/`slice_z()` produce
// the platform-native width. `.sep = .auto` normalizes `/` → `\` on Windows
// during `from`/`append`, which is load-bearing for the Win32 calls below.
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
        // Zig: `bun.MakePath.makeOpenPath(FD.cwd().stdDir(), this.dest_subpath.sliceZ(), .{})`.
        // `make_open_path` is u8-only; on Windows the OS-unit path is u16 so
        // narrow it via the same infallible `from_w_path` transcode that
        // `bun_sys::make_path_w` uses (bun.zig:2319). Zig stays in u16 the
        // whole way and has no error path here, so don't synthesise EINVAL on
        // conversion — store paths are built from UTF-8 package names and are
        // always WTF-8 round-trippable. On POSIX `OSPathChar == u8` and
        // `slice_z()` already yields `&ZStr`, so deref-coerce to `&[u8]`.
        #[cfg(windows)]
        let mut dest_u8_buf = bun_paths::path_buffer_pool::get();
        #[cfg(windows)]
        let dest_subpath_u8: &[u8] =
            bun_paths::string_paths::from_w_path(&mut dest_u8_buf[..], self.dest_subpath.slice())
                .as_bytes();
        #[cfg(not(windows))]
        let dest_subpath_u8: &[u8] = self.dest_subpath.slice_z().as_bytes();
        let dest_dir = match bun_sys::make_path::make_open_path(
            Dir::cwd(),
            dest_subpath_u8,
            Default::default(),
        ) {
            Ok(d) => d,
            Err(e) => {
                // TODO: remove the need for this and implement openDir makePath makeOpenPath in bun
                #[allow(unused_mut)]
                let mut errno: E = {
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
                    } else if e == err!("FileBusy") {
                        E::EBUSY
                    } else if e == err!("DeviceBusy") {
                        E::EBUSY
                    }
                    // One of the path components was not a directory.
                    // This error is unreachable if `sub_path` does not contain a path separator.
                    else if e == err!("NotDir") {
                        E::ENOTDIR
                    }
                    // On Windows, file paths must be valid Unicode.
                    else if e == err!("InvalidUtf8") {
                        E::EINVAL
                    } else if e == err!("InvalidWtf8") {
                        E::EINVAL
                    }
                    // On Windows, file paths cannot contain these characters:
                    // '/', '*', '?', '"', '<', '>', '|'
                    else if e == err!("BadPathName") {
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
                if errno == E::ENOTDIR {
                    errno = E::ENOENT;
                }

                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::copyfile));
            }
        };
        // Zig: `defer dest_dir.close();` — `Dir` is a non-owning Copy handle
        // with no Drop impl, so close explicitly on every exit path.
        let _close_dest_dir = sys::CloseOnDrop::dir(dest_dir);

        let mut copy_file_state = bun_sys::copy_file::CopyFileState::default();

        loop {
            let entry = match self.walker.next() {
                sys::Result::Ok(res) => match res {
                    Some(entry) => entry,
                    None => break,
                },
                sys::Result::Err(err) => return sys::Result::Err(err),
            };

            #[cfg(windows)]
            {
                match entry.kind {
                    EntryKind::Directory | EntryKind::File => {}
                    _ => continue,
                }

                // PORT NOTE: reshaped for borrowck — Zig's `var s = path.save();
                // defer s.restore();` returns a `ResetScope` that holds
                // `&mut Path`, which would keep `self.src_path` /
                // `self.dest_subpath` exclusively borrowed for the rest of the
                // iteration. Capture the saved length and restore via
                // `set_length` after the body.
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
                                dest_dir,
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
                                            dest_dir,
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

                let src: Fd =
                    match bun_sys::openat(entry.dir, entry.basename, bun_sys::O::RDONLY, 0) {
                        sys::Result::Ok(fd) => fd,
                        sys::Result::Err(err) => {
                            return sys::Result::Err(err);
                        }
                    };
                // `defer src.close()` → handled by Drop on `src`.

                let dest = match dest_dir.create_file_z(entry.path, Default::default()) {
                    Ok(f) => f,
                    Err(_) => 'dest: {
                        if let Some(entry_dirname) =
                            bun_paths::Dirname::dirname::<OSPathChar>(entry.path)
                        {
                            let _ = bun_sys::make_path::make_path::<OSPathChar>(
                                dest_dir,
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
                // `defer dest.close()` → handled by Drop on `dest`.

                #[cfg(unix)]
                {
                    let stat = match bun_sys::fstat(src) {
                        sys::Result::Ok(s) => s,
                        sys::Result::Err(_) => continue,
                    };
                    // SAFETY: fchmod is safe to call with any fd + mode; errors are ignored (`_ =`).
                    unsafe {
                        let _ = bun_sys::c::fchmod(dest.handle().native(), stat.st_mode);
                    }
                }

                match bun_sys::copy_file::copy_file_with_state(
                    src,
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
