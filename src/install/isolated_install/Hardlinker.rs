use bun_alloc::AllocError;
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdExt};
// OS-unit paths are u8 on POSIX, u16
// on Windows — encoded here via the `OSPathChar` type alias so the struct's
// `slice()`/`slice_z()` produce the platform-native width without per-field
// `#[cfg]` divergence.
use bun_paths::path_options::{CheckLength, Kind, PathSeparators};
use bun_paths::{AbsPath, OSPathChar, OSPathSlice, Path};

// Length-checked, because the walker opens each directory from its parent, so entry paths can be
// arbitrarily long.
type OsAbsPath = AbsPath<OSPathChar, { PathSeparators::AUTO }, { CheckLength::CHECK }>;
// `PathSeparators::ANY` appends the walker's paths unchanged. They already use the native
// separator, and `AUTO` would rewrite a `\` that is part of a file name on POSIX.
type OsPath = Path<OSPathChar, { Kind::ANY }, { PathSeparators::ANY }, { CheckLength::CHECK }>;

pub(crate) struct Hardlinker {
    pub(crate) src: OsAbsPath,
    pub(crate) dest: OsPath,
    pub(crate) walker: Walker,
}

fn name_too_long() -> sys::Error {
    sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::link)
}

impl Hardlinker {
    pub(crate) fn init(
        folder_dir: Fd,
        src: AbsPath<OSPathChar, { PathSeparators::AUTO }>,
        dest: Path<OSPathChar, { Kind::ANY }, { PathSeparators::AUTO }>,
        skip_dirnames: &[&OSPathSlice],
    ) -> Result<Hardlinker, AllocError> {
        Ok(Hardlinker {
            src: src.into_checked(),
            dest: dest.into_sep::<{ PathSeparators::ANY }>().into_checked(),
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
                bun_core::fmt::fmt_os_path(self.src.slice(), Default::default()),
                bun_core::fmt::fmt_os_path(self.dest.slice(), Default::default()),
            );
            bun_core::output::flush();
        }

        #[cfg(windows)]
        {
            let mut cwd_buf = bun_paths::w_path_buffer_pool::get();
            // `get_fd_path_w` writes the raw `\\?\C:\...` result into
            // `cwd_buf` and returns a SUB-SLICE (offset 4, or 6 for UNC) after
            // stripping the long-path prefix. We can't keep that slice borrowed
            // across the loop (borrowck vs `cwd_buf`), so capture both its start
            // OFFSET and length, then reslice `cwd_buf[off..off+len]` per-iter.
            // Slicing from 0 would yield `\\?\C:\…` with the last 4 chars of the
            // real cwd dropped — wrong path for every project-relative hardlink.
            let (dest_cwd_off, dest_cwd_len) = {
                let dest_cwd: &[u16] = match sys::get_fd_path_w(Fd::cwd(), &mut cwd_buf[..]) {
                    Ok(s) => &*s,
                    Err(_) => return Err(sys::Error::from_code(sys::E::ACCES, sys::Tag::link)),
                };
                // SAFETY: `dest_cwd` is a sub-slice of `cwd_buf` by contract of
                // `get_fd_path_w` (it returns `&mut out_buffer[off..]`).
                // NB: capture `len`/`dest_ptr` first so NLL drops the `&mut cwd_buf`
                // loan (held via `dest_cwd`) before `cwd_buf.as_ptr()` takes `&cwd_buf`
                // — otherwise E0502 on x86_64-pc-windows-msvc.
                let len = dest_cwd.len();
                let dest_ptr = dest_cwd.as_ptr();
                let off = unsafe { dest_ptr.offset_from(cwd_buf.as_ptr()) } as usize;
                (off, len)
            };

            while let Some(entry) = self.walker.next()? {
                // A `path.save()` ResetScope would hold `&mut Path` and keep
                // `self.src`/`self.dest` exclusively borrowed for the rest of
                // the iteration. Capture the saved lengths directly and restore
                // via `set_length` after the body (and before any error return)
                // so the truncation happens on every exit.
                let src_saved_len = self.src.len();
                let dest_saved_len = self.dest.len();

                let result: sys::Result<()> = 'body: {
                    if self.src.append(entry.path.as_slice()).is_err()
                        || self.dest.append(entry.path.as_slice()).is_err()
                    {
                        break 'body Err(name_too_long());
                    }

                    match entry.kind {
                        EntryKind::Directory => {
                            sys::make_path::make_path::<u16>(&sys::Dir::cwd(), self.dest.slice())
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
                                &[
                                    &cwd_buf[dest_cwd_off..dest_cwd_off + dest_cwd_len],
                                    dest_slice,
                                ]
                            };
                            // The join and the NT prefix below write into the buffers unchecked.
                            let needed_len =
                                dest_parts.iter().map(|part| part.len() + 1).sum::<usize>()
                                    + bun_paths::windows::NT_OBJECT_PREFIX.len();
                            if needed_len > destfile_path_buf2.len() {
                                break 'body Err(name_too_long());
                            }
                            let joined = bun_paths::resolve_path::join_string_buf_w_same::<
                                bun_paths::platform::Windows,
                            >(
                                &mut destfile_path_buf[..], dest_parts
                            );
                            let destfile_path = bun_paths::strings::add_nt_path_prefix_if_needed(
                                &mut destfile_path_buf2[..],
                                joined,
                            );

                            let Err(link_err1) = sys::link_w(self.src.slice_z(), destfile_path)
                            else {
                                break 'body Ok(());
                            };
                            match link_err1.get_errno() {
                                sys::E::UV_EEXIST | sys::E::EEXIST => {
                                    if crate::PackageManager::verbose_install() {
                                        bun_core::pretty_errorln!(
                                            "Hardlinking {} to a path that already exists: {}",
                                            bun_core::fmt::fmt_os_path(
                                                self.src.slice(),
                                                Default::default()
                                            ),
                                            bun_core::fmt::EscapeControlChars(
                                                bun_core::fmt::fmt_os_path(
                                                    destfile_path.as_slice(),
                                                    Default::default()
                                                )
                                            ),
                                        );
                                    }

                                    let mut delete_tree_buf = bun_paths::path_buffer_pool::get();
                                    let delete_tree_path =
                                        bun_core::convert_utf16_to_utf8_in_buffer(
                                            &mut delete_tree_buf[..],
                                            self.dest.slice(),
                                        );
                                    let _ = Fd::cwd().delete_tree(delete_tree_path);
                                }
                                sys::E::UV_ENOENT | sys::E::ENOENT => {
                                    if crate::PackageManager::verbose_install() {
                                        bun_core::pretty_errorln!(
                                            "Hardlinking {} to a path that doesn't exist: {}",
                                            bun_core::fmt::fmt_os_path(
                                                self.src.slice(),
                                                Default::default()
                                            ),
                                            bun_core::fmt::EscapeControlChars(
                                                bun_core::fmt::fmt_os_path(
                                                    destfile_path.as_slice(),
                                                    Default::default()
                                                )
                                            ),
                                        );
                                    }
                                    let Some(dest_parent) = self.dest.dirname() else {
                                        break 'body Err(link_err1);
                                    };

                                    let _ = sys::make_path::make_path::<u16>(
                                        &sys::Dir::cwd(),
                                        dest_parent,
                                    );
                                }
                                _ => break 'body Err(link_err1),
                            }
                            sys::link_w(self.src.slice_z(), destfile_path)
                        }
                        _ => Ok(()),
                    }
                };

                self.src.set_length(src_saved_len);
                self.dest.set_length(dest_saved_len);

                result?;
            }

