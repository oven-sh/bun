//! `bun.sys.Dir` — directory handle + helpers. Port of the `Dir` half of
//! `src/sys/sys.zig` (Zig: `bun.sys.Dir` ≈ `std.fs.Dir`).
//!
//! `Dir` is `Copy` and does not close on Drop; use [`OwnedDir`] for RAII close.

use super::*;

// ──────────────────────────────────────────────────────────────────────────
// `Dir` — `std.fs.Dir` replacement. Thin wrapper over `Fd`; close on Drop is
// NOT done (matches Zig — callers explicitly `.close()` or hold for lifetime).
// ──────────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
pub struct Dir {
    pub fd: Fd,
}

/// Options for `Dir::copy_file` (Zig: `std.fs.Dir.CopyFileOptions`).
#[derive(Clone, Copy, Default)]
pub struct CopyFileOptions {
    /// When set, the destination is created with this mode instead of the
    /// source file's mode (Zig: `override_mode: ?File.Mode`).
    pub override_mode: Option<Mode>,
}

/// Options for `Dir::make_open_path` (Zig: `std.fs.Dir.OpenOptions`).
#[derive(Clone, Copy, Default)]
pub struct OpenDirOptions {
    pub iterate: bool,
    pub no_follow: bool,
}

impl Dir {
    #[inline]
    pub fn from_fd(fd: Fd) -> Self {
        Self { fd }
    }
    #[inline]
    pub fn fd(&self) -> Fd {
        self.fd
    }
    #[inline]
    pub fn cwd() -> Self {
        Self { fd: Fd::cwd() }
    }
    #[inline]
    pub fn close(self) {
        let _ = close(self.fd);
    }

    /// `std.fs.Dir.makePath` — `mkdir -p` relative to this dir.
    #[inline]
    pub fn make_path(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        mkdir_recursive_at(self.fd, sub_path).map_err(Into::into)
    }
    /// `std.fs.Dir.makeOpenPath` — try `openDir` first; on ENOENT, `makePath`
    /// then `openDir` (Zig: vendor/zig/lib/std/fs/Dir.zig `makeOpenPath`).
    pub fn make_open_path(
        &self,
        sub_path: &[u8],
        _opts: OpenDirOptions,
    ) -> core::result::Result<Dir, bun_core::Error> {
        match open_dir_at(self.fd, sub_path) {
            Ok(fd) => Ok(Dir::from_fd(fd)),
            Err(e) if e.get_errno() == E::ENOENT => {
                mkdir_recursive_at(self.fd, sub_path)?;
                open_dir_at(self.fd, sub_path)
                    .map(Dir::from_fd)
                    .map_err(Into::into)
            }
            Err(e) => Err(e.into()),
        }
    }
    /// `std.fs.Dir.deleteTree` — recursive `rm -rf`. Port of Zig
    /// `std.fs.Dir.deleteTree` (stack-based depth-first walk; std/fs/Dir.zig).
    pub fn delete_tree(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        // `deleteTreeOpenInitialSubpath` — try unlinking as a file first; if
        // that yields IsDir/EPERM, open it as an iterable directory.
        let initial = match self.delete_tree_open_initial_subpath(sub_path)? {
            Some(d) => d,
            None => return Ok(()),
        };

        struct StackItem {
            name: Vec<u8>,
            parent_dir: Fd,
            iter: dir_iterator::WrappedIterator,
        }
        // Ensure every still-open iterator dir is closed on early return
        // (Zig: `defer StackItem.closeAll(stack.items)`).
        let mut stack = scopeguard::guard(Vec::<StackItem>::with_capacity(16), |mut s| {
            for item in s.drain(..) {
                let _ = close(item.iter.dir());
            }
        });
        stack.push(StackItem {
            name: sub_path.to_vec(),
            parent_dir: self.fd,
            iter: dir_iterator::iterate(initial),
        });

        'process_stack: while let Some(top) = stack.last_mut() {
            while let Some(entry) = top.iter.next().map_err(bun_core::Error::from)? {
                let mut treat_as_dir = matches!(entry.kind, EntryKind::Directory);
                'handle_entry: loop {
                    if treat_as_dir {
                        let new_dir = match openat_a(
                            top.iter.dir(),
                            entry.name.slice_u8(),
                            O::DIRECTORY | O::RDONLY | O::CLOEXEC | O::NOFOLLOW,
                            0,
                        ) {
                            Ok(fd) => fd,
                            Err(e) => match e.get_errno() {
                                E::ENOTDIR => {
                                    treat_as_dir = false;
                                    continue 'handle_entry;
                                }
                                // That's fine, we were trying to remove this directory anyway.
                                E::ENOENT => break 'handle_entry,
                                _ => return Err(e.into()),
                            },
                        };
                        let parent = top.iter.dir();
                        // PORT NOTE: Zig caps the stack at 16 and falls back to
                        // `deleteTreeMinStackSizeWithKindHint` past that depth. The
                        // Rust `Vec` grows, so the capacity check is dropped — same
                        // semantics, no fixed-depth limit.
                        stack.push(StackItem {
                            name: entry.name.slice_u8().to_vec(),
                            parent_dir: parent,
                            iter: dir_iterator::iterate(new_dir),
                        });
                        continue 'process_stack;
                    } else {
                        match unlinkat_a(top.iter.dir(), entry.name.slice_u8(), 0) {
                            Ok(()) => break 'handle_entry,
                            Err(e) => match e.get_errno() {
                                E::ENOENT => break 'handle_entry,
                                // EISDIR (Linux) / EPERM (POSIX rmdir-required)
                                E::EISDIR | E::EPERM => {
                                    treat_as_dir = true;
                                    continue 'handle_entry;
                                }
                                _ => return Err(e.into()),
                            },
                        }
                    }
                }
            }

