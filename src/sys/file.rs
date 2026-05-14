//! `bun.sys.File` — high-level file handle. Port of `src/sys/File.zig`.
//!
//! Thin `#[repr(transparent)]` wrapper over [`crate::Fd`]. Unlike `std::fs::File`,
//! this is `Copy` and **does not close on Drop** — callers must `.close()`
//! explicitly (matching Zig). All methods preserve OS errno via [`crate::Maybe`].
#![allow(clippy::module_inception)]

use super::*;

#[repr(transparent)]
pub struct File {
    pub handle: Fd,
}

/// Port of `bun.sys.File.ReadToEndResult` — `{ bytes, err? }` pair so
/// callers can recover the partially-read buffer even on error (Zig
/// returns the buffer regardless and tags `.err`).
#[derive(Default)]
pub struct ReadToEndResult {
    pub bytes: Vec<u8>,
    pub err: Option<Error>,
}
impl ReadToEndResult {
    #[inline]
    pub fn unwrap(self) -> core::result::Result<Vec<u8>, Error> {
        match self.err {
            Some(e) => Err(e),
            None => Ok(self.bytes),
        }
    }
}

// `File` high-level helpers — wrap the syscall surface above.
// Single consolidated `impl` block (Zig: src/sys/File.zig).
impl File {
    // ── construction / identity ──────────────────────────────────────────
    /// `File.from(fd)` — wrap an existing fd. Zig's `from(anytype)` overload
    /// set collapses to this + the `From` impls below in Rust.
    #[inline]
    pub fn from_fd(fd: Fd) -> Self {
        Self { handle: fd }
    }
    #[inline]
    pub fn handle(&self) -> Fd {
        self.handle
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
    #[inline]
    pub fn stderr() -> Self {
        Self {
            handle: Fd::stderr(),
        }
    }

    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        open(path, flags, mode).map(Self::from_fd)
    }
    /// File.zig `openat` — accepts a non-sentinel `&[u8]` (Zig: `path: anytype`
    /// dispatches to `openatA` for non-sentinel slices). `&ZStr` callers
    /// deref-coerce to `&[u8]`.
    pub fn openat(dir: Fd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        openat_a(dir, path, flags, mode).map(Self::from_fd)
    }
    /// snake_case alias (Zig: `File.openat`).
    #[inline]
    pub fn open_at(dir: Fd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        Self::openat(dir, path, flags, mode)
    }
    /// File.zig `makeOpen` — `openat` against cwd, auto-creating parent
    /// directories on the first failure (mkdir -p of `dirname(path)`, then
    /// retry once).
    #[inline]
    pub fn make_open(path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
        Self::make_openat(Fd::cwd(), path, flags, mode)
    }
    /// File.zig `makeOpenat` — `openat`; on failure, `bun.makePath(dir, dirname(path))`
    /// (errors from `makePath` are swallowed, matching `catch {}` in Zig) then
    /// retry the open once. If `path` has no dirname, the original error is
    /// returned.
    pub fn make_openat(dir: Fd, path: &[u8], flags: i32, mode: Mode) -> Maybe<Self> {
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
    /// `std.fs.cwd().createFile(path, .{ .truncate })` replacement.
    pub fn create(dir: Fd, path: &[u8], truncate: bool) -> Maybe<Self> {
        let flags = O::WRONLY | O::CREAT | O::CLOEXEC | if truncate { O::TRUNC } else { 0 };
        openat_a(dir, path, flags, 0o666).map(Self::from_fd)
    }
    /// `std.fs.cwd().createFileW(path, .{})` replacement (Windows wide-path).
    /// Default `.{}` in Zig means `.truncate = true, .read = false`.
    #[cfg(windows)]
    pub fn create_w(dir: Fd, path: &[u16]) -> Maybe<Self> {
        let flags = O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC;
        openat_windows(dir, path, flags, 0o666).map(Self::from_fd)
    }
    /// Port of `bun.sys.File.openatOSPath` (File.zig:65) — `openat` accepting
    /// the platform-native NUL-terminated path type (`ZStr` POSIX / `WStr`
    /// Windows). Returns a `File` wrapper around the opened fd.
    #[inline]
    pub fn openat_os_path(
        dir: Fd,
        path: &bun_paths::OSPathSliceZ,
        flags: i32,
        mode: Mode,
    ) -> Maybe<File> {
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
            // File.zig:118-133 — `if (amt == 0) return .success;` (matches Zig).
            if n == 0 {
                return Ok(());
            }
            buf = &buf[n..];
        }
        Ok(())
    }
    /// `File.readAll(buf: []u8)` — loop `read()` into a **fixed** caller-owned
    /// slice until EOF or full. Returns total bytes read (sys.zig `readAll`).
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
        // File.zig `readToEnd` — fstat-presized, pread-from-0; not a cursor read.
        self.read_to_end_with_array_list(&mut v, SizeHint::UnknownSize)?;
        Ok(v)
    }
    /// File.zig `readToEndSmall` — `readToEndWithArrayList(.probably_small)`.
    /// Reserves only 64 bytes initially instead of fstat-presizing; for files
    /// callers expect to be tiny (`.bun-tag`, lockfile markers, etc.).
    pub fn read_to_end_small(&self) -> Maybe<Vec<u8>> {
        let mut v = Vec::new();
        self.read_to_end_with_array_list(&mut v, SizeHint::ProbablySmall)?;
        Ok(v)
    }
    /// `File.readToEndWithArrayList(buf, hint)` — like `read_all` but takes a
    /// `SizeHint` so callers can pre-reserve. Returns total bytes appended.
    /// File.zig:298 — `probably_small` reserves 64; `unknown_size` fstats and
    /// reserves `size+16`.
    pub fn read_to_end_with_array_list(&self, list: &mut Vec<u8>, hint: SizeHint) -> Maybe<usize> {
        match hint {
            SizeHint::ProbablySmall => list.reserve(64),
            SizeHint::UnknownSize => {
                list.reserve_exact((self.get_end_pos()? + 16).saturating_sub(list.len()));
            }
        }
        read_fill_vec(list, 16, |dst, off| {
            #[cfg(unix)]
            {
                pread(self.handle, dst, off)
            }
            #[cfg(not(unix))]
            {
                read(self.handle, dst)
            }
        })
    }
    /// Port of `bun.sys.File.readFillBuf` (src/sys/File.zig). Reads until
    /// `buf` is full or EOF; returns the filled prefix.
    pub fn read_fill_buf<'b>(&self, buf: &'b mut [u8]) -> Maybe<&'b mut [u8]> {
        let mut read_amount: usize = 0;
        while read_amount < buf.len() {
            // PORT NOTE: File.zig:278 — POSIX uses pread() from offset 0 so a
            // pre-advanced cursor doesn't truncate; Windows falls back to read().
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
    /// `std.fs.File.preadAll` — loop `pread()` from `offset` until `buf` is
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
    /// `std.fs.File.seekTo` — `lseek(SEEK_SET)`.
    #[inline]
    pub fn seek_to(&self, offset: u64) -> Maybe<()> {
        set_file_offset(self.handle, offset)
    }
    /// `std.fs.File.getPos` — current file position via `lseek(0, SEEK_CUR)`.
    /// On Windows this routes through `SetFilePointerEx(.., FILE_CURRENT)` (whence
    /// values match: `SEEK_CUR == FILE_CURRENT == 1`).
    #[inline]
    pub fn get_pos(&self) -> Maybe<u64> {
        lseek(self.handle, 0, libc::SEEK_CUR).map(|p| p as u64)
    }
    /// `File.getEndPos()` (File.zig:209) — `getFileSize(self.handle)`.
    /// On Windows that's `GetFileSizeEx` directly on the HANDLE (NOT via
    /// libuv `fstat`, which would require a uv-kind fd).
    pub fn get_end_pos(&self) -> Maybe<usize> {
        get_file_size(self.handle).map(|n| n as usize)
    }
    pub fn stat(&self) -> Maybe<Stat> {
        fstat(self.handle)
    }
    /// Port of `bun.sys.File.kind` (File.zig:220).
    ///
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
            // Zig spec (File.zig:258): unrecognized `st_mode & IFMT` falls back to
            // `.file`, not `.unknown`. `kind_from_mode` returns `Unknown` for that
            // case, so post-process here to match the spec's else arm.
            let k = kind_from_mode(st.st_mode as Mode);
            Ok(if matches!(k, FileKind::Unknown) {
                FileKind::File
            } else {
                k
            })
        }
    }
    pub fn close(self) -> Maybe<()> {
        close(self.handle)
    }
    /// `File.closeAndMoveTo` — atomically rename `src` → `dest` (cwd-relative),
    /// closing the handle after the rename so `move_file_z_with_handle`'s
    /// EXDEV fallback (fstat/lseek/copy on `from_handle`) sees a live handle.
    /// (Zig closes first on Windows because its rename uses `MoveFileExW`; the
    /// Rust port goes through `rename_at_w` → `NtSetInformationFile` which
    /// opens its own source handle, so keeping `self` open across the call is
    /// fine and avoids passing a closed handle into the EXDEV fallback.)
    pub fn close_and_move_to(
        self,
        src: &ZStr,
        dest: &ZStr,
    ) -> core::result::Result<(), bun_core::Error> {
        let cwd = Fd::cwd();
        let result = move_file_z_with_handle(self.handle, cwd, src, cwd, dest);
        let _ = self.close(); // close error is non-actionable (Zig parity: discarded)
        result
    }
    /// `bun.sys.File.getPath` — `getFdPath(self.handle, buf)`.
    #[inline]
    pub fn get_path<'a>(
        &self,
        buf: &'a mut bun_paths::PathBuffer,
    ) -> core::result::Result<&'a [u8], bun_core::Error> {
        get_fd_path(self.handle, buf)
            .map(|s| &*s)
            .map_err(Into::into)
    }

    // ── one-shot path helpers (open + io + close) ───────────────────────
    /// `bun.sys.File.readFrom` — open + read + close. Accepts `&[u8]` (Zig:
    /// `path: anytype`); `&ZStr` callers deref-coerce.
    pub fn read_from(dir: Fd, path: &[u8]) -> Maybe<Vec<u8>> {
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        // File.zig: closes the fd on the error path too (no leak on read failure).
        let v = f.read_to_end();
        let _ = close(f.handle);
        v
    }
    /// `bun.sys.File.readFileFrom` (File.zig:381) — open + read; returns BOTH
    /// the open `File` handle and the bytes. Caller owns the fd and must
    /// `close()` it. On read error the fd is closed before returning (no leak).
    pub fn read_file_from(
        dir: Fd,
        path: &[u8],
    ) -> core::result::Result<(Self, Vec<u8>), bun_core::Error> {
        let f = Self::openat(dir, path, O::RDONLY, 0).map_err(Into::<bun_core::Error>::into)?;
        match f.read_to_end() {
            Ok(bytes) => Ok((f, bytes)),
            Err(e) => {
                let _ = close(f.handle);
                Err(e.into())
            }
        }
    }
    /// `bun.sys.File.readFromUserInput` (File.zig:367) — normalize a
    /// user-provided relative path against the resolver's cached
    /// `top_level_dir` (NOT a fresh `getcwd()`), then `readFrom`.
    ///
    /// Zig reads `bun.fs.FileSystem.instance.top_level_dir` directly; in the
    /// Rust crate map that lives in `bun_resolver::fs` (T5) which `bun_sys`
    /// (T1) must not depend on (PORTING.md §Forbidden: no fn-ptr hooks to
    /// break dep cycles). Callers pass `top_level_dir` explicitly instead.
    pub fn read_from_user_input(
        dir: Fd,
        top_level_dir: &[u8],
        input_path: &[u8],
    ) -> Maybe<Vec<u8>> {
        let mut buf = bun_paths::PathBuffer::default();
        let normalized = bun_paths::resolve_path::join_abs_string_buf_z::<bun_paths::platform::Loose>(
            top_level_dir,
            &mut buf.0,
            &[input_path],
        );
        Self::read_from(dir, normalized.as_bytes())
    }
    /// `bun.sys.File.writeFile` — open + write + close.
    pub fn write_file(dir: Fd, path: &ZStr, data: &[u8]) -> Maybe<()> {
        // File.zig:141 — mode 0o664; `defer file.close()` (close on all paths).
        let f = Self::openat(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
        let r = f.write_all(data);
        let _ = close(f.handle);
        r
    }
    /// Port of `bun.sys.File.writeFileWithPathBuffer` (File.zig) Windows arm —
    /// like [`write_file`] but takes the platform-native path type so Windows
    /// callers can pass a `&WStr` without round-tripping through UTF-8.
    pub fn write_file_os_path(dir: Fd, path: &bun_paths::OSPathSliceZ, data: &[u8]) -> Maybe<()> {
        let file = File::openat_os_path(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
        let result = file.write_all(data);
        let _ = close(file.handle);
        result
    }

    // ── std::io adapters ─────────────────────────────────────────────────
    /// `File.writer()` — `std.Io.GenericWriter(File, anyerror, stdIoWrite)`.
    #[inline]
    pub fn writer(&self) -> FileWriter {
        FileWriter(self.handle)
    }
    /// `File.reader()` — `std.Io.GenericReader(File, anyerror, stdIoRead)`.
    #[inline]
    pub fn reader(&self) -> FileReader {
        FileReader(self.handle)
    }
    /// `File.bufferedWriter()` — `std.io.BufferedWriter` wrapping this fd.
    pub fn buffered_writer(&self) -> std::io::BufWriter<FileWriter> {
        std::io::BufWriter::new(FileWriter(self.handle))
    }
}
