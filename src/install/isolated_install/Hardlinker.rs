use bun_alloc::AllocError;
use bun_sys::walker_skippable::Walker;
use bun_sys::{self as sys, EntryKind, Fd, FdDirExt, FdExt};
// `bun.AbsPath(.{ .sep = .auto, .unit = .os })` / `bun.Path(.{ .sep = .auto, .unit = .os })`
// take a comptime config struct in Zig. `.unit = .os` means u8 on POSIX, u16
// on Windows — encoded here via the `OSPathChar` type alias so the struct's
// `slice()`/`slice_z()` produce the platform-native width without per-field
// `#[cfg]` divergence.
use bun_paths::path_options::AssumeOk as _;
use bun_paths::{AbsPath, OSPathChar, OSPathSlice, Path};

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
            let mut cwd_buf = bun_paths::w_path_buffer_pool::get();
            // PORT NOTE: Zig spelt `FD.cwd().getFdPathW(buf)`; the Rust `Fd`
            // newtype lives in `bun_core` and has no sys-layer methods, so call
            // the free fn.
            // PORT NOTE: `get_fd_path_w` writes the raw `\\?\C:\...` result into
            // `cwd_buf` and returns a SUB-SLICE (offset 4, or 6 for UNC) after
            // stripping the long-path prefix. We can't keep that slice borrowed
            // across the loop (borrowck vs `cwd_buf`), so capture both its start
            // OFFSET and length, then reslice `cwd_buf[off..off+len]` per-iter.
            // Slicing from 0 would yield `\\?\C:\…` with the last 4 chars of the
            // real cwd dropped — wrong path for every project-relative hardlink.
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

                // PORT NOTE: reshaped for borrowck — Zig's `var s = path.save();
                // defer s.restore();` returns a `ResetScope` that holds `&mut Path`,
                // which would keep `self.src`/`self.dest` exclusively borrowed for
                // the rest of the iteration. Capture the saved length directly and
                // restore via `set_length` after the body (and before any error
                // return) so the truncation happens on every exit, matching `defer`.
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
                                sys::Dir::from_fd(Fd::cwd()),
                                self.dest.slice(),
                            );
                        }
                        EntryKind::File => {
                            let mut destfile_path_buf = bun_paths::w_path_buffer_pool::get();
                            let mut destfile_path_buf2 = bun_paths::w_path_buffer_pool::get();
                            // `dest` may already be absolute (global virtual store
                            // entries live under the cache, not cwd); only prefix the
                            // working-directory path when it's project-relative.
                            // PORT NOTE: borrowck — Zig held both `dest_cwd` and
                            // `self.dest.slice()` simultaneously; here `dest_cwd`
                            // borrows `cwd_buf` and `self.dest.slice()` borrows
                            // `self`, which is fine, but stash the dest slice once
                            // so the borrow doesn't span the buffer-mut below.
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
                                            sys::Dir::from_fd(Fd::cwd()),
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

                // PORT NOTE: reshaped for borrowck — Zig's `var s = dest.save();
                // defer s.restore();` returns a `ResetScope` holding `&mut Path`,
                // which would keep `self.dest` exclusively borrowed across the
                // body. Capture `len()` and restore via `set_length()` after the
                // body so the truncation runs on every exit, matching `defer`.
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