            // Reached the end of the directory entries — exhausted; remove the
            // directory itself. On Windows we must close before removing.
            let dir_fd = top.iter.dir();
            let parent_dir = top.parent_dir;
            let name = core::mem::take(&mut top.name);
            // Pop before closing so the cleanup guard doesn't double-close on
            // an error from `unlinkat_a` (Zig: `stack.items.len -= 1`).
            stack.pop();
            let _ = close(dir_fd);

            let mut need_to_retry = false;
            match unlinkat_a(parent_dir, &name, AT_REMOVEDIR) {
                Ok(()) => {}
                Err(e) => match e.get_errno() {
                    E::ENOENT => {}
                    E::ENOTEMPTY => need_to_retry = true,
                    _ => return Err(e.into()),
                },
            }

            if need_to_retry {
                // Since we closed the handle that the previous iterator used, we
                // need to re-open the dir and re-create the iterator.
                let new_dir = match openat_a(
                    parent_dir,
                    &name,
                    O::DIRECTORY | O::RDONLY | O::CLOEXEC | O::NOFOLLOW,
                    0,
                ) {
                    Ok(fd) => fd,
                    Err(e) => match e.get_errno() {
                        E::ENOTDIR => {
                            // Racing fs: it became a file; unlink it.
                            match unlinkat_a(parent_dir, &name, 0) {
                                Ok(()) => continue 'process_stack,
                                Err(e2) => match e2.get_errno() {
                                    E::ENOENT => continue 'process_stack,
                                    _ => return Err(e2.into()),
                                },
                            }
                        }
                        E::ENOENT => continue 'process_stack,
                        _ => return Err(e.into()),
                    },
                };
                stack.push(StackItem {
                    name,
                    parent_dir,
                    iter: dir_iterator::iterate(new_dir),
                });
                continue 'process_stack;
            }
        }
        scopeguard::ScopeGuard::into_inner(stack);
        Ok(())
    }

    /// Port of `std.fs.Dir.deleteTreeOpenInitialSubpath` — try removing
    /// `sub_path` as a file; on `EISDIR`/`EPERM` open it as an iterable
    /// directory and return the fd. Returns `None` when removal succeeded or
    /// the path doesn't exist.
    fn delete_tree_open_initial_subpath(
        &self,
        sub_path: &[u8],
    ) -> core::result::Result<Option<Fd>, bun_core::Error> {
        let mut treat_as_dir = false;
        loop {
            if !treat_as_dir {
                match unlinkat_a(self.fd, sub_path, 0) {
                    Ok(()) => return Ok(None),
                    Err(e) => match e.get_errno() {
                        E::ENOENT => return Ok(None),
                        // Linux: EISDIR. POSIX: EPERM when target is a directory.
                        E::EISDIR | E::EPERM => treat_as_dir = true,
                        _ => return Err(e.into()),
                    },
                }
            } else {
                return match openat_a(
                    self.fd,
                    sub_path,
                    O::DIRECTORY | O::RDONLY | O::CLOEXEC | O::NOFOLLOW,
                    0,
                ) {
                    Ok(fd) => Ok(Some(fd)),
                    Err(e) => match e.get_errno() {
                        E::ENOENT => Ok(None),
                        E::ENOTDIR => {
                            treat_as_dir = false;
                            continue;
                        }
                        _ => Err(e.into()),
                    },
                };
            }
        }
    }
}

