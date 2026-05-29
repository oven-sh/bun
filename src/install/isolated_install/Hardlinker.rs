use bun_alloc::AllocError;
#[cfg(windows)]
use bun_paths::path_options::AssumeOk as _;
use bun_paths::{AbsPath, OSPathChar, OSPathSlice, Path};
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdExt};

type OsAbsPath = AbsPath<OSPathChar, { bun_paths::path_options::PathSeparators::AUTO }>;
type OsPath = Path<
    OSPathChar,
    { bun_paths::path_options::Kind::ANY },
    { bun_paths::path_options::PathSeparators::AUTO },
>;

pub struct Hardlinker {
    pub src_dir: Fd,
    pub src: OsAbsPath,
    pub dest: OsPath,
    pub walker: Walker,
}

impl Hardlinker {
    pub fn init(
        folder_dir: Fd,
        src: OsAbsPath,
        dest: OsPath,
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
            let mut cwd_buf = bun_paths::w_path_buffer_pool::get();
            let (dest_cwd_off, dest_cwd_len) = {
                let dest_cwd: &[u16] = match sys::get_fd_path_w(Fd::cwd(), &mut cwd_buf[..]) {
                    Ok(s) => &*s,
                    Err(_) => {
                        return Ok(sys::Result::Err(sys::Error::from_code(
                            sys::E::ACCES,
                            sys::Tag::link,
                        )));
                    }
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

            loop {
                let entry = match self.walker.next() {
                    sys::Result::Ok(Some(res)) => res,
                    sys::Result::Ok(None) => break,
                    sys::Result::Err(err) => return Ok(sys::Result::Err(err)),
                };

                let src_saved_len = self.src.len();
                // `OsAbsPath`/`OsPath` use `CheckLength::ASSUME`, so `append`'s
                // `Err(MaxPathExceeded)` arm is statically unreachable (Zig returns
                // `void` here) -- see `path_options::AssumeOk`.
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
                            let joined = bun_paths::resolve_path::join_string_buf_w_same::<
                                bun_paths::platform::Windows,
                            >(
                                &mut destfile_path_buf[..], dest_parts
                            );
                            let destfile_path = bun_paths::strings::add_nt_path_prefix_if_needed(
                                &mut destfile_path_buf2[..],
                                joined,
                            );

                            // Zig allocated `srcfile_path_buf` here but never used it;
                            // dropped in the port (dead code in the original).

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

                let dest_saved_len = self.dest.len();
                let _ = self.dest.append(entry.path.as_bytes()); // OOM/capacity: Zig aborts; port keeps fire-and-forget

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

// ported from: src/install/isolated_install/Hardlinker.zig
