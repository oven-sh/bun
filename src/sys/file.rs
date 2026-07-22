//! `bun.sys.File` — high-level file handle.
//!
//! Owns the descriptor; closes it on Drop (skipping `Fd::INVALID` and stdio
//! so `File::stdin()`/`stdout()`/`stderr()` and default-constructed handles
//! are safe to drop). Use [`File::into_raw`] to hand the fd off,
//! [`File::borrow`] for a non-owning `&File` view of someone else's fd.
//! All methods preserve OS errno via [`crate::Maybe`].
#![allow(clippy::module_inception)]

use super::*;

#[repr(transparent)]
pub struct File {
    pub handle: Fd,
}

impl Drop for File {
    #[inline]
    fn drop(&mut self) {
        if self.handle != Fd::INVALID && !self.handle.is_stdio() {
            let _ = close(self.handle);
        }
    }
}

/// `{ bytes, err? }` pair so callers can recover the partially-read
/// buffer even on error.
#[derive(Default)]
pub struct ReadToEndResult {
    pub bytes: Vec<u8>,
    pub err: Option<Error>,
}

// `File` high-level helpers — wrap the syscall surface above.
impl File {
    // ── construction / identity ──────────────────────────────────────────
    /// Wrap an existing fd. See also the `From` impls below.
    #[inline]
    pub fn from_fd(fd: Fd) -> Self {
        Self { handle: fd }
    }
    /// The underlying [`Fd`]. Does not affect ownership.
    #[inline]
    pub fn handle(&self) -> Fd {
        self.handle
    }
    /// Alias for [`File::handle`].
    #[inline]
    pub fn fd(&self) -> Fd {
        self.handle
    }
    /// Disarm the drop guard and return the raw [`Fd`]. The caller takes over
    /// the descriptor's lifecycle.
    #[inline]
    pub fn into_raw(self) -> Fd {
        core::mem::ManuallyDrop::new(self).handle
    }
    /// Non-owning `&File` view of an [`Fd`]. Mirrors `Path::new(&OsStr)`.
    #[inline]
    pub fn borrow(fd: &Fd) -> &File {
        // SAFETY: `File` is `#[repr(transparent)]` over `Fd`.
        unsafe { &*(core::ptr::from_ref(fd).cast::<File>()) }
    }
    /// `bun.sys.File.from(.stdin())` — wrap the cached stdin fd. Do not close.
    #[inline]
    pub fn stdin() -> Self {
        Self {
            handle: Fd::stdin(),
        }
    }
    #[inline]
    pub fn stdout() -> Self {
        Self {
            handle: Fd::stdout(),
        }
    }

    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        open(path, flags, mode).map(Self::from_fd)
    }
    /// `openat` accepting a non-sentinel `&[u8]`; `&ZStr` callers
    /// deref-coerce to `&[u8]`.
    pub fn openat(dir: impl AsFd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        let dir = dir.as_fd();
        openat_a(dir, path, flags, mode).map(Self::from_fd)
    }
    /// snake_case alias for [`File::openat`].
    #[inline]
    pub fn open_at(dir: impl AsFd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        let dir = dir.as_fd();
        Self::openat(dir, path, flags, mode)
    }
    /// `openat` against cwd, auto-creating parent
    /// directories on the first failure (mkdir -p of `dirname(path)`, then
    /// retry once).
    #[inline]
    pub fn make_open(path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        Self::make_openat(Fd::cwd(), path, flags, mode)
    }
    /// `openat`; on failure, recursively create `dirname(path)` (errors from
    /// the mkdir are swallowed) then retry the open once. If `path` has no
    /// dirname, the original error is returned.
    pub fn make_openat(dir: impl AsFd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        let dir = dir.as_fd();
        match openat_a(dir, path, flags, mode) {
            Ok(fd) => Ok(Self::from_fd(fd)),
            Err(err) => {
                if let Some(dir_path) = bun_paths::dirname(path) {
                    let _ = mkdir_recursive_at(dir, dir_path);
                    return openat_a(dir, path, flags, mode).map(Self::from_fd);
                }
                Err(err)
            }
        }
    }
    /// Create a file at `path` relative to `dir`, optionally truncating.
    pub fn create(dir: impl AsFd, path: &[u8], truncate: bool) -> Maybe<Self> {
        let dir = dir.as_fd();
        let flags = O::WRONLY | O::CREAT | O::CLOEXEC | if truncate { O::TRUNC } else { 0 };
        openat_a(dir, path, flags, 0o666).map(Self::from_fd)
    }
    /// Windows wide-path variant of [`File::create`] (truncating, write-only).
    #[cfg(windows)]
    pub fn create_w(dir: impl AsFd, path: &[u16]) -> Maybe<Self> {
        let dir = dir.as_fd();
        let flags = O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC;
        openat_windows(dir, path, flags, 0o666).map(Self::from_fd)
    }
    /// `openat` accepting
    /// the platform-native NUL-terminated path type (`ZStr` POSIX / `WStr`
    /// Windows). Returns a `File` wrapper around the opened fd.
    #[inline]
    pub fn openat_os_path(
        dir: impl AsFd,
        path: &bun_paths::OSPathSliceZ,
        flags: i32,
        mode: Mode,
    ) -> Maybe<File> {
        let dir = dir.as_fd();
        openat_os_path(dir, path, flags, mode).map(|fd| File { handle: fd })
    }

    // ── read / write ─────────────────────────────────────────────────────
    pub fn read(&self, buf: &mut [u8]) -> Maybe<usize> {
        read(self.handle, buf)
    }
    pub fn write(&self, buf: &[u8]) -> Maybe<usize> {
        write(self.handle, buf)
    }
    pub fn write_all(&self, mut buf: &[u8]) -> Maybe<()> {
        while !buf.is_empty() {
            let n = write(self.handle, buf)?;
            if n == 0 {
                return Ok(());
            }
            buf = &buf[n..];
        }
        Ok(())
    }
    /// Loop `read()` into a **fixed** caller-owned slice until EOF or full.
    /// Returns total bytes read.
    pub fn read_all(&self, buf: &mut [u8]) -> Maybe<usize> {
        let mut rest = &mut *buf;
        let mut total_read: usize = 0;
        while !rest.is_empty() {
            let n = read(self.handle, rest)?;
            if n == 0 {
                break;
            }
            rest = &mut rest[n..];
            total_read += n;
        }
        Ok(total_read)
    }
    /// Growable-`Vec` variant (was previously misnamed `read_all`). Kept for
    /// callers that want cursor-relative streaming into an existing `Vec`.
    pub fn read_to_end_into(&self, buf: &mut Vec<u8>) -> Maybe<usize> {
        read_fill_vec(buf, 8192, |dst, _| read(self.handle, dst))
    }
    pub fn read_to_end(&self) -> Maybe<Vec<u8>> {
        let mut v = Vec::new();
        // fstat-presized, pread-from-0; not a cursor read.
        self.read_to_end_with_array_list(&mut v, SizeHint::UnknownSize)?;
        Ok(v)
    }
    /// Like [`File::read_to_end`] but
    /// reserves only 64 bytes initially instead of fstat-presizing; for files
    /// callers expect to be tiny (`.bun-tag`, lockfile markers, etc.).
    pub fn read_to_end_small(&self) -> Maybe<Vec<u8>> {
        let mut v = Vec::new();
        self.read_to_end_with_array_list(&mut v, SizeHint::ProbablySmall)?;
        Ok(v)
    }
    /// `File.readToEndWithArrayList(buf, hint)` — like `read_all` but takes a
    /// `SizeHint` so callers can pre-reserve. Returns total bytes appended.
    /// `ProbablySmall` reserves 64; `UnknownSize` fstats and reserves
    /// `size+16`.
    pub fn read_to_end_with_array_list(&self, list: &mut Vec<u8>, hint: SizeHint) -> Maybe<usize> {
        match hint {
            SizeHint::ProbablySmall => {
                if list.try_reserve(64).is_err() {
                    return Err(Error::oom());
                }
            }
            SizeHint::UnknownSize => {
                // `st_size` is only a hint (sparse files, racing writers, /proc):
                // reserve fallibly so an absurd size surfaces as ENOMEM to the
                // caller instead of aborting the process in `handle_alloc_error`.
                let want = self
                    .get_end_pos()?
                    .saturating_add(16)
                    .saturating_sub(list.len());
                if list.try_reserve_exact(want).is_err() {
                    return Err(Error::oom());
                }
            }
        }
        read_fill_vec(list, 16, |dst, off| {
            #[cfg(unix)]
            {
                pread(self.handle, dst, off)
            }
            #[cfg(not(unix))]
            {
                let _ = off;
                read(self.handle, dst)
            }
        })
    }
    /// Reads until
    /// `buf` is full or EOF; returns the filled prefix.
    pub fn read_fill_buf<'b>(&self, buf: &'b mut [u8]) -> Maybe<&'b mut [u8]> {
        let mut read_amount: usize = 0;
        while read_amount < buf.len() {
            // POSIX uses pread() from offset 0 so a pre-advanced cursor
            // doesn't truncate; Windows falls back to read().
            #[cfg(unix)]
            let rc = pread(self.handle, &mut buf[read_amount..], read_amount as i64);
            #[cfg(not(unix))]
            let rc = read(self.handle, &mut buf[read_amount..]);
            match rc {
                Err(err) => return Err(err),
                Ok(0) => break,
                Ok(n) => read_amount += n,
            }
        }
        Ok(&mut buf[..read_amount])
    }
    pub fn pwrite_all(&self, mut buf: &[u8], mut off: i64) -> Maybe<()> {
        while !buf.is_empty() {
            let n = pwrite(self.handle, buf, off)?;
            if n == 0 {
                return Ok(());
            }
            buf = &buf[n..];
            off += n as i64;
        }
        Ok(())
    }
    /// Loop `pread()` from `offset` until `buf` is
    /// full or EOF. Returns total bytes read (may be `< buf.len()` on EOF).
    pub fn pread_all(&self, buf: &mut [u8], offset: u64) -> Maybe<usize> {
        let mut off = offset as i64;
        let mut total: usize = 0;
        while total < buf.len() {
            let n = pread(self.handle, &mut buf[total..], off)?;
            if n == 0 {
                break;
            }
            total += n;
            off += n as i64;
        }
        Ok(total)
    }

    // ── seek / stat / kind ───────────────────────────────────────────────
    /// `lseek(SEEK_SET)`.
    #[inline]
    pub fn seek_to(&self, offset: u64) -> Maybe<()> {
        set_file_offset(self.handle, offset)
    }
    /// Current file position via `lseek(0, SEEK_CUR)`.
    /// On Windows this routes through `SetFilePointerEx(.., FILE_CURRENT)` (whence
    /// values match: `SEEK_CUR == FILE_CURRENT == 1`).
    #[inline]
    pub fn get_pos(&self) -> Maybe<u64> {
        lseek(self.handle, 0, libc::SEEK_CUR).map(|p| p as u64)
    }
    /// The file's size in bytes.
    /// On Windows that's `GetFileSizeEx` directly on the HANDLE (NOT via
    /// libuv `fstat`, which would require a uv-kind fd).
    pub fn get_end_pos(&self) -> Maybe<usize> {
        get_file_size(self.handle).map(|n| n as usize)
    }
    pub fn stat(&self) -> Maybe<Stat> {
        fstat(self.handle)
    }
    /// Be careful about using this on Linux or macOS — calls `fstat()`
    /// internally there. On Windows it routes through `GetFileType`.
    pub fn kind(&self) -> Maybe<FileKind> {
        #[cfg(windows)]
        {
            let rt = windows::GetFileType(self.handle.native());
            if rt == windows::FILE_TYPE_UNKNOWN {
                let err = windows::get_last_win32_error();
                if err != windows::Win32Error::SUCCESS {
                    return Err(Error::from_code(err.to_e(), Tag::fstat));
                }
            }
            Ok(match rt {
                windows::FILE_TYPE_CHAR => FileKind::CharacterDevice,
                windows::FILE_TYPE_REMOTE | windows::FILE_TYPE_DISK => FileKind::File,
                windows::FILE_TYPE_PIPE => FileKind::NamedPipe,
                windows::FILE_TYPE_UNKNOWN => FileKind::Unknown,
                _ => FileKind::File,
            })
        }
        #[cfg(not(windows))]
        {
            let st = self.stat()?;
            // An unrecognized `st_mode & IFMT` falls back to `File`, not
            // `Unknown`. `kind_from_mode` returns `Unknown` for that case, so
            // post-process here.
            let k = kind_from_mode(st.st_mode as Mode);
            Ok(if matches!(k, FileKind::Unknown) {
                FileKind::File
            } else {
                k
            })
        }
    }
    /// Close now. Equivalent to dropping `self` but the syscall result is
    /// observable. Skips the same sentinels as `Drop`.
    pub fn close(self) -> Maybe<()> {
        let fd = self.into_raw();
        if fd == Fd::INVALID || fd.is_stdio() {
            return Ok(());
        }
        close(fd)
    }
    /// `File.closeAndMoveTo` — atomically rename `src` → `dest` (cwd-relative),
    /// closing the handle after the rename so `move_file_z_with_handle`'s
    /// EXDEV fallback (fstat/lseek/copy on `from_handle`) sees a live handle.
    /// (On Windows the rename goes through `rename_at_w` →
    /// `NtSetInformationFile`, which opens its own source handle, so keeping
    /// `self` open across the call is fine and avoids passing a closed handle
    /// into the EXDEV fallback.)
    pub fn close_and_move_to(self, src: &ZStr, dest: &ZStr) -> Maybe<()> {
        let cwd = Fd::cwd();
        let result = move_file_z_with_handle(self.handle, cwd, src, cwd, dest);
        let _ = self.close(); // close error is non-actionable; discarded
        result
    }
    /// `bun.sys.File.getPath` — `getFdPath(self.handle, buf)`.
    #[inline]
    pub fn get_path<'a>(&self, buf: &'a mut bun_paths::PathBuffer) -> Maybe<&'a [u8]> {
        get_fd_path(self.handle, buf).map(|s| &*s)
    }

    // ── one-shot path helpers (open + io + close) ───────────────────────
    /// Open + read + close. Accepts `&[u8]`; `&ZStr` callers deref-coerce.
    pub fn read_from(dir: impl AsFd, path: &[u8]) -> Maybe<Vec<u8>> {
        let dir = dir.as_fd();
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        // `Drop` closes the fd on all paths (no leak on read failure).
        f.read_to_end()
    }
    /// Open + read; returns BOTH
    /// the open `File` handle and the bytes. Caller owns the fd and must
    /// `close()` it. On read error the fd is closed before returning (no leak).
    pub fn read_file_from(dir: impl AsFd, path: &[u8]) -> Maybe<(Self, Vec<u8>)> {
        let dir = dir.as_fd();
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        match f.read_to_end() {
            Ok(bytes) => Ok((f, bytes)),
            // The fd escapes only on success; `Drop` closes it here.
            Err(e) => Err(e),
        }
    }
    /// Normalize a
    /// user-provided relative path against the resolver's cached
    /// `top_level_dir` (NOT a fresh `getcwd()`), then `readFrom`.
    ///
    /// The cached `top_level_dir` lives in `bun_resolver::fs` (T5), which
    /// `bun_sys` (T1) must not depend on, so callers pass it explicitly.
    pub fn read_from_user_input(
        dir: impl AsFd,
        top_level_dir: &[u8],
        input_path: &[u8],
    ) -> Maybe<Vec<u8>> {
        let dir = dir.as_fd();
        let mut buf = bun_paths::PathBuffer::default();
        let normalized = bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Loose>(
            top_level_dir,
            &mut buf.0,
            &[input_path],
        );
        Self::read_from(dir, normalized.as_bytes())
    }
    /// `bun.sys.File.writeFile` — open + write + close.
    pub fn write_file(dir: impl AsFd, path: &ZStr, data: &[u8]) -> Maybe<()> {
        let dir = dir.as_fd();
        // `Drop` closes the fd on all paths.
        let f = Self::openat(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
        f.write_all(data)
    }
    /// Like [`File::write_file`] but takes the platform-native path type so Windows
    /// callers can pass a `&WStr` without round-tripping through UTF-8.
    pub fn write_file_os_path(
        dir: impl AsFd,
        path: &bun_paths::OSPathSliceZ,
        data: &[u8],
    ) -> Maybe<()> {
        let dir = dir.as_fd();
        let file = File::openat_os_path(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
        file.write_all(data)
    }

    // ── std::io adapters ─────────────────────────────────────────────────
    /// Buffered writer (`std::io::BufWriter`) wrapping this fd.
    pub fn buffered_writer(&self) -> std::io::BufWriter<FileWriter> {
        std::io::BufWriter::new(FileWriter(self.handle))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Serialize fd-touching tests: `cargo test` runs `#[test]` fns as
    /// threads in one process; a sibling test's `open()` between a `Drop`
    /// close and the `fstat` assertion could be allocated the just-closed fd
    /// (POSIX lowest-fd guarantee), making the assertion spuriously fail.
    pub(crate) static FD_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn open_cwd() -> File {
        File::open(ZStr::from_static(b".\0"), O::RDONLY, 0).unwrap()
    }

    #[test]
    fn drop_closes_fd() {
        let _g = FD_TEST_LOCK.lock();
        let raw = {
            let f = open_cwd();
            f.fd()
        };
        assert!(fstat(raw).is_err());
    }

    #[test]
    fn close_disarms_drop() {
        let _g = FD_TEST_LOCK.lock();
        let f = open_cwd();
        f.close().unwrap();
    }

    #[test]
    fn close_skips_invalid_sentinel() {
        let _g = FD_TEST_LOCK.lock();
        // `File::close()` must not call the syscall on `Fd::INVALID`.
        let f = File::from_fd(Fd::INVALID);
        assert!(f.close().is_ok());
    }

    #[test]
    fn into_raw_disarms_drop() {
        let _g = FD_TEST_LOCK.lock();
        let f = open_cwd();
        let raw = f.into_raw();
        assert!(fstat(raw).is_ok());
        let _ = close(raw);
    }

    #[test]
    fn borrow_does_not_close() {
        let _g = FD_TEST_LOCK.lock();
        let f = open_cwd();
        let raw = f.fd();
        {
            let view = File::borrow(&raw);
            let _ = view;
        }
        assert!(fstat(raw).is_ok());
    }

    #[test]
    fn dropping_stdio_is_safe() {
        let _g = FD_TEST_LOCK.lock();
        // `File::stdin()` / `stdout()` wrap process-shared descriptors that the
        // caller does not own. Dropping the wrapper must not tear down the test
        // harness's output.
        for _ in 0..16 {
            let _ = File::stdin();
            let _ = File::stdout();
        }
        assert!(fstat(Fd::stdout()).is_ok());
    }

    #[test]
    fn dropping_invalid_fd_is_safe() {
        let _g = FD_TEST_LOCK.lock();
        for _ in 0..16 {
            let _ = File::from_fd(Fd::INVALID);
        }
    }
}