#[cfg(unix)]
pub const AT_REMOVEDIR: i32 = libc::AT_REMOVEDIR;
#[cfg(windows)]
pub const AT_REMOVEDIR: i32 = 0x200;

/// sys.zig:2928 `rmdirat` — `unlinkat(dir, path, AT_REMOVEDIR)`.
#[inline]
pub fn rmdirat(dirfd: Fd, path: &ZStr) -> Maybe<()> {
    unlinkat_with_flags(dirfd, path, AT_REMOVEDIR)
}

/// `unlinkat` taking a non-sentinel slice (NUL-terminates into a path buffer).
fn unlinkat_a(dirfd: Fd, path: &[u8], flags: i32) -> Maybe<()> {
    let mut buf = bun_paths::PathBuffer::default();
    let len = path.len().min(buf.0.len() - 1);
    buf.0[..len].copy_from_slice(&path[..len]);
    buf.0[len] = 0;
    // SAFETY: NUL-terminated above.
    let z = ZStr::from_buf(&buf.0[..], len);
    unlinkat_with_flags(dirfd, z, flags)
}

/// RAII owner for a `Dir` — closes the fd on `Drop`. Use when a directory is
/// opened for a bounded scope and must be closed on every exit path (Zig:
/// `defer dir.close()`). `Dir` itself stays `Copy` and never closes implicitly.
pub struct OwnedDir(Dir);
impl OwnedDir {
    #[inline]
    pub fn new(dir: Dir) -> Self {
        Self(dir)
    }
    #[inline]
    pub fn dir(&self) -> Dir {
        self.0
    }
    #[inline]
    pub fn fd(&self) -> Fd {
        self.0.fd
    }
    /// Take the inner `Dir` without closing it.
    #[inline]
    pub fn into_inner(self) -> Dir {
        let d = self.0;
        core::mem::forget(self);
        d
    }
}
impl Drop for OwnedDir {
    #[inline]
    fn drop(&mut self) {
        let _ = close(self.0.fd);
    }
}
impl core::ops::Deref for OwnedDir {
    type Target = Dir;
    #[inline]
    fn deref(&self) -> &Dir {
        &self.0
    }
}

/// `std.fs.File.CreateFlags` — subset used by `Dir::createFileZ` callers
/// (e.g. `repository.zig:649`, `PackageManagerDirectories.zig`).
#[derive(Clone, Copy, Default)]
pub struct CreateFlags {
    pub truncate: bool,
    /// Open for reading as well as writing (Zig: `read: bool = false`).
    pub read: bool,
}

