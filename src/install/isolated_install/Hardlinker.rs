use bun_alloc::AllocError;
#[cfg(windows)]
use bun_paths::typed::{AbsPath, Classified};
use bun_paths::typed::{AbsPathBuf, AnyPathBuf, Pooled, SubPath};
use bun_paths::{OSPathChar, OSPathSlice};
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdExt};

use super::path_error;

pub(crate) type OsAbsPathBuf = AbsPathBuf<Pooled<OSPathChar>, OSPathChar>;
pub(crate) type OsPathBuf = AnyPathBuf<Pooled<OSPathChar>, OSPathChar>;

pub(crate) struct Hardlinker {
    pub(crate) src: OsAbsPathBuf,
    pub(crate) dest: OsPathBuf,
    pub(crate) walker: Walker,
}

#[cfg(windows)]
fn name_too_long() -> sys::Error {
    sys::Error::from_code(sys::E::ENAMETOOLONG, sys::Tag::link)
}

impl Hardlinker {
    pub(crate) fn init(
        folder_dir: Fd,
        src: OsAbsPathBuf,
        dest: OsPathBuf,
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

    pub(crate) fn link(&mut self) -> sys::Result<()> {
        let path_error = path_error(sys::Tag::link);
        let src = self.src.get().map_err(path_error)?;
        let dest = self.dest.get().map_err(path_error)?;
        if crate::PackageManager::verbose_install() {
            bun_core::pretty_errorln!(
                "Hardlinking {} to {}",
                bun_core::fmt::fmt_os_path(src.units(), Default::default()),
                bun_core::fmt::fmt_os_path(dest.units(), Default::default()),
            );
            bun_core::output::flush();
        }

        #[cfg(windows)]
        {
            let mut cwd_buf = bun_paths::w_path_buffer_pool::get();
            let Ok(cwd) = sys::get_fd_path_w(Fd::cwd(), &mut cwd_buf[..]) else {
                return Err(sys::Error::from_code(sys::E::ACCES, sys::Tag::link));
            };
            let cwd = AbsPath::from_os(cwd);

            while let Some(entry) = self.walker.next()? {
                let (mut src, mut dest) = (self.src.scope(), self.dest.scope());
                let below = SubPath::from_os(entry.path.as_slice());
                let src = src.push(below).get().map_err(path_error)?;
                let dest = dest.push(below).get().map_err(path_error)?;

                match entry.kind {
                    EntryKind::Directory => {
                        sys::make_path::make_path::<u16>(&sys::Dir::cwd(), dest.units())?;
                    }
                    EntryKind::File => {
                        let mut destfile_path_buf = bun_paths::w_path_buffer_pool::get();
                        let mut destfile_path_buf2 = bun_paths::w_path_buffer_pool::get();
                        // `dest` may already be absolute (global virtual store
                        // entries live under the cache, not cwd); only prefix the
                        // working-directory path when it's project-relative.
                        let dest_parts: &[&[u16]] = match dest.classify() {
                            Classified::Abs(dest) => &[dest.units()],
                            Classified::Rel(dest) => &[cwd.units(), dest.units()],
                        };
                        // MISFIT: no view holds the NT prefix, so the link's own path is raw units.
                        // The join and the NT prefix below write into the buffers unchecked.
                        let needed_len =
                            dest_parts.iter().map(|part| part.len() + 1).sum::<usize>()
                                + bun_paths::windows::NT_OBJECT_PREFIX.len();
                        if needed_len > destfile_path_buf2.len() {
                            return Err(name_too_long());
                        }
                        let joined =
                            bun_paths::resolve_path::join_string_buf_w_same::<
                                bun_paths::platform::Windows,
                            >(&mut destfile_path_buf[..], dest_parts);
                        let destfile_path = bun_paths::strings::add_nt_path_prefix_if_needed(
                            &mut destfile_path_buf2[..],
                            joined,
                        );

                        let Err(link_err1) = sys::link_w(src.z(), destfile_path) else {
                            continue;
                        };
                        match link_err1.get_errno() {
                            sys::E::UV_EEXIST | sys::E::EEXIST => {
                                if crate::PackageManager::verbose_install() {
                                    bun_core::pretty_errorln!(
                                        "Hardlinking {} to a path that already exists: {}",
                                        bun_core::fmt::fmt_os_path(src.units(), Default::default()),
                                        bun_core::fmt::EscapeControlChars(
                                            bun_core::fmt::fmt_os_path(
                                                destfile_path.as_slice(),
                                                Default::default()
                                            )
                                        ),
                                    );
                                }

                                let mut delete_tree_buf = bun_paths::path_buffer_pool::get();
                                let delete_tree_path = bun_core::convert_utf16_to_utf8_in_buffer(
                                    &mut delete_tree_buf[..],
                                    dest.units(),
                                );
                                let _ = Fd::cwd().delete_tree(delete_tree_path);
                            }
                            sys::E::UV_ENOENT | sys::E::ENOENT => {
                                if crate::PackageManager::verbose_install() {
                                    bun_core::pretty_errorln!(
                                        "Hardlinking {} to a path that doesn't exist: {}",
                                        bun_core::fmt::fmt_os_path(src.units(), Default::default()),
                                        bun_core::fmt::EscapeControlChars(
                                            bun_core::fmt::fmt_os_path(
                                                destfile_path.as_slice(),
                                                Default::default()
                                            )
                                        ),
                                    );
                                }
                                let Some(dest_parent) = dest.parent() else {
                                    return Err(link_err1);
                                };

                                let _ = sys::make_path::make_path::<u16>(
                                    &sys::Dir::cwd(),
                                    dest_parent.units(),
                                );
                            }
                            _ => return Err(link_err1),
                        }
                        sys::link_w(src.z(), destfile_path)?;
                    }
                    _ => {}
                }
            }

            return Ok(());
        }

        #[cfg(not(windows))]
        {
            while let Some(entry) = self.walker.next()? {
                let mut dest = self.dest.scope();
                let dest = (dest.push(SubPath::from_os(entry.path.as_bytes())).get())
                    .map_err(path_error)?;

                match entry.kind {
                    EntryKind::Directory => Fd::cwd().make_path(dest.as_bytes())?,
                    EntryKind::File => {
                        let (dir, name) = (entry.dir, entry.basename);
                        let Err(link_err1) = sys::linkat(dir, name, Fd::cwd(), dest.z()) else {
                            continue;
                        };
                        match link_err1.get_errno() {
                            sys::E::EEXIST => {
                                let _ = Fd::cwd().delete_tree(dest.as_bytes());
                            }
                            sys::E::ENOENT => {
                                let Some(dest_parent) = dest.parent() else {
                                    return Err(link_err1);
                                };
                                let _ = Fd::cwd().make_path(dest_parent.as_bytes());
                            }
                            _ => return Err(link_err1),
                        }
                        sys::linkat(dir, name, Fd::cwd(), dest.z())?;
                    }
                    _ => {}
                }
            }

            Ok(())
        }
    }
}
