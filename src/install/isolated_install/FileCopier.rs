use core::ptr;

use bun_alloc::AllocError;
use bun_core::{err, fmt as bun_fmt, Error, Global, Output};
use bun_paths::{self, OsPathChar, OsPathSlice};
use bun_sys::{self as sys, walker_skippable::Walker, Fd, E};

// TODO(port): `bun.AbsPath(.{ .sep = .auto, .unit = .os })` / `bun.Path(...)` are
// comptime-configured path-builder types. Phase B must pick the concrete Rust
// instantiation (sep=auto, unit=os).
type AbsPathAutoOs = bun_paths::AbsPath;
type PathAutoOs = bun_paths::Path;

pub struct FileCopier {
    src_path: AbsPathAutoOs,
    dest_subpath: PathAutoOs,
    walker: Walker,
}

impl FileCopier {
    pub fn init(
        src_dir: Fd,
        src_path: AbsPathAutoOs,
        dest_subpath: PathAutoOs,
        skip_dirnames: &[OsPathSlice],
    ) -> Result<FileCopier, AllocError> {
        Ok(FileCopier {
            src_path,
            dest_subpath,
            walker: {
                let mut w = Walker::walk(
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
        let dest_dir = match bun_sys::make_path::make_open_path(
            Fd::cwd().std_dir(),
            self.dest_subpath.slice_z(),
            Default::default(),
        ) {
            Ok(d) => d,
            Err(e) => {
                // TODO: remove the need for this and implement openDir makePath makeOpenPath in bun
                let mut errno: E = {
                    // `@as(anyerror, err)` → match against interned bun_core::Error tags.
                    let e: Error = e;
                    if e == err!("AccessDenied") {
                        E::PERM
                    } else if e == err!("FileTooBig") {
                        E::FBIG
                    } else if e == err!("SymLinkLoop") {
                        E::LOOP
                    } else if e == err!("ProcessFdQuotaExceeded") {
                        E::NFILE
                    } else if e == err!("NameTooLong") {
                        E::NAMETOOLONG
                    } else if e == err!("SystemFdQuotaExceeded") {
                        E::MFILE
                    } else if e == err!("SystemResources") {
                        E::NOMEM
                    } else if e == err!("ReadOnlyFileSystem") {
                        E::ROFS
                    } else if e == err!("FileSystem") {
                        E::IO
                    } else if e == err!("FileBusy") {
                        E::BUSY
                    } else if e == err!("DeviceBusy") {
                        E::BUSY
                    }
                    // One of the path components was not a directory.
                    // This error is unreachable if `sub_path` does not contain a path separator.
                    else if e == err!("NotDir") {
                        E::NOTDIR
                    }
                    // On Windows, file paths must be valid Unicode.
                    else if e == err!("InvalidUtf8") {
                        E::INVAL
                    } else if e == err!("InvalidWtf8") {
                        E::INVAL
                    }
                    // On Windows, file paths cannot contain these characters:
                    // '/', '*', '?', '"', '<', '>', '|'
                    else if e == err!("BadPathName") {
                        E::INVAL
                    } else if e == err!("FileNotFound") {
                        E::NOENT
                    } else if e == err!("IsDir") {
                        E::ISDIR
                    } else {
                        E::FAULT
                    }
                };
                #[cfg(windows)]
                if errno == E::NOTDIR {
                    errno = E::NOENT;
                }

                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::copyfile));
            }
        };
        // `defer dest_dir.close()` → handled by Drop on `dest_dir`.

        let mut copy_file_state = bun_sys::CopyFileState::default();

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
                    walker_skippable::Kind::Directory | walker_skippable::Kind::File => {}
                    _ => continue,
                }

                // PORT NOTE: reshaped for borrowck — Zig's `save()`/`defer restore()`
                // pattern becomes an RAII guard returned by `save()`. Phase B must
                // ensure `save()` does not hold a `&mut` borrow across `append()`.
                // TODO(port): verify AbsPath/Path save-guard borrow shape.
                let _src_path_save = self.src_path.save();
                self.src_path.append(entry.path);

                let _dest_subpath_save = self.dest_subpath.save();
                self.dest_subpath.append(entry.path);

                match entry.kind {
                    walker_skippable::Kind::Directory => {
                        if bun_sys::windows::CreateDirectoryExW(
                            self.src_path.slice_z(),
                            self.dest_subpath.slice_z(),
                            ptr::null_mut(),
                        ) == 0
                        {
                            let _ = bun_sys::make_path::make_path::<u16>(&dest_dir, entry.path);
                        }
                    }
                    walker_skippable::Kind::File => {
                        match bun_sys::copy_file(self.src_path.slice_z(), self.dest_subpath.slice_z()) {
                            sys::Result::Ok(()) => {}
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
                                let Some(entry_dirname) =
                                    bun_paths::dirname::dirname::<u16>(entry.path)
                                else {
                                    return sys::Result::Err(first_err);
                                };
                                let _ =
                                    bun_sys::make_path::make_path::<u16>(&dest_dir, entry_dirname);
                                match bun_sys::copy_file(
                                    self.src_path.slice_z(),
                                    self.dest_subpath.slice_z(),
                                ) {
                                    sys::Result::Ok(()) => {}
                                    sys::Result::Err(err) => {
                                        return sys::Result::Err(err);
                                    }
                                }
                            }
                        }
                    }
                    _ => unreachable!(),
                }
            }
            #[cfg(not(windows))]
            {
                if entry.kind != walker_skippable::Kind::File {
                    continue;
                }

                let src = match entry.dir.openat(entry.basename, bun_sys::O::RDONLY, 0) {
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
                            bun_paths::dirname::dirname::<OsPathChar>(entry.path)
                        {
                            let _ = bun_sys::make_path::make_path::<OsPathChar>(
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
                // `defer dest.close()` → handled by Drop on `dest`.

                #[cfg(unix)]
                {
                    let stat = match src.stat() {
                        sys::Result::Ok(s) => s,
                        sys::Result::Err(_) => continue,
                    };
                    // SAFETY: fchmod is safe to call with any fd + mode; errors are ignored (`_ =`).
                    unsafe {
                        // TODO(port): @intCast target type for mode (libc::mode_t)
                        let _ = bun_sys::c::fchmod(dest.handle(), stat.mode as _);
                    }
                }

                match bun_sys::copy_file_with_state(
                    src,
                    Fd::from_std_file(&dest),
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

use bun_sys::walker_skippable;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/FileCopier.zig (180 lines)
//   confidence: medium
//   todos:      3
//   notes:      AbsPath/Path comptime-config types stubbed; save()/restore() RAII guard needs borrowck-safe shape; anyerror→errno chain uses bun_core::err! interned consts
// ──────────────────────────────────────────────────────────────────────────