impl Dir {
    /// `std.fs.Dir.makeDir` — single-level `mkdirat` (mode 0o755) relative to
    /// this dir. Unlike `make_path`, does NOT create intermediate directories
    /// and surfaces `error.PathAlreadyExists` for callers to branch on.
    pub fn make_dir(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        let mut buf = bun_paths::PathBuffer::default();
        let len = sub_path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&sub_path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = ZStr::from_buf(&buf.0[..], len);
        match mkdirat(self.fd, z, 0o755) {
            Ok(()) => Ok(()),
            Err(e) if e.get_errno() == E::EEXIST => Err(bun_core::err!("PathAlreadyExists")),
            Err(e) => Err(e.into()),
        }
    }

    /// `std.fs.Dir.symLink` — `symlinkat(target, self.fd, link)`. The
    /// `is_directory` flag is a no-op on POSIX (kept for parity with Zig's
    /// `SymLinkFlags`); on Windows it selects junction vs. file-symlink and
    /// callers route through `sys_uv::symlink_uv` instead.
    pub fn sym_link(
        &self,
        target: &[u8],
        link_name: &[u8],
        _is_directory: bool,
    ) -> core::result::Result<(), bun_core::Error> {
        let mut tbuf = bun_paths::PathBuffer::default();
        let tlen = target.len().min(tbuf.0.len() - 1);
        tbuf.0[..tlen].copy_from_slice(&target[..tlen]);
        tbuf.0[tlen] = 0;
        // SAFETY: NUL-terminated above.
        let tz = ZStr::from_buf(&tbuf.0[..], tlen);

        let mut lbuf = bun_paths::PathBuffer::default();
        let llen = link_name.len().min(lbuf.0.len() - 1);
        lbuf.0[..llen].copy_from_slice(&link_name[..llen]);
        lbuf.0[llen] = 0;
        // SAFETY: NUL-terminated above.
        let lz = ZStr::from_buf(&lbuf.0[..], llen);

        symlinkat(tz, self.fd, lz).map_err(Into::into)
    }

    /// `std.fs.Dir.createFileZ` — create (or truncate) `sub_path` relative to
    /// this dir and return a `File` handle. Zig stdlib semantics: `O_CREAT`,
    /// `O_WRONLY` (or `O_RDWR` if `flags.read`), `O_TRUNC` if `flags.truncate`.
    pub fn create_file_z(
        &self,
        sub_path: &ZStr,
        flags: CreateFlags,
    ) -> core::result::Result<File, bun_core::Error> {
        let mut o = O::CREAT | O::CLOEXEC;
        o |= if flags.read { O::RDWR } else { O::WRONLY };
        if flags.truncate {
            o |= O::TRUNC;
        }
        let fd = openat(self.fd, sub_path, o, 0o666)?;
        Ok(File::from_fd(fd))
    }

    /// `std.fs.Dir.deleteFileZ` — `unlinkat(self.fd, sub_path, 0)`.
    #[inline]
    pub fn delete_file_z(&self, sub_path: &ZStr) -> core::result::Result<(), bun_core::Error> {
        unlinkat(self.fd, sub_path).map_err(Into::into)
    }

    /// `std.fs.Dir.copyFile` — open `source_path` (relative to `self`), create
    /// `dest_path` (relative to `dest_dir`) with `O_CREAT|O_TRUNC`, then stream
    /// the contents via [`copy_file`]. Mode is taken from the source's `fstat`
    /// unless `options.override_mode` is set (Zig stdlib semantics, minus the
    /// `AtomicFile` rename — Bun's only call site is `gitignore` → `.gitignore`
    /// where atomicity isn't required).
    pub fn copy_file(
        &self,
        source_path: &[u8],
        dest_dir: &Dir,
        dest_path: &[u8],
        options: CopyFileOptions,
    ) -> core::result::Result<(), bun_core::Error> {
        let in_fd = openat_a(self.fd, source_path, O::RDONLY | O::CLOEXEC, 0)?;
        let mode = match options.override_mode {
            Some(m) => m,
            None => match fstat(in_fd) {
                Ok(st) => st.st_mode as Mode,
                Err(e) => {
                    let _ = close(in_fd);
                    return Err(e.into());
                }
            },
        };
        let out_fd = match openat_a(
            dest_dir.fd,
            dest_path,
            O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC,
            mode,
        ) {
            Ok(fd) => fd,
            Err(e) => {
                let _ = close(in_fd);
                return Err(e.into());
            }
        };
        let r = copy_file(in_fd, out_fd);
        let _ = close(in_fd);
        let _ = close(out_fd);
        r.map_err(Into::into)
    }

