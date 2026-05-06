use bun_alloc::AllocError;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdDirExt, FdExt};
// `bun.AbsPath(.{ .sep = .auto, .unit = .os })` / `bun.Path(.{ .sep = .auto, .unit = .os })`
// take a comptime config struct in Zig. The Rust `Path` const-generics default
// to `U = u8, sep = ANY`; the `.unit = .os` distinction only matters on
// Windows (handled in the `#[cfg(windows)]` arm).
use bun_paths::{AbsPath, OSPathSlice, Path};

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
                    sys::E::EACCES,
                    sys::Tag::link,
                )));
            };

            loop {
                let entry = match self.walker.next() {
                    sys::Result::Ok(Some(res)) => res,
                    sys::Result::Ok(None) => break,
                    sys::Result::Err(err) => return Ok(sys::Result::Err(err)),
                };

                // PORT NOTE: reshaped for borrowck — Zig's `var s = path.save();
                // defer s.restore();` returns a `ResetScope` that holds `&mut Path`,
                // which would keep `self.src`/`self.dest` exclusively borrowed for
                // the rest of the iteration. Capture the saved length directly and
                // restore via `set_length` after the body (and before any error
                // return) so the truncation happens on every exit, matching `defer`.
                let src_saved_len = self.src.len();
                self.src.append(entry.path.as_slice());

                let dest_saved_len = self.dest.len();
                self.dest.append(entry.path.as_slice());

                let err: Option<sys::Error> = 'body: {
                    match entry.kind {
                        EntryKind::Directory => {
                            let _ = Fd::cwd().make_path(self.dest.slice());
                        }
                        EntryKind::File => {
                            let mut destfile_path_buf = bun_paths::w_path_buffer_pool().get();
                            let mut destfile_path_buf2 = bun_paths::w_path_buffer_pool().get();
                            // `dest` may already be absolute (global virtual store
                            // entries live under the cache, not cwd); only prefix the
                            // working-directory path when it's project-relative.
                            let dest_parts: &[&[u16]] = if self.dest.len() > 0
                                && bun_paths::Platform::Windows
                                    .is_absolute_t::<u16>(self.dest.slice())
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

                            // Zig allocated `srcfile_path_buf` here but never used it;
                            // dropped in the port (dead code in the original).
                            let _srcfile_path_buf = bun_paths::w_path_buffer_pool().get();

                            match sys::link::<u16>(self.src.slice_z(), destfile_path) {
                                sys::Result::Ok(()) => {}
                                sys::Result::Err(link_err1) => match link_err1.get_errno() {
                                    sys::E::EEXIST => {
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
                                                break 'body Some(link_err2);
                                            }
                                        }
                                    }
                                    sys::E::ENOENT => {
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
                                            break 'body Some(link_err1);
                                        };

                                        let _ = Fd::cwd().make_path(dest_parent);

                                        match sys::link::<u16>(self.src.slice_z(), destfile_path) {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(link_err2) => {
                                                break 'body Some(link_err2);
                                            }
                                        }
                                    }
                                    _ => break 'body Some(link_err1),
                                },
                            }
                        }
                        _ => {}
                    }
                    None
                };

                self.src.set_length(src_saved_len);
                self.dest.set_length(dest_saved_len);

                if let Some(err) = err {
                    return Ok(sys::Result::Err(err));
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

                // PORT NOTE: reshaped for borrowck — Zig's `var s = dest.save();
                // defer s.restore();` returns a `ResetScope` holding `&mut Path`,
                // which would keep `self.dest` exclusively borrowed across the
                // body. Capture `len()` and restore via `set_length()` after the
                // body so the truncation runs on every exit, matching `defer`.
                let dest_saved_len = self.dest.len();
                self.dest.append(entry.path.as_bytes());

                let err: Option<sys::Error> = 'body: {
                    match entry.kind {
                        EntryKind::Directory => {
                            let _ = Fd::cwd().make_path(self.dest.slice());
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
                                    sys::E::EEXIST => {
                                        let _ = Fd::cwd().delete_tree(self.dest.slice());
                                        match sys::linkat(
                                            entry.dir,
                                            entry.basename,
                                            Fd::cwd(),
                                            self.dest.slice_z(),
                                        ) {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(link_err2) => {
                                                break 'body Some(link_err2);
                                            }
                                        }
                                    }
                                    sys::E::ENOENT => {
                                        let Some(dest_parent) = self.dest.dirname() else {
                                            break 'body Some(link_err1);
                                        };

                                        let _ = Fd::cwd().make_path(dest_parent);
                                        match sys::linkat(
                                            entry.dir,
                                            entry.basename,
                                            Fd::cwd(),
                                            self.dest.slice_z(),
                                        ) {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(link_err2) => {
                                                break 'body Some(link_err2);
                                            }
                                        }
                                    }
                                    _ => break 'body Some(link_err1),
                                },
                            }
                        }
                        _ => {}
                    }
                    None
                };

                self.dest.set_length(dest_saved_len);

                if let Some(err) = err {
                    return Ok(sys::Result::Err(err));
                }
            }

            Ok(sys::Result::Ok(()))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/isolated_install/Hardlinker.zig (210 lines)
//   confidence: high
//   notes:      save()/restore() reshaped to len()/set_length() for borrowck
//               (ResetScope holds &mut Path; cannot coexist with append/slice).
// ──────────────────────────────────────────────────────────────────────────
