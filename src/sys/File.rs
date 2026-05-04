//! This is a similar API to std.fs.File, except it:
//! - Preserves errors from the operating system
//! - Supports normalizing BOM to UTF-8
//! - Has several optimizations somewhat specific to Bun
//! - Potentially goes through libuv on Windows
//! - Does not use unreachable in system calls.

use core::ffi::c_int;

use bun_paths::PathBuffer;
use bun_str::ZStr;

use crate::{
    self as sys, Error as SysError, Fd, Mode, Result as SysResult, Stat, SystemErrno, O,
};
// TODO(port): OsPathZ is the cfg-dependent NUL-terminated OS path slice
// (`&ZStr` on POSIX, `&WStr` on Windows). Confirm exact name/location in Phase B.
use bun_paths::OsPathZ;

#[cfg(windows)]
use crate::windows;

/// "handle" matches std.fs.File
#[derive(Clone, Copy)]
pub struct File {
    pub handle: Fd,
}

impl File {
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> SysResult<File> {
        match sys::openat(dir, path, flags, mode) {
            SysResult::Ok(fd) => SysResult::Ok(File { handle: fd }),
            SysResult::Err(err) => SysResult::Err(err),
        }
    }

    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> SysResult<File> {
        File::openat(Fd::cwd(), path, flags, mode)
    }

    pub fn make_open(path: &ZStr, flags: i32, mode: Mode) -> SysResult<File> {
        File::make_openat(Fd::cwd(), path, flags, mode)
    }

