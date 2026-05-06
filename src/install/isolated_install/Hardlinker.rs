use bun_alloc::AllocError;
use bun_sys::{self as sys, Fd};
use bun_sys::walker_skippable::Walker;
// TODO(port): `bun.AbsPath(.{ .sep = .auto, .unit = .os })` / `bun.Path(.{ .sep = .auto, .unit = .os })`
// take a comptime config struct; Phase B decides whether these become const-generic
// params or distinct type aliases. Using the bare types here.
use bun_paths::{AbsPath, Path, OSPathSlice};

pub struct Hardlinker {
    pub src_dir: Fd,
    pub src: AbsPath,
    pub dest: Path,
    pub walker: Walker,
}

impl Hardlinker {
    pub fn init(
        folder_dir: Fd,
        src: AbsPath,
        dest: Path,
        skip_dirnames: &[&OSPathSlice],
    ) -> Result<Hardlinker, AllocError> {
        Ok(Hardlinker {
            src_dir: folder_dir,
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

    // Zig `deinit` only called `this.walker.deinit()`; Walker's Drop handles that.
    // No explicit Drop impl needed.

    pub fn link(&mut self) -> Result<sys::Result<()>, AllocError> {
        if crate::PackageManager::verbose_install() {
            bun_core::pretty_errorln!(
                "Hardlinking {} to {}",
                bun_core::fmt::fmt_os_path(self.src.slice(), Default::default()),
                bun_core::fmt::fmt_os_path(self.dest.slice(), Default::default()),
            );
            bun_core::output::flush();
        }

        #[cfg(windows)]
        {
            let mut cwd_buf = bun_paths::w_path_buffer_pool().get();
            let Ok(dest_cwd) = Fd::cwd().get_fd_path_w(&mut cwd_buf) else {
                return Ok(sys::Result::Err(sys::Error::from_code(
                    sys::E::ACCES,
                    sys::Tag::Link,
                )));
            };

            loop {
                let entry = match self.walker.next() {
                    sys::Result::Ok(Some(res)) => res,
                    sys::Result::Ok(None) => break,
                    sys::Result::Err(err) => return Ok(sys::Result::Err(err)),
                };

                // Zig `defer src_save.restore()` / `defer dest_save.restore()` run on
                // ALL scope exits, including the early `return .initErr(...)` paths
                // below. Wrap in scopeguard so the appended `entry.path` is always
                // truncated off self.src/self.dest before the next iteration or any
                // error-return leaves this scope.
                let mut src_save = self.src.save();
                let _src_restore = scopeguard::guard((), |_| src_save.restore());
                self.src.append(entry.path);

                let mut dest_save = self.dest.save();
                let _dest_restore = scopeguard::guard((), |_| dest_save.restore());
                self.dest.append(entry.path);

                match entry.kind {
                    EntryKind::Directory => {
                        let _ = Fd::cwd().make_path::<u16>(self.dest.slice());
                    }
                    EntryKind::File => {
                        let mut destfile_path_buf = bun_paths::w_path_buffer_pool().get();
                        let mut destfile_path_buf2 = bun_paths::w_path_buffer_pool().get();
                        // `dest` may already be absolute (global virtual store
                        // entries live under the cache, not cwd); only prefix the
                        // working-directory path when it's project-relative.
                        let dest_parts: &[&[u16]] = if self.dest.len() > 0
                            && bun_paths::Platform::Windows.is_absolute_t::<u16>(self.dest.slice())
                        {
                            &[self.dest.slice()]
                        } else {
                            &[dest_cwd, self.dest.slice()]
                        };
                        let destfile_path = bun_str::strings::add_nt_path_prefix_if_needed(
                            &mut destfile_path_buf2,
                            bun_paths::join_string_buf_wz(
                                &mut destfile_path_buf,
                                dest_parts,
                                bun_paths::Platform::Windows,
                            ),
                        );

                        // TODO(port): Zig allocated `srcfile_path_buf` here but never used it.
                        // Dropped in the port; verify in Phase B that this was dead code.
                        let _srcfile_path_buf = bun_paths::w_path_buffer_pool().get();

                        match sys::link::<u16>(self.src.slice_z(), destfile_path) {
                            sys::Result::Ok(()) => {}
                            sys::Result::Err(link_err1) => match link_err1.get_errno() {
                                sys::E::UV_EEXIST | sys::E::EXIST => {
                                    if crate::PackageManager::verbose_install() {
                                        bun_core::pretty_errorln!(
                                            "Hardlinking {} to a path that already exists: {}",
                                            bun_core::fmt::fmt_os_path(
                                                self.src.slice(),
                                                Default::default()
                                            ),
                                            bun_core::fmt::fmt_os_path(
                                                destfile_path,
                                                Default::default()
                                            ),
                                        );
                                    }

                                    'try_delete: {
                                        let mut delete_tree_buf =
                                            bun_paths::path_buffer_pool().get();

                                        let Ok(delete_tree_path) =
                                            bun_str::strings::convert_utf16_to_utf8_in_buffer(
                                                &mut delete_tree_buf,
                                                self.dest.slice(),
                                            )
                                        else {
                                            break 'try_delete;
                                        };
                                        let _ = Fd::cwd().delete_tree(delete_tree_path);
                                    }
                                    match sys::link::<u16>(self.src.slice_z(), destfile_path) {
                                        sys::Result::Ok(()) => {}
                                        sys::Result::Err(link_err2) => {
                                            return Ok(sys::Result::Err(link_err2));
                                        }
                                    }
                                }
                                sys::E::UV_ENOENT | sys::E::NOENT => {
                                    if crate::PackageManager::verbose_install() {
                                        bun_core::pretty_errorln!(
                                            "Hardlinking {} to a path that doesn't exist: {}",
                                            bun_core::fmt::fmt_os_path(
                                                self.src.slice(),
                                                Default::default()
                                            ),
                                            bun_core::fmt::fmt_os_path(
                                                destfile_path,
                                                Default::default()
                                            ),
                                        );
                                    }
                                    let Some(dest_parent) = self.dest.dirname() else {
                                        return Ok(sys::Result::Err(link_err1));
                                    };

                                    let _ = Fd::cwd().make_path::<u16>(dest_parent);

                                    match sys::link::<u16>(self.src.slice_z(), destfile_path) {
                                        sys::Result::Ok(()) => {}
                                        sys::Result::Err(link_err2) => {
                                            return Ok(sys::Result::Err(link_err2));
                                        }
                                    }
                                }
                                _ => return Ok(sys::Result::Err(link_err1)),
                            },
                        }
                    }
                    _ => {}
                }
            }

            return Ok(sys::Result::Ok(()));
        }

        #[cfg(not(windows))]
        {
            loop {
                let entry = match self.walker.next() {
                    sys::Result::Ok(Some(res)) => res,
                    sys::Result::Ok(None) => break,
                    sys::Result::Err(err) => return Ok(sys::Result::Err(err)),
                };

                // Zig `defer dest_save.restore()` runs on ALL scope exits, including
                // early error returns below; wrap in scopeguard so self.dest is
                // restored on every path.
                let mut dest_save = self.dest.save();
                let _dest_restore = scopeguard::guard((), |_| dest_save.restore());
                self.dest.append(entry.path);

                match entry.kind {
                    EntryKind::Directory => {
                        let _ = Fd::cwd().make_path::<u8>(self.dest.slice_z());
                    }
                    EntryKind::File => {
                        match sys::linkat(
                            entry.dir,
                            entry.basename,
                            Fd::cwd(),
                            self.dest.slice_z(),
                        ) {
                            sys::Result::Ok(()) => {}
                            sys::Result::Err(link_err1) => match link_err1.get_errno() {
                                sys::E::EXIST => {
                                    let _ = Fd::cwd().delete_tree(self.dest.slice());
                                    match sys::linkat(
                                        entry.dir,
                                        entry.basename,
                                        Fd::cwd(),
                                        self.dest.slice_z(),
                                    ) {
                                        sys::Result::Ok(()) => {}
                                        sys::Result::Err(link_err2) => {
                                            return Ok(sys::Result::Err(link_err2));
                                        }
                                    }
                                }
                                sys::E::NOENT => {
                                    let Some(dest_parent) = self.dest.dirname() else {
                                        return Ok(sys::Result::Err(link_err1));
                                    };

                                    let _ = Fd::cwd().make_path::<u8>(dest_parent);
                                    match sys::linkat(
                                        entry.dir,
                                        entry.basename,
                                        Fd::cwd(),
                                        self.dest.slice_z(),
                                    ) {
                                        sys::Result::Ok(()) => {}
                                        sys::Result::Err(link_err2) => {
                                            return Ok(sys::Result::Err(link_err2));
                                        }
                                    }
                                }
                                _ => return Ok(sys::Result::Err(link_err1)),
                            },
                        }
                    }
                    _ => {}
                }
            }

            return Ok(sys::Result::Ok(()));
        }
    }
}

use bun_sys::EntryKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/Hardlinker.zig (210 lines)
//   confidence: medium
//   todos:      4
//   notes:      AbsPath/Path comptime config + save()/restore() RAII shape need Phase B decisions; defer-restore now wrapped in scopeguard so error-return paths restore self.src/self.dest.
// ──────────────────────────────────────────────────────────────────────────
