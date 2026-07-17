//! `bun.sys.Dir` — directory handle + helpers.
//!
//! Owns the descriptor; closes it on Drop (skipping `Fd::INVALID` and the
//! `AT_FDCWD` sentinel). Use [`Dir::into_raw`] to hand the fd off,
//! [`Dir::borrow`] for a non-owning `&Dir` view of someone else's fd.

use super::*;

#[repr(transparent)]
pub struct Dir {
    pub fd: Fd,
}

impl Drop for Dir {
    #[inline]
    fn drop(&mut self) {
        if self.fd != Fd::INVALID && self.fd != Fd::cwd() {
            let _ = close(self.fd);
        }
    }
}

/// Options for `Dir::copy_file`.
#[derive(Clone, Copy, Default)]
pub struct CopyFileOptions {
    /// When set, the destination is created with this mode instead of the
    /// source file's mode.
    pub override_mode: Option<Mode>,
}

/// Options for `Dir::make_open_path`.
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
    /// Open `path` relative to cwd. `O_DIRECTORY | O_RDONLY | O_CLOEXEC`.
    #[inline]
    pub fn open(path: &[u8]) -> Maybe<Self> {
        open_dir_at(Fd::cwd(), path).map(Self::from_fd)
    }
    /// Open `path` relative to cwd with explicit flags. `O_DIRECTORY` is
    /// always added.
    #[inline]
    pub fn open_with(path: &[u8], flags: i32) -> Maybe<Self> {
        openat_a(Fd::cwd(), path, flags | O::DIRECTORY, 0).map(Self::from_fd)
    }
    /// Open `sub_path` relative to this dir.
    #[inline]
    pub fn open_at(&self, sub_path: &[u8]) -> Maybe<Self> {
        open_dir_at(self.fd, sub_path).map(Self::from_fd)
    }
    /// Open `sub_path` relative to this dir with explicit flags. `O_DIRECTORY`
    /// is always added.
    #[inline]
    pub fn open_at_with(&self, sub_path: &[u8], flags: i32) -> Maybe<Self> {
        openat_a(self.fd, sub_path, flags | O::DIRECTORY, 0).map(Self::from_fd)
    }
    /// Open `sub_path` relative to this dir as a [`File`].
    #[inline]
    pub fn open_file(&self, sub_path: &[u8], flags: i32, mode: Mode) -> Maybe<File> {
        File::openat(self.fd, sub_path, flags, mode)
    }
    /// Resolve this dir's absolute path via `/proc/self/fd` (Linux),
    /// `F_GETPATH` (macOS), or `GetFinalPathNameByHandle` (Windows).
    #[inline]
    pub fn get_fd_path<'b>(&self, buf: &'b mut bun_paths::PathBuffer) -> Maybe<&'b mut [u8]> {
        get_fd_path(self.fd, buf)
    }
    /// Close now. Equivalent to dropping `self` but discards the syscall
    /// result.
    #[inline]
    pub fn close(self) {
        drop(self);
    }
    /// Disarm the drop guard and return the raw [`Fd`]. The caller takes over
    /// the descriptor's lifecycle.
    #[inline]
    pub fn into_raw(self) -> Fd {
        core::mem::ManuallyDrop::new(self).fd
    }
    /// Non-owning `&Dir` view of an [`Fd`]. Mirrors `Path::new(&OsStr)`.
    #[inline]
    pub fn borrow(fd: &Fd) -> &Dir {
        // SAFETY: `Dir` is `#[repr(transparent)]` over `Fd`.
        unsafe { &*(core::ptr::from_ref(fd).cast::<Dir>()) }
    }

    /// `mkdir -p` relative to this dir.
    #[inline]
    pub fn make_path(&self, sub_path: &[u8]) -> Maybe<()> {
        mkdir_recursive_at(self.fd, sub_path)
    }
    /// Try opening the directory first; on ENOENT, `make_path`
    /// then open it.
    pub fn make_open_path(&self, sub_path: &[u8], _opts: OpenDirOptions) -> Maybe<Dir> {
        match open_dir_at(self.fd, sub_path) {
            Ok(fd) => Ok(Dir::from_fd(fd)),
            Err(e) if e.get_errno() == E::ENOENT => {
                mkdir_recursive_at(self.fd, sub_path)?;
                open_dir_at(self.fd, sub_path).map(Dir::from_fd)
            }
            Err(e) => Err(e),
        }
    }
    /// Recursive `rm -rf`
    /// (stack-based depth-first walk).
    pub fn delete_tree(&self, sub_path: &[u8]) -> Maybe<()> {
        // `delete_tree_open_initial_subpath` — try unlinking as a file first; if
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
        // Ensure every still-open iterator dir is closed on early return.
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
            while let Some(entry) = top.iter.next()? {
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
                                _ => return Err(e),
                            },
                        };
                        let parent = top.iter.dir();
                        // The `Vec` grows as needed, so no fixed-depth limit.
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
                                _ => return Err(e),
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
            // an error from `unlinkat_a`.
            stack.pop();
            let _ = close(dir_fd);

            let mut need_to_retry = false;
            match unlinkat_a(parent_dir, &name, AT_REMOVEDIR) {
                Ok(()) => {}
                Err(e) => match e.get_errno() {
                    E::ENOENT => {}
                    E::ENOTEMPTY => need_to_retry = true,
                    _ => return Err(e),
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
                                    _ => return Err(e2),
                                },
                            }
                        }
                        E::ENOENT => continue 'process_stack,
                        _ => return Err(e),
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

    /// Try removing
    /// `sub_path` as a file; on `EISDIR`/`EPERM` open it as an iterable
    /// directory and return the fd. Returns `None` when removal succeeded or
    /// the path doesn't exist.
    fn delete_tree_open_initial_subpath(&self, sub_path: &[u8]) -> Maybe<Option<Fd>> {
        let mut treat_as_dir = false;
        loop {
            if !treat_as_dir {
                match unlinkat_a(self.fd, sub_path, 0) {
                    Ok(()) => return Ok(None),
                    Err(e) => match e.get_errno() {
                        E::ENOENT => return Ok(None),
                        // Linux: EISDIR. POSIX: EPERM when target is a directory.
                        E::EISDIR | E::EPERM => treat_as_dir = true,
                        _ => return Err(e),
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
                        _ => Err(e),
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

/// `rmdirat` — `unlinkat(dir, path, AT_REMOVEDIR)`.
#[inline]
pub fn rmdirat(dirfd: impl AsFd, path: &ZStr) -> Maybe<()> {
    let dirfd = dirfd.as_fd();
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

/// File-creation flags — subset used by `create_file_z` callers
/// (e.g. the package-manager repository/directories code).
#[derive(Clone, Copy, Default)]
pub struct CreateFlags {
    pub truncate: bool,
    /// Open for reading as well as writing (defaults to false).
    pub read: bool,
}

impl Dir {
    /// Single-level `mkdirat` (mode 0o755) relative to
    /// this dir. Unlike `make_path`, does NOT create intermediate directories
    /// and surfaces `EEXIST` for callers to branch on.
    pub fn make_dir(&self, sub_path: &[u8]) -> core::result::Result<(), bun_errno::SystemErrno> {
        let mut buf = bun_paths::PathBuffer::default();
        let len = sub_path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&sub_path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = ZStr::from_buf(&buf.0[..], len);
        match mkdirat(self.fd, z, 0o755) {
            Ok(()) => Ok(()),
            Err(e) if e.get_errno() == E::EEXIST => Err(bun_errno::SystemErrno::EEXIST),
            Err(e) => Err(e.into()),
        }
    }

    /// `symlinkat(target, self.fd, link)`. The
    /// `is_directory` flag is a no-op on POSIX;
    /// on Windows it selects junction vs. file-symlink and
    /// callers route through `sys_uv::symlink_uv` instead.
    pub fn sym_link(&self, target: &[u8], link_name: &[u8], _is_directory: bool) -> Maybe<()> {
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

        symlinkat(tz, self.fd, lz)
    }

    /// Create (or truncate) `sub_path` relative to
    /// this dir and return a `File` handle: `O_CREAT`,
    /// `O_WRONLY` (or `O_RDWR` if `flags.read`), `O_TRUNC` if `flags.truncate`.
    pub fn create_file_z(&self, sub_path: &ZStr, flags: CreateFlags) -> Maybe<File> {
        let mut o = O::CREAT | O::CLOEXEC;
        o |= if flags.read { O::RDWR } else { O::WRONLY };
        if flags.truncate {
            o |= O::TRUNC;
        }
        let fd = openat(self.fd, sub_path, o, 0o666)?;
        Ok(File::from_fd(fd))
    }

    /// `unlinkat(self.fd, sub_path, 0)`.
    #[inline]
    pub fn delete_file_z(&self, sub_path: &ZStr) -> Maybe<()> {
        unlinkat(self.fd, sub_path)
    }

    /// Open `source_path` (relative to `self`), create
    /// `dest_path` (relative to `dest_dir`) with `O_CREAT|O_TRUNC`, then stream
    /// the contents via [`copy_file`]. Mode is taken from the source's `fstat`
    /// unless `options.override_mode` is set. No atomic-rename step —
    /// Bun's only call site is `gitignore` → `.gitignore`
    /// where atomicity isn't required.
    pub fn copy_file(
        &self,
        source_path: &[u8],
        dest_dir: &Dir,
        dest_path: &[u8],
        options: CopyFileOptions,
    ) -> Maybe<()> {
        let in_fd = openat_a(self.fd, source_path, O::RDONLY | O::CLOEXEC, 0)?;
        let mode = match options.override_mode {
            Some(m) => m,
            None => match fstat(in_fd) {
                Ok(st) => st.st_mode as Mode,
                Err(e) => {
                    let _ = close(in_fd);
                    return Err(e);
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
                return Err(e);
            }
        };
        let r = copy_file(in_fd, out_fd);
        let _ = close(in_fd);
        let _ = close(out_fd);
        r
    }

    /// Open `sub_path` (NUL-terminated) relative to
    /// this dir as a `Dir` handle: `O_DIRECTORY |
    /// O_RDONLY | O_CLOEXEC` (handled by `open_dir_at`).
    #[inline]
    pub fn open_dir_z(&self, sub_path: &ZStr) -> Maybe<Dir> {
        open_dir_at(self.fd, sub_path.as_bytes()).map(Dir::from_fd)
    }

    /// Open `sub_path` as an iterable, no-follow `Dir` handle with sub-path
    /// access.
    ///
    /// On POSIX, `iterate` / `access_sub_paths` are advisory (the handle is
    /// opened with `O_DIRECTORY | O_RDONLY | O_CLOEXEC` regardless). On Windows
    /// the flags select the access mask: `iterate` adds `FILE_LIST_DIRECTORY`,
    /// and the handle is opened **without** `read_only` so the caller may
    /// create/rename children — unlike the read-only `open_dir_*` iteration
    /// helpers.
    #[inline]
    pub fn open_dir(&self, sub_path: &[u8], opts: OpenDirOptions) -> Maybe<Dir> {
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
            open_dir_at(self.fd, sub_path).map(Dir::from_fd)
        }
    }
}

// `Fd` parity: `Fd::cwd().make_open_path(..)` / `.make_path(..)` are used by
// `bun_install` and `bun_bundler` directly on `Fd`. Extension trait so we
// don't fight with `bun_core`'s inherent impl.
pub trait FdDirExt: Copy {
    fn make_path(self, sub_path: &[u8]) -> Maybe<()>;
    fn make_open_path(self, sub_path: &[u8]) -> Maybe<Dir>;
    fn from_std_dir(dir: &Dir) -> Self;
}
impl FdDirExt for Fd {
    #[inline]
    fn make_path(self, sub_path: &[u8]) -> Maybe<()> {
        mkdir_recursive_at(self, sub_path)
    }
    #[inline]
    fn make_open_path(self, sub_path: &[u8]) -> Maybe<Dir> {
        Dir::borrow(&self).make_open_path(sub_path, OpenDirOptions::default())
    }
    #[inline]
    fn from_std_dir(dir: &Dir) -> Fd {
        dir.fd
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file::tests::FD_TEST_LOCK;

    fn open_cwd() -> Dir {
        Dir::open(b".").unwrap()
    }

    #[test]
    fn drop_closes_fd() {
        let _g = FD_TEST_LOCK.lock();
        let raw = {
            let dir = open_cwd();
            dir.fd()
        };
        assert!(fstat(raw).is_err());
    }

    #[test]
    fn close_disarms_drop() {
        let _g = FD_TEST_LOCK.lock();
        let dir = open_cwd();
        let raw = dir.fd();
        dir.close();
        let canary = open_cwd();
        assert!(fstat(canary.fd()).is_ok());
        let _ = raw;
    }

    #[test]
    fn into_raw_disarms_drop() {
        let _g = FD_TEST_LOCK.lock();
        let dir = open_cwd();
        let raw = dir.into_raw();
        // `dir` has been forgotten; the fd is still open.
        assert!(fstat(raw).is_ok());
        let _ = close(raw);
    }

    #[test]
    fn borrow_does_not_close() {
        let _g = FD_TEST_LOCK.lock();
        let dir = open_cwd();
        let raw = dir.fd();
        {
            let view = Dir::borrow(&raw);
            let _ = view;
        }
        // The borrow dropped, but the fd is still open.
        assert!(fstat(raw).is_ok());
    }

    #[test]
    fn dropping_cwd_sentinel_is_safe() {
        let _g = FD_TEST_LOCK.lock();
        // `Dir::cwd()` wraps `AT_FDCWD`. Dropping it must be a no-op — it must
        // not close fd 0 (or any other low fd that `AT_FDCWD` could collide
        // with after a wraparound).
        for _ in 0..16 {
            let _ = Dir::cwd();
        }
        // Still able to open files relative to cwd.
        assert!(Dir::cwd().open_at(b".").is_ok());
    }

    #[test]
    fn dropping_invalid_fd_is_safe() {
        let _g = FD_TEST_LOCK.lock();
        for _ in 0..16 {
            let _ = Dir::from_fd(Fd::INVALID);
        }
    }
}