            return Ok(());
        }

        #[cfg(not(windows))]
        {
            while let Some(entry) = self.walker.next()? {
                // A `dest.save()` ResetScope would hold `&mut Path` and keep
                // `self.dest` exclusively borrowed across the body. Capture
                // `len()` and restore via `set_length()` after the body so the
                // truncation runs on every exit.
                let dest_saved_len = self.dest.len();

                let result: sys::Result<()> = 'body: {
                    if self.dest.append(entry.path.as_bytes()).is_err() {
                        break 'body Err(name_too_long());
                    }

                    match entry.kind {
                        EntryKind::Directory => Fd::cwd().make_path(self.dest.slice()),
                        EntryKind::File => {
                            let (dir, name) = (entry.dir, entry.basename);
                            let Err(link_err1) =
                                sys::linkat(dir, name, Fd::cwd(), self.dest.slice_z())
                            else {
                                break 'body Ok(());
                            };
                            match link_err1.get_errno() {
                                sys::E::EEXIST => {
                                    let _ = Fd::cwd().delete_tree(self.dest.slice());
                                }
                                sys::E::ENOENT => {
                                    let Some(dest_parent) = self.dest.dirname() else {
                                        break 'body Err(link_err1);
                                    };
                                    let _ = Fd::cwd().make_path(dest_parent);
                                }
                                _ => break 'body Err(link_err1),
                            }
                            sys::linkat(dir, name, Fd::cwd(), self.dest.slice_z())
                        }
                        _ => Ok(()),
                    }
                };

                self.dest.set_length(dest_saved_len);

                result?;
            }

            Ok(())
        }
    }
}