    pub fn make_openat(other: Fd, path: &ZStr, flags: i32, mode: Mode) -> SysResult<File> {
        let fd = match sys::openat(other, path, flags, mode) {
            SysResult::Ok(fd) => fd,
            SysResult::Err(err) => 'fd: {
                if let Some(dir_path) = bun_paths::dirname(path.as_bytes()) {
                    // TODO(port): bun.makePath(other.stdDir(), dir_path) — confirm bun_sys::make_path signature
                    let _ = sys::make_path(other, dir_path);
                    break 'fd match sys::openat(other, path, flags, mode) {
                        SysResult::Ok(fd) => fd,
                        SysResult::Err(err2) => return SysResult::Err(err2),
                    };
                }

                return SysResult::Err(err);
            }
        };

        SysResult::Ok(File { handle: fd })
    }

    pub fn openat_os_path(other: Fd, path: &OsPathZ, flags: i32, mode: Mode) -> SysResult<File> {
        match sys::openat_os_path(other, path, flags, mode) {
            SysResult::Ok(fd) => SysResult::Ok(File { handle: fd }),
            SysResult::Err(err) => SysResult::Err(err),
        }
    }

    pub fn from<T: Into<File>>(other: T) -> File {
        other.into()
    }

    pub fn write(self, buf: &[u8]) -> SysResult<usize> {
        sys::write(self.handle, buf)
    }

    pub fn read(self, buf: &mut [u8]) -> SysResult<usize> {
        sys::read(self.handle, buf)
    }

    pub fn read_all(self, buf: &mut [u8]) -> SysResult<usize> {
        sys::read_all(self.handle, buf)
    }

    pub fn pwrite_all(self, buf: &[u8], initial_offset: i64) -> SysResult<()> {
        let mut remain = buf;
        let mut offset = initial_offset;
        while !remain.is_empty() {
            let rc = sys::pwrite(self.handle, remain, offset);
            match rc {
                SysResult::Err(err) => return SysResult::Err(err),
                SysResult::Ok(amt) => {
                    if amt == 0 {
                        return SysResult::Ok(());
                    }
                    remain = &remain[amt..];
                    offset += i64::try_from(amt).unwrap();
                }
            }
        }

        SysResult::Ok(())
    }

    pub fn write_all(self, buf: &[u8]) -> SysResult<()> {
        let mut remain = buf;
        while !remain.is_empty() {
            let rc = sys::write(self.handle, remain);
            match rc {
                SysResult::Err(err) => return SysResult::Err(err),
                SysResult::Ok(amt) => {
                    if amt == 0 {
                        return SysResult::Ok(());
                    }
                    remain = &remain[amt..];
                }
            }
        }

        SysResult::Ok(())
    }

    pub fn write_file(
        relative_dir_or_cwd: impl Into<File>,
        path: &OsPathZ,
        data: &[u8],
    ) -> SysResult<()> {
        let file = match File::openat_os_path(
            File::from(relative_dir_or_cwd).handle,
            path,
            O::WRONLY | O::CREAT | O::TRUNC,
            0o664,
        ) {
            SysResult::Err(err) => return SysResult::Err(err),
            SysResult::Ok(fd) => fd,
        };
        // PORT NOTE: `defer file.close()` — close after write regardless of result.
        let result = file.write_all(data);
        file.close();
        match result {
            SysResult::Err(err) => return SysResult::Err(err),
            SysResult::Ok(()) => {}
        }
        SysResult::Ok(())
    }

    pub fn close_and_move_to(self, src: &ZStr, dest: &ZStr) -> Result<(), bun_core::Error> {
        // On Windows, close the file before moving it.
        #[cfg(windows)]
        self.close();
        let cwd = Fd::cwd();
        // TODO(port): narrow error set
        let result = sys::move_file_z_with_handle(self.handle, cwd, src, cwd, dest);
        // On POSIX, close the file after moving it.
        #[cfg(unix)]
        self.close();
        result
    }

    fn std_io_read(self, buf: &mut [u8]) -> Result<usize, ReadError> {
        self.read(buf).unwrap()
    }

    pub fn reader(self) -> Reader {
        Reader { context: self }
    }

    fn std_io_write(self, bytes: &[u8]) -> Result<usize, WriteError> {
        self.write_all(bytes).unwrap()?;
        Ok(bytes.len())
    }

    fn std_io_write_quiet_debug(self, bytes: &[u8]) -> Result<usize, WriteError> {
        bun_core::Output::disable_scoped_debug_writer();
        // PORT NOTE: `defer enableScopedDebugWriter()` — RAII guard would be cleaner in Phase B.
        let result = self.write_all(bytes).unwrap();
        bun_core::Output::enable_scoped_debug_writer();
        result?;
        Ok(bytes.len())
    }

    pub fn writer(self) -> Writer {
        Writer { context: self }
    }

    pub fn quiet_writer(self) -> QuietWriter {
        QuietWriter { context: self }
    }

    pub fn is_tty(self) -> bool {
        // TODO(port): std.posix.isatty — confirm bun_sys::isatty signature
        sys::isatty(self.handle.cast())
    }

    /// Asserts in debug that this File object is valid
    pub fn close(self) {
        self.handle.close();
    }

    pub fn get_end_pos(self) -> SysResult<usize> {
        sys::get_file_size(self.handle)
    }

    pub fn stat(self) -> SysResult<Stat> {
        sys::fstat(self.handle)
    }

    /// Be careful about using this on Linux or macOS.
    ///
    /// File calls stat() internally.
    pub fn kind(self) -> SysResult<FileKind> {
        #[cfg(windows)]
        {
            let rt = windows::GetFileType(self.handle.cast());
            if rt == windows::FILE_TYPE_UNKNOWN {
                match windows::GetLastError() {
                    windows::ERROR_SUCCESS => {}
                    err => {
                        return SysResult::Err(SysError::from_code(
                            SystemErrno::init(err).unwrap_or(SystemErrno::EUNKNOWN).to_e(),
                            sys::Tag::fstat,
                        ));
                    }
                }
            }

            return SysResult::Ok(match rt {
                windows::FILE_TYPE_CHAR => FileKind::CharacterDevice,
                windows::FILE_TYPE_REMOTE | windows::FILE_TYPE_DISK => FileKind::File,
                windows::FILE_TYPE_PIPE => FileKind::NamedPipe,
                windows::FILE_TYPE_UNKNOWN => FileKind::Unknown,
                _ => FileKind::File,
            });
        }

        #[cfg(not(windows))]
        {
            let st = match self.stat() {
                SysResult::Err(err) => return SysResult::Err(err),
                SysResult::Ok(s) => s,
            };

            let m = st.mode & sys::S::IFMT;
            match m {
                sys::S::IFBLK => SysResult::Ok(FileKind::BlockDevice),
                sys::S::IFCHR => SysResult::Ok(FileKind::CharacterDevice),
                sys::S::IFDIR => SysResult::Ok(FileKind::Directory),
                sys::S::IFIFO => SysResult::Ok(FileKind::NamedPipe),
                sys::S::IFLNK => SysResult::Ok(FileKind::SymLink),
                sys::S::IFREG => SysResult::Ok(FileKind::File),
                sys::S::IFSOCK => SysResult::Ok(FileKind::UnixDomainSocket),
                _ => SysResult::Ok(FileKind::File),
            }
        }
    }

    pub fn read_fill_buf(self, buf: &mut [u8]) -> SysResult<&mut [u8]> {
        let mut read_amount: usize = 0;
        while read_amount < buf.len() {
            #[cfg(unix)]
            let rc = sys::pread(
                self.handle,
                &mut buf[read_amount..],
                i64::try_from(read_amount).unwrap(),
            );
            #[cfg(not(unix))]
            let rc = sys::read(self.handle, &mut buf[read_amount..]);

            match rc {
                SysResult::Err(err) => {
                    return SysResult::Err(err);
                }
                SysResult::Ok(bytes_read) => {
                    if bytes_read == 0 {
                        break;
                    }

                    read_amount += bytes_read;
                }
            }
        }

        SysResult::Ok(&mut buf[0..read_amount])
    }

    pub fn read_to_end_with_array_list(
        self,
        list: &mut Vec<u8>,
        size_guess: SizeGuess,
    ) -> SysResult<usize> {
        if size_guess == SizeGuess::ProbablySmall {
            list.reserve(64);
        } else {
            let size = match self.get_end_pos() {
                SysResult::Err(err) => {
                    return SysResult::Err(err);
                }
                SysResult::Ok(s) => s,
            };
            list.reserve_exact((size + 16).saturating_sub(list.len()));
        }

        let mut total: i64 = 0;
        loop {
            if list.spare_capacity_mut().is_empty() {
                list.reserve(16);
            }

            // SAFETY: u8 has no invalid bit patterns; the read syscall only writes
            // initialized bytes into this region, and we set_len to exactly the
            // number of bytes written below.
            let spare = unsafe {
                let s = list.spare_capacity_mut();
                core::slice::from_raw_parts_mut(s.as_mut_ptr().cast::<u8>(), s.len())
            };

            #[cfg(unix)]
            let rc = sys::pread(self.handle, spare, total);
            #[cfg(not(unix))]
            let rc = sys::read(self.handle, spare);

            match rc {
                SysResult::Err(err) => {
                    return SysResult::Err(err);
                }
                SysResult::Ok(bytes_read) => {
                    if bytes_read == 0 {
                        break;
                    }

                    // SAFETY: bytes_read <= spare.len() <= capacity - len, and the
                    // syscall initialized those bytes.
                    unsafe { list.set_len(list.len() + bytes_read) };
                    total += i64::try_from(bytes_read).unwrap();
                }
            }
        }

        SysResult::Ok(usize::try_from(total).unwrap())
    }

    /// Use this function on potentially large files.
    /// Calls fstat() on the file to get the size of the file and avoids reallocations + extra read() calls.
    pub fn read_to_end(self) -> ReadToEndResult {
        let mut list = Vec::<u8>::new();
        match self.read_to_end_with_array_list(&mut list, SizeGuess::UnknownSize) {
            SysResult::Err(err) => ReadToEndResult { err: Some(err), bytes: list },
            SysResult::Ok(_) => ReadToEndResult { err: None, bytes: list },
        }
    }

    /// Use this function on small files <= 1024 bytes.
    /// File will skip the fstat() call, preallocating 64 bytes instead of the file's size.
    pub fn read_to_end_small(self) -> ReadToEndResult {
        let mut list = Vec::<u8>::new();
        match self.read_to_end_with_array_list(&mut list, SizeGuess::ProbablySmall) {
            SysResult::Err(err) => ReadToEndResult { err: Some(err), bytes: list },
            SysResult::Ok(_) => ReadToEndResult { err: None, bytes: list },
        }
    }

    pub fn get_path<'a>(self, out_buffer: &'a mut PathBuffer) -> SysResult<&'a mut [u8]> {
        sys::get_fd_path(self.handle, out_buffer)
    }

    /// 1. Normalize the file path
    /// 2. Open a file for reading
    /// 2. Read the file to a buffer
    /// 3. Return the File handle and the buffer
    pub fn read_from_user_input(
        dir_fd: impl Into<File>,
        input_path: &[u8],
    ) -> SysResult<Vec<u8>> {
        let mut buf = PathBuffer::uninit();
        // TODO(port): bun.fs.FileSystem.instance.top_level_dir — confirm bun_fs accessor
        let normalized = bun_paths::join_abs_string_buf_z(
            bun_fs::FileSystem::instance().top_level_dir(),
            &mut buf,
            &[input_path],
            bun_paths::Platform::Loose,
        );
        Self::read_from(dir_fd, normalized)
    }

    /// 1. Open a file for reading
    /// 2. Read the file to a buffer
    /// 3. Return the File handle and the buffer
    // TODO(port): Zig `path: anytype` dispatched on element type (u8 vs u16) and
    // sentinel presence to choose openat / openatA / openatWindowsTMaybeNormalize.
    // Phase B should add overloads or a sealed trait for `&ZStr` / `&[u8]` / `&WStr`.
    pub fn read_file_from(
        dir_fd: impl Into<File>,
        path: &ZStr,
    ) -> SysResult<(File, Vec<u8>)> {
        let rc = 'brk: {
            #[cfg(windows)]
            {
                // TODO(port): u16 path branch:
                // openatWindowsTMaybeNormalize(u16, from(dir_fd).handle, path, O.RDONLY, false)
            }

            // TODO(port): non-sentinel u8 branch → sys::openat_a(...)

            break 'brk sys::openat(File::from(dir_fd).handle, path, O::RDONLY, 0);
        };

        let this = match rc {
            SysResult::Err(err) => return SysResult::Err(err),
            SysResult::Ok(fd) => File::from(fd),
        };

        let mut result = this.read_to_end();

        if let Some(err) = result.err {
            this.close();
            drop(result.bytes);
            return SysResult::Err(err);
        }

        if result.bytes.is_empty() {
            // Don't allocate an empty string.
            // We won't be modifying an empty slice, anyway.
            return SysResult::Ok((this, Vec::new()));
        }

        SysResult::Ok((this, result.bytes))
    }

    /// 1. Open a file for reading relative to a directory
    /// 2. Read the file to a buffer
    /// 3. Close the file
    /// 4. Return the buffer
    pub fn read_from(dir_fd: impl Into<File>, path: &ZStr) -> SysResult<Vec<u8>> {
        let (file, bytes) = match Self::read_file_from(dir_fd, path) {
            SysResult::Err(err) => return SysResult::Err(err),
            SysResult::Ok(result) => result,
        };

        file.close();
        SysResult::Ok(bytes)
    }

    pub fn to_source_at(
        dir_fd: impl Into<File>,
        path: &ZStr,
        opts: ToSourceOptions,
    ) -> SysResult<bun_logger::Source> {
        let mut bytes = match Self::read_from(dir_fd, path) {
            SysResult::Err(err) => return SysResult::Err(err),
            SysResult::Ok(bytes) => bytes,
        };

        if opts.convert_bom {
            if let Some(bom) = bun_str::strings::Bom::detect(&bytes) {
                bytes = bom.remove_and_convert_to_utf8_and_free(bytes);
            }
        }

        SysResult::Ok(bun_logger::Source::init_path_string(path.as_bytes(), bytes))
    }

    pub fn to_source(path: &ZStr, opts: ToSourceOptions) -> SysResult<bun_logger::Source> {
        Self::to_source_at(Fd::cwd(), path, opts)
    }
}

