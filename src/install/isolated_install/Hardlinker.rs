use bun_alloc::AllocError;
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdExt};
// OS-unit paths are u8 on POSIX, u16
// on Windows — encoded here via the `OSPathChar` type alias so the struct's
// `slice()`/`slice_z()` produce the platform-native width without per-field
// `#[cfg]` divergence.
#[cfg(windows)]
use bun_paths::path_options::AssumeOk as _;
use bun_paths::{AbsPath, OSPathChar, OSPathSlice, Path};

type OsAbsPath = AbsPath<OSPathChar, { bun_paths::path_options::PathSeparators::AUTO }>;
type OsPath = Path<
    OSPathChar,
    { bun_paths::path_options::Kind::ANY },
    { bun_paths::path_options::PathSeparators::AUTO },
>;

pub(crate) struct Hardlinker {
    pub(crate) src: OsAbsPath,
    pub(crate) dest: OsPath,
    pub(crate) walker: Walker,
}

impl Hardlinker {
    pub(crate) fn init(
        folder_dir: Fd,
        src: OsAbsPath,
        dest: OsPath,
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

    pub(crate) fn link(&mut self) -> Result<sys::Result<()>, AllocError> {
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
            let mut cwd_buf = bun_paths::w_path_buffer_pool::get();
            let dest_cwd_len = bun_core::strings::convert_utf8_to_utf16_in_buffer(
                &mut cwd_buf[..],
                crate::bun_fs::FileSystem::instance().top_level_dir(),
            )
            .len();

            loop {
                let entry = match self.walker.next() {
                    sys::Result::Ok(Some(res)) => res,
                    sys::Result::Ok(None) => break,
                    sys::Result::Err(err) => return Ok(sys::Result::Err(err)),
                };

                // A `path.save()` ResetScope would hold `&mut Path` and keep
                // `self.src`/`self.dest` exclusively borrowed for the rest of
                // the iteration. Capture the saved length directly and restore
                // via `set_length` after the body (and before any error return)
                // so the truncation happens on every exit.
                let src_saved_len = self.src.len();
                // `OsAbsPath`/`OsPath` use `CheckLength::ASSUME`, so `append`'s
                // `Err(MaxPathExceeded)` arm is statically unreachable -- see
                // `path_options::AssumeOk`.
                self.src.append(entry.path.as_slice()).assume_ok();

                let dest_saved_len = self.dest.len();
                self.dest.append(entry.path.as_slice()).assume_ok();

                let err: Option<sys::Error> = 'body: {
                    match entry.kind {
                        EntryKind::Directory => {
                            let _ = sys::make_path::make_path::<u16>(
                                &sys::Dir::cwd(),
                                self.dest.slice(),
                            );
                        }
                        EntryKind::File => {
                            let mut destfile_path_buf = bun_paths::w_path_buffer_pool::get();
                            let mut destfile_path_buf2 = bun_paths::w_path_buffer_pool::get();
                            // `dest` may already be absolute (global virtual store
                            // entries live under the cache, not cwd); only prefix the
                            // working-directory path when it's project-relative.
                            // Stash the dest slice once so the `&self` borrow
                            // doesn't span the buffer-mut below.
                            let dest_slice: &[u16] = self.dest.slice();
                            let dest_parts: &[&[u16]] = if !dest_slice.is_empty()
                                && bun_paths::Platform::Windows.is_absolute_t::<u16>(dest_slice)
                            {
                                &[dest_slice]
                            } else {
                                &[&cwd_buf[..dest_cwd_len], dest_slice]
                            };
                            let joined = bun_paths::resolve_path::join_string_buf_w_same::<
                                bun_paths::platform::Windows,
                            >(
                                &mut destfile_path_buf[..], dest_parts
                            );
                            let destfile_path = bun_paths::strings::add_nt_path_prefix_if_needed(
                                &mut destfile_path_buf2[..],
                                joined,
                            );

                            match sys::link_w(self.src.slice_z(), destfile_path) {
                                sys::Result::Ok(()) => {}
                                sys::Result::Err(link_err1) => match link_err1.get_errno() {
                                    sys::E::UV_EEXIST | sys::E::EEXIST => {
                                        if crate::PackageManager::verbose_install() {
                                            bun_core::pretty_errorln!(
                                                "Hardlinking {} to a path that already exists: {}",
                                                bun_core::fmt::fmt_os_path(
                                                    self.src.slice(),
                                                    Default::default()
                                                ),
                                                bun_core::fmt::fmt_os_path(
                                                    destfile_path.as_slice(),
                                                    Default::default()
                                                ),
                                            );
                                        }

                                        {
                                            let mut delete_tree_buf =
                                                bun_paths::path_buffer_pool::get();

                                            let delete_tree_path =
                                                bun_core::convert_utf16_to_utf8_in_buffer(
                                                    &mut delete_tree_buf[..],
                                                    self.dest.slice(),
                                                );
                                            let _ = Fd::cwd().delete_tree(delete_tree_path);
                                        }
                                        match sys::link_w(self.src.slice_z(), destfile_path) {
                                            sys::Result::Ok(()) => {}
                                            sys::Result::Err(link_err2) => {
                                                break 'body Some(link_err2);
                                            }
                                        }
                                    }
                                    sys::E::UV_ENOENT | sys::E::ENOENT => {
                                        if crate::PackageManager::verbose_install() {
                                            bun_core::pretty_errorln!(
                                                "Hardlinking {} to a path that doesn't exist: {}",
                                                bun_core::fmt::fmt_os_path(
                                                    self.src.slice(),
                                                    Default::default()
                                                ),
                                                bun_core::fmt::fmt_os_path(
                                                    destfile_path.as_slice(),
                                                    Default::default()
                                                ),
                                            );
                                        }
                                        let Some(dest_parent) = self.dest.dirname() else {
                                            break 'body Some(link_err1);
                                        };

                                        let _ = sys::make_path::make_path::<u16>(
                                            &sys::Dir::cwd(),
                                            dest_parent,
                                        );

                                        match sys::link_w(self.src.slice_z(), destfile_path) {
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

                // A `dest.save()` ResetScope would hold `&mut Path` and keep
                // `self.dest` exclusively borrowed across the body. Capture
                // `len()` and restore via `set_length()` after the body so the
                // truncation runs on every exit.
                let dest_saved_len = self.dest.len();
                let _ = self.dest.append(entry.path.as_bytes()); // OOM/capacity: fire-and-forget

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
