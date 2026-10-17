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

#[cfg(not(windows))]
use crate::package_install::copy_file_at;
use crate::package_install::copy_refused_link;
#[cfg(windows)]
use crate::package_install::copy_to_new_file_w;

// Length-checked: the walker opens each directory from its parent, so entry paths are unbounded.
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

    /// Links every file of the walk. A file whose link the file system
    /// refuses is copied instead. `Ok(true)`: the file system refuses every
    /// link from `src` to `dest`, and the walk copied from that file on.
    pub(crate) fn link(&mut self) -> sys::Result<bool> {
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
                            let Some(destfile_path) = Self::dest_file_path(
                                self.dest.slice(),
                                &cwd_buf[dest_cwd_off..dest_cwd_off + dest_cwd_len],
                                &mut destfile_path_buf[..],
                                &mut destfile_path_buf2[..],
                            ) else {
                                break 'body Err(name_too_long());
                            };

                            let Err(link_err1) = sys::link_w(self.src.slice_z(), destfile_path)
                            else {
                                break 'body Ok(());
                            };
                            let refused = match link_err1.get_errno() {
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
                                    match sys::link_w(self.src.slice_z(), destfile_path) {
                                        Ok(()) => break 'body Ok(()),
                                        Err(link_err2) => link_err2,
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
                                    match sys::link_w(self.src.slice_z(), destfile_path) {
                                        Ok(()) => break 'body Ok(()),
                                        Err(link_err2) => link_err2,
                                    }
                                }
                                _ => link_err1,
                            };
                            let src = self.src.slice_z();
                            let dest = &self.dest;
                            match copy_refused_link(refused, move || {
                                Self::copy_file(src, dest, destfile_path)
                            }) {
                                Ok(false) => Ok(()),
                                Ok(true) => {
                                    return self
                                        .copy_rest(
                                            src_saved_len,
                                            dest_saved_len,
                                            &cwd_buf[dest_cwd_off..dest_cwd_off + dest_cwd_len],
                                        )
                                        .map(|()| true);
                                }
                                Err(err) => Err(err),
                            }
                        }
                        _ => Ok(()),
                    }
                };

                self.src.set_length(src_saved_len);
                self.dest.set_length(dest_saved_len);

                result?;
            }

            return Ok(false);
        }

        #[cfg(not(windows))]
        {
            let mut copy_file_state = bun_sys::copy_file::CopyFileState::default();
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
                            let refused = match link_err1.get_errno() {
                                sys::E::EEXIST => {
                                    let _ = Fd::cwd().delete_tree(self.dest.slice());
                                    match sys::linkat(dir, name, Fd::cwd(), self.dest.slice_z()) {
                                        Ok(()) => break 'body Ok(()),
                                        Err(link_err2) => link_err2,
                                    }
                                }
                                sys::E::ENOENT => {
                                    let Some(dest_parent) = self.dest.dirname() else {
                                        break 'body Err(link_err1);
                                    };
                                    let _ = Fd::cwd().make_path(dest_parent);
                                    match sys::linkat(dir, name, Fd::cwd(), self.dest.slice_z()) {
                                        Ok(()) => break 'body Ok(()),
                                        Err(link_err2) => link_err2,
                                    }
                                }
                                _ => link_err1,
                            };
                            // `move`: a closure that borrows `entry` makes every
                            // iteration of this loop store `entry` to the stack.
                            let dest = self.dest.slice_z();
                            let state = &mut copy_file_state;
                            match copy_refused_link(refused, move || {
                                Self::copy_file(dir, name, dest, state)
                            }) {
                                Ok(false) => Ok(()),
                                Ok(true) => {
                                    return self
                                        .copy_rest(dest_saved_len, &mut copy_file_state)
                                        .map(|()| true);
                                }
                                Err(err) => Err(err),
                            }
                        }
                        _ => Ok(()),
                    }
                };

                self.dest.set_length(dest_saved_len);

                result?;
            }

            Ok(false)
        }
    }

    /// The absolute NT path of `dest`. `None`: it does not fit the buffers.
    #[cfg(windows)]
    fn dest_file_path<'a>(
        dest: &[u16],
        cwd: &[u16],
        buf: &mut [u16],
        buf2: &'a mut [u16],
    ) -> Option<&'a bun_core::WStr> {
        // `dest` may already be absolute (global virtual store
        // entries live under the cache, not cwd); only prefix the
        // working-directory path when it's project-relative.
        let dest_parts: &[&[u16]] =
            if !dest.is_empty() && bun_paths::Platform::Windows.is_absolute_t::<u16>(dest) {
                &[dest]
            } else {
                &[cwd, dest]
            };
        // The join and the NT prefix below write into the buffers unchecked.
        let needed_len = dest_parts.iter().map(|part| part.len() + 1).sum::<usize>()
            + bun_paths::windows::NT_OBJECT_PREFIX.len();
        if needed_len > buf2.len() {
            return None;
        }
        let joined = bun_paths::resolve_path::join_string_buf_w_same::<bun_paths::platform::Windows>(
            buf, dest_parts,
        );
        Some(bun_paths::strings::add_nt_path_prefix_if_needed(
            buf2, joined,
        ))
    }

    /// Copies one file of the walk to `destfile_path`, the absolute NT path
    /// of `dest`.
    #[cfg(windows)]
    fn copy_file(
        src: &bun_core::WStr,
        dest: &OsPath,
        destfile_path: &bun_core::WStr,
    ) -> sys::Result<()> {
        if copy_to_new_file_w(src, destfile_path).is_ok() {
            return Ok(());
        }
        // A refusal can come before the check that the parent exists.
        if let Some(dest_parent) = dest.dirname() {
            let _ = sys::make_path::make_path::<u16>(&sys::Dir::cwd(), dest_parent);
        }
        copy_to_new_file_w(src, destfile_path)
            .map_err(|code| sys::Error::from_win32(code, sys::Tag::copyfile))
    }

    /// The file system refused a link. Copies what is left of the walk.
    /// `src_len` and `dest_len` cut the refused entry's path off the two paths.
    #[cfg(windows)]
    #[cold]
    fn copy_rest(&mut self, src_len: usize, dest_len: usize, cwd: &[u16]) -> sys::Result<()> {
        self.src.set_length(src_len);
        self.dest.set_length(dest_len);
        while let Some(entry) = self.walker.next()? {
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
                        let Some(destfile_path) = Self::dest_file_path(
                            self.dest.slice(),
                            cwd,
                            &mut destfile_path_buf[..],
                            &mut destfile_path_buf2[..],
                        ) else {
                            break 'body Err(name_too_long());
                        };
                        Self::copy_file(self.src.slice_z(), &self.dest, destfile_path)
                    }
                    _ => Ok(()),
                }
            };

            self.src.set_length(src_saved_len);
            self.dest.set_length(dest_saved_len);

            result?;
        }
        Ok(())
    }

    /// Copies one file of the walk to `dest`.
    #[cfg(not(windows))]
    fn copy_file(
        src_dir: Fd,
        src_basename: &bun_core::ZStr,
        dest: &bun_core::ZStr,
        copy_file_state: &mut bun_sys::copy_file::CopyFileState,
    ) -> sys::Result<()> {
        match copy_file_at(src_dir, src_basename, Fd::cwd(), dest, copy_file_state) {
            // The copy unlinks a file that is in its way. Like the link walk,
            // remove a directory too.
            Err(err) if err.get_errno() == sys::E::EEXIST => {
                let _ = Fd::cwd().delete_tree(dest.as_bytes());
                copy_file_at(src_dir, src_basename, Fd::cwd(), dest, copy_file_state)
            }
            result => result,
        }
    }

    /// The file system refused a link. Copies what is left of the walk.
    /// `dest_len` cuts the refused entry's path off `dest`. `link` leaves that
    /// to this function: a `set_length` call in `link` that is not inlined
    /// makes each access to `dest` in the link loop cost one more instruction.
    #[cfg(not(windows))]
    #[cold]
    fn copy_rest(
        &mut self,
        dest_len: usize,
        copy_file_state: &mut bun_sys::copy_file::CopyFileState,
    ) -> sys::Result<()> {
        self.dest.set_length(dest_len);
        while let Some(entry) = self.walker.next()? {
            let dest_saved_len = self.dest.len();

            let result: sys::Result<()> = 'body: {
                if self.dest.append(entry.path.as_bytes()).is_err() {
                    break 'body Err(name_too_long());
                }

                match entry.kind {
                    EntryKind::Directory => Fd::cwd().make_path(self.dest.slice()),
                    EntryKind::File => Self::copy_file(
                        entry.dir,
                        entry.basename,
                        self.dest.slice_z(),
                        copy_file_state,
                    ),
                    _ => Ok(()),
                }
            };

            self.dest.set_length(dest_saved_len);

            result?;
        }
        Ok(())
    }
}