// `from(other: anytype)` — Zig dispatched on @TypeOf at comptime. Port as From impls.
impl From<Fd> for File {
    fn from(other: Fd) -> File {
        File { handle: other }
    }
}

// TODO(port): Zig also accepted std.posix.fd_t, std.fs.File, std.fs.Dir, and (on Linux) u64.
// std::fs is banned in this port; native fd_t conversion lives on Fd::from_native.
#[cfg(target_os = "linux")]
impl From<u64> for File {
    fn from(other: u64) -> File {
        File { handle: Fd::from_native(c_int::try_from(other).unwrap()) }
    }
}

pub type ReadError = bun_core::Error;
pub type WriteError = bun_core::Error;

// TODO(port): Zig used std.Io.GenericReader/GenericWriter wrappers. The Rust
// equivalent is implementing std::io::Read / std::io::Write. Phase B may want
// these on `File` directly instead of newtype wrappers.
pub struct Reader {
    pub context: File,
}

impl std::io::Read for Reader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.context
            .std_io_read(buf)
            .map_err(|e| std::io::Error::other(e.name()))
    }
}

pub struct Writer {
    pub context: File,
}

impl std::io::Write for Writer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.context
            .std_io_write(bytes)
            .map_err(|e| std::io::Error::other(e.name()))
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(debug_assertions)]
pub struct QuietWriter {
    pub context: File,
}
#[cfg(not(debug_assertions))]
pub type QuietWriter = Writer;