    /// `std.fs.Dir.openDirZ` — open `sub_path` (NUL-terminated) relative to
    /// this dir as a `Dir` handle. Zig stdlib semantics: `O_DIRECTORY |
    /// O_RDONLY | O_CLOEXEC` (handled by `open_dir_at`).
    #[inline]
    pub fn open_dir_z(&self, sub_path: &ZStr) -> core::result::Result<Dir, bun_core::Error> {
        open_dir_at(self.fd, sub_path.as_bytes())
            .map(Dir::from_fd)
            .map_err(Into::into)
    }

    /// `std.fs.Dir.openDir(sub_path, .{ .iterate, .no_follow, .access_sub_paths = true })`.
    ///
    /// On POSIX, `iterate` / `access_sub_paths` are advisory (stdlib opens with
    /// `O_DIRECTORY | O_RDONLY | O_CLOEXEC` regardless). On Windows the flags
    /// select the access mask: `iterate` adds `FILE_LIST_DIRECTORY`, and the
    /// handle is opened **without** `read_only` so the caller may create/rename
    /// children — matching `std.fs.Dir.openDir`, *not* `bun.openDir`.
    #[inline]
    pub fn open_dir(
        &self,
        sub_path: &[u8],
        opts: OpenDirOptions,
    ) -> core::result::Result<Dir, bun_core::Error> {
        #[cfg(windows)]
        {
            return open_dir_at_windows_a(
                self.fd,
                sub_path,
                WindowsOpenDirOptions {
                    iterable: opts.iterate,
                    no_follow: opts.no_follow,
                    ..Default::default()
                },
            )
            .map(Dir::from_fd)
            .map_err(Into::into);
        }
        #[cfg(not(windows))]
        {
            let _ = opts;
            open_dir_at(self.fd, sub_path)
                .map(Dir::from_fd)
                .map_err(Into::into)
        }
    }
}

/// bun.zig — `bun.openDir(dir, path)`. Opens `path` relative to `dir` as a
/// directory `Dir` handle.
#[inline]
pub fn open_dir(dir: Dir, path: &[u8]) -> core::result::Result<Dir, bun_core::Error> {
    open_dir_at(dir.fd, path)
        .map(Dir::from_fd)
        .map_err(Into::into)
}

// `Fd` parity: `Fd::cwd().make_open_path(..)` / `.make_path(..)` are used by
// `bun_install` and `bun_bundler` directly on `Fd`. Extension trait so we
// don't fight with `bun_core`'s inherent impl.
pub trait FdDirExt: Copy {
    fn make_path(self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error>;
    fn make_open_path(self, sub_path: &[u8]) -> core::result::Result<Dir, bun_core::Error>;
    fn from_std_dir(dir: &Dir) -> Self;
}
impl FdDirExt for Fd {
    #[inline]
    fn make_path(self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        mkdir_recursive_at(self, sub_path).map_err(Into::into)
    }
    #[inline]
    fn make_open_path(self, sub_path: &[u8]) -> core::result::Result<Dir, bun_core::Error> {
        Dir::from_fd(self).make_open_path(sub_path, OpenDirOptions::default())
    }
    #[inline]
    fn from_std_dir(dir: &Dir) -> Fd {
        dir.fd
    }
}