#[cfg(debug_assertions)]
impl std::io::Write for QuietWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.context
            .std_io_write_quiet_debug(bytes)
            .map_err(|e| std::io::Error::other(e.name()))
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub struct ReadToEndResult {
    pub bytes: Vec<u8>,
    pub err: Option<SysError>,
}

impl Default for ReadToEndResult {
    fn default() -> Self {
        Self { bytes: Vec::new(), err: None }
    }
}

impl ReadToEndResult {
    pub fn unwrap(&self) -> Result<&[u8], bun_core::Error> {
        if let Some(err) = &self.err {
            // TODO(port): narrow error set
            SysResult::<()>::Err(err.clone()).unwrap()?;
        }
        Ok(self.bytes.as_slice())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SizeGuess {
    ProbablySmall,
    UnknownSize,
}

// TODO(port): Zig used std.fs.File.Kind. Define here (or hoist to crate root) since std::fs is banned.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    BlockDevice,
    CharacterDevice,
    Directory,
    NamedPipe,
    SymLink,
    File,
    UnixDomainSocket,
    Unknown,
}

#[derive(Default)]
pub struct ToSourceOptions {
    pub convert_bom: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/File.zig (472 lines)
//   confidence: medium
//   todos:      11
//   notes:      anytype path/dir_fd dispatch collapsed to &ZStr + Into<File>; Reader/Writer mapped to std::io traits; allocator params dropped (Vec<u8>).
// ──────────────────────────────────────────────────────────────────────────
