//! Native Win32/NT implementations of `bun_sys`'s file operations on Windows.
//!
//! What callers can observe — `CreateFileW` parameters, how `st_mode` is
//! synthesised, which Win32 error becomes which errno, which reparse points
//! count as symlinks — follows libuv's `src/win/fs.c`, because that is what
//! `node:fs` exposes on Windows.

use core::ffi::c_void;
use core::ptr;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::{S, Timespec, ZStr};
use bun_paths::{is_drive_letter_t, is_sep_any_t};
use bun_windows_sys as win32;

use super::{
    EPOCH_DIFFERENCE_100NS, HANDLE, INVALID_HANDLE_VALUE, NTSTATUS, O, Win32Error,
    Win32ErrorExt as _,
};
use crate::{E, Error, Fd, Maybe, Mode, PlatformIoVec, PlatformIoVecConst, Tag, TimeLike};

type Win32Result<T> = core::result::Result<T, Win32Error>;

pub(crate) const SHARE_ALL: u32 =
    win32::FILE_SHARE_READ | win32::FILE_SHARE_WRITE | win32::FILE_SHARE_DELETE;

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/// `bun_sys::Stat` on Windows. Every numeric field is a `u64` so the values
/// reach JS `Stats` without per-field width handling.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Stat {
    pub st_dev: u64,
    pub st_mode: u64,
    pub st_nlink: u64,
    pub st_uid: u64,
    pub st_gid: u64,
    pub st_rdev: u64,
    pub st_ino: u64,
    pub st_size: u64,
    pub st_blksize: u64,
    pub st_blocks: u64,
    pub atim: Timespec,
    pub mtim: Timespec,
    pub ctim: Timespec,
    pub birthtim: Timespec,
}
impl Stat {
    #[inline]
    pub fn mtime(&self) -> Timespec {
        self.mtim
    }
    #[inline]
    pub fn mode(&self) -> u64 {
        self.st_mode
    }
    #[inline]
    pub fn size(&self) -> u64 {
        self.st_size
    }
}
// SAFETY: integers only; all-zero is a valid value.
unsafe impl bun_core::ffi::Zeroable for Stat {}

/// `bun_sys::StatFS` on Windows.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct StatFS {
    pub f_type: u64,
    pub f_bsize: u64,
    pub f_blocks: u64,
    pub f_bfree: u64,
    pub f_bavail: u64,
    pub f_files: u64,
    pub f_ffree: u64,
}
// SAFETY: integers only; all-zero is a valid value.
unsafe impl bun_core::ffi::Zeroable for StatFS {}

const TICKS_PER_SEC: i64 = 10_000_000;

fn filetime_to_timespec(filetime: i64) -> Timespec {
    // Split before moving the epoch: the subtraction cannot overflow then,
    // whatever the volume has stored.
    let sec = filetime.div_euclid(TICKS_PER_SEC) - EPOCH_DIFFERENCE_100NS / TICKS_PER_SEC;
    let nsec = filetime.rem_euclid(TICKS_PER_SEC) * 100;
    Timespec { sec, nsec }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/// The error for a write that failed with `code`: a closed pipe is `EPIPE`.
/// (Everywhere else `ERROR_BROKEN_PIPE` is `EOF` and `ERROR_NO_DATA` is `EAGAIN`.)
fn write_error(code: Win32Error, tag: Tag) -> Error {
    match code {
        Win32Error::BROKEN_PIPE | Win32Error::NO_DATA => Error::from_code(E::EPIPE, tag),
        // Writing through a handle that was not opened for writing.
        Win32Error::ACCESS_DENIED => Error::from_code(E::EBADF, tag),
        _ => Error::from_win32(code, tag),
    }
}

/// The error for a read that failed with `code`, or `None` when the failure
/// means end-of-file.
fn read_error(code: Win32Error, tag: Tag) -> Option<Error> {
    match code {
        Win32Error::BROKEN_PIPE | Win32Error::HANDLE_EOF => None,
        // Reading through a handle that was not opened for reading.
        Win32Error::ACCESS_DENIED => Some(Error::from_code(E::EBADF, tag)),
        _ => Some(Error::from_win32(code, tag)),
    }
}

fn bad_fd(fd: Fd, tag: Tag) -> Error {
    Error {
        errno: E::EBADF as _,
        syscall: tag,
        fd,
        ..Default::default()
    }
}

/// The HANDLE behind either kind of `fd`, or `EBADF`.
fn handle_of(fd: Fd, tag: Tag) -> Maybe<HANDLE> {
    let handle = fd.native();
    if handle == INVALID_HANDLE_VALUE {
        return Err(bad_fd(fd, tag));
    }
    Ok(handle)
}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: `self.0` is a live handle this value owns.
        unsafe { win32::CloseHandle(self.0) };
    }
}

fn create_file(
    path: *const u16,
    access: u32,
    share: u32,
    disposition: u32,
    flags_and_attributes: u32,
) -> Win32Result<OwnedHandle> {
    // SAFETY: `path` is a NUL-terminated wide string that outlives the call.
    let handle = unsafe {
        win32::CreateFileW(
            path,
            access,
            share,
            ptr::null_mut(),
            disposition,
            flags_and_attributes,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    Ok(OwnedHandle(handle))
}

/// Paths at least this long (the `CreateDirectoryW` limit, the smallest of the
/// `MAX_PATH`-derived limits) are made absolute and `\\?\`-prefixed: the
/// `longPathAware` manifest has no effect unless the machine-wide
/// `LongPathsEnabled` policy is also on.
const LONG_PATH_THRESHOLD: usize = 248;

/// `\\?\…` and `\\.\…`.
fn is_device_path(path: &[u16]) -> bool {
    path.len() >= 4
        && is_sep_any_t(path[0])
        && is_sep_any_t(path[1])
        && (path[2] == b'?' as u16 || path[2] == b'.' as u16)
        && is_sep_any_t(path[3])
}

/// Whether Win32 holds `path` to `MAX_PATH`. A relative path counts with the
/// directory Win32 resolves it against.
fn exceeds_max_path(path: &[u16]) -> bool {
    if is_device_path(path) {
        return false;
    }
    if path.len() >= LONG_PATH_THRESHOLD {
        return true;
    }
    let is_absolute = path.len() >= 3 && path[1] == b':' as u16 && is_sep_any_t(path[2])
        || path.len() >= 2 && is_sep_any_t(path[0]) && is_sep_any_t(path[1]);
    if is_absolute {
        return false;
    }
    // SAFETY: a zero-length query writes nothing and returns the length of
    // the current directory, NUL included.
    let cwd_len =
        unsafe { bun_windows_sys::externs::GetCurrentDirectoryW(0, ptr::null_mut()) } as usize;
    path.len() + cwd_len >= LONG_PATH_THRESHOLD
}

/// Writes the NUL-terminated `path` into `full`, resolved by
/// `GetFullPathNameW` and `\\?\`-prefixed. Returns where in `full` it starts
/// and its length.
fn write_long_path(path: *const u16, full: &mut [u16]) -> Win32Result<(usize, usize)> {
    // Room in front of the resolved path for `\\?\UNC\`.
    const RESERVE: usize = 8;
    let capacity = full.len() - RESERVE;
    // SAFETY: the caller passes a NUL-terminated `path`; `full[RESERVE..]` is
    // writable for `capacity` units.
    let n = unsafe {
        win32::GetFullPathNameW(
            path,
            capacity as u32,
            full[RESERVE..].as_mut_ptr(),
            ptr::null_mut(),
        )
    } as usize;
    if n == 0 {
        return Err(Win32Error::get());
    }
    if n >= capacity {
        return Err(Win32Error::FILENAME_EXCED_RANGE);
    }
    let resolved = &full[RESERVE..RESERVE + n];
    Ok(if is_device_path(resolved) {
        // A device name resolved to `\\.\NAME`.
        (RESERVE, n)
    } else if n >= 2 && is_sep_any_t(resolved[0]) && is_sep_any_t(resolved[1]) {
        // `\\server\share\…` → `\\?\UNC\server\share\…`
        let start = RESERVE + 1 - 7;
        for (dst, src) in full[start..start + 7].iter_mut().zip(b"\\\\?\\UNC") {
            *dst = u16::from(*src);
        }
        (start, n - 1 + 7)
    } else {
        let start = RESERVE - 4;
        full[start..RESERVE].copy_from_slice(&super::LONG_PATH_PREFIX);
        (start, n + 4)
    })
}

/// For a wide path that goes to a Win32 call without a [`WPath`]: puts the
/// NUL-terminated `buf[..len]` into the form Win32 takes past `MAX_PATH` when
/// it needs that, and returns its length.
fn lengthen_path_in_place(buf: &mut [u16], len: usize) -> Win32Result<usize> {
    if !exceeds_max_path(&buf[..len]) {
        return Ok(len);
    }
    let mut full = bun_paths::w_path_buffer_pool::get();
    let (start, len) = write_long_path(buf.as_ptr(), &mut full[..])?;
    if len >= buf.len() {
        return Err(Win32Error::FILENAME_EXCED_RANGE);
    }
    buf[..len].copy_from_slice(&full[start..start + len]);
    buf[len] = 0;
    Ok(len)
}

/// `path` as the NUL-terminated wide string a kernel32 call takes, in `buf`:
/// the form Win32 takes past `MAX_PATH` when it needs that. Returns its length.
/// Every path that reaches a Win32 call outside a [`WPath`] goes through here.
pub fn kernel32_path(buf: &mut [u16], path: &[u8]) -> Win32Result<usize> {
    let len = bun_paths::string_paths::try_to_kernel32_path(buf, path)
        .ok_or(Win32Error::INVALID_NAME)?
        .len();
    lengthen_path_in_place(buf, len)
}

/// A NUL-terminated UTF-16 path for a Win32 call.
///
/// Short paths are passed through as given, so Win32 resolves relative paths,
/// drive-relative paths, `.`/`..` and device names (`NUL`, `CON`) as usual.
pub struct WPath {
    buf: bun_paths::w_path_buffer_pool::Guard,
    start: usize,
    len: usize,
}

impl WPath {
    pub fn new(path: &[u8]) -> Win32Result<WPath> {
        use bun_paths::string_paths;
        if !string_paths::fits_in_wide_path_buffer(string_paths::without_nt_prefix(path)) {
            return Err(Win32Error::FILENAME_EXCED_RANGE);
        }
        let mut buf = bun_paths::w_path_buffer_pool::get();
        // Bytes that are no name fail as they do in libuv and Node (`ENOENT`).
        let len = string_paths::try_to_w_path(&mut buf[..], path)
            .ok_or(Win32Error::INVALID_NAME)?
            .len();

        // `\??\` is the NT spelling of `\\?\`; Win32 only documents the latter.
        if len >= 4 && buf[..4] == super::NT_OBJECT_PREFIX {
            buf[1] = b'\\' as u16;
        }

        if !exceeds_max_path(&buf[..len]) {
            return Ok(WPath { buf, start: 0, len });
        }
        let mut full = bun_paths::w_path_buffer_pool::get();
        let (start, len) = write_long_path(buf.as_ptr(), &mut full[..])?;
        Ok(WPath {
            buf: full,
            start,
            len,
        })
    }

    /// Conversion only: the units are what the caller wrote, with `/` turned
    /// into `\`. For strings that are stored rather than opened (a symlink's
    /// target), where making the path absolute would change its meaning.
    fn verbatim(path: &[u8]) -> Win32Result<WPath> {
        if !bun_paths::string_paths::fits_in_wide_path_buffer(path) {
            return Err(Win32Error::FILENAME_EXCED_RANGE);
        }
        let mut buf = bun_paths::w_path_buffer_pool::get();
        let len = bun_paths::string_paths::try_to_w_path(&mut buf[..], path)
            .ok_or(Win32Error::INVALID_NAME)?
            .len();
        Ok(WPath { buf, start: 0, len })
    }

    #[inline]
    pub fn as_ptr(&self) -> *const u16 {
        self.buf[self.start..].as_ptr()
    }

    #[inline]
    fn units(&self) -> &[u16] {
        &self.buf[self.start..self.start + self.len]
    }

    /// The units followed by the terminating NUL.
    #[inline]
    fn units_with_nul_mut(&mut self) -> &mut [u16] {
        &mut self.buf[self.start..self.start + self.len + 1]
    }

    fn truncate(&mut self, len: usize) {
        debug_assert!(len <= self.len);
        self.len = len;
        self.buf[self.start + len] = 0;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// open
// ──────────────────────────────────────────────────────────────────────────

/// `open(2)` over `CreateFileW`. `flags` are `bun_sys::O` values. The result
/// is a HANDLE-kind `Fd`.
pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    // A zero mode would create the file read-only.
    let mode = if mode == 0 { 0o644 } else { mode };
    let result = open_impl(path.as_bytes(), O::from_bun_o(flags), mode);
    crate::syslog!(
        "open({}, {:#o}, {:#o}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        flags,
        mode,
        result.as_ref().map(|h| *h as usize)
    );
    match result {
        Ok(handle) => Ok(Fd::from_system(handle)),
        Err(errno) => Err(Error::from_code(errno, Tag::open).with_path(path.as_bytes())),
    }
}

/// `flags` are `windows::O` values (the numbers `fs.constants` exposes).
fn open_impl(path: &[u8], flags: i32, mode: Mode) -> core::result::Result<HANDLE, E> {
    // `O::FILEMAP` (Node's `UV_FS_O_FILEMAP`) requests I/O through a file
    // mapping. File contents are the same without it, so it is accepted and
    // ignored, as Node documents for every other OS.
    let mut access = match flags & (O::RDONLY | O::WRONLY | O::RDWR) {
        O::RDONLY => win32::FILE_GENERIC_READ,
        O::WRONLY => win32::FILE_GENERIC_WRITE,
        O::RDWR => win32::FILE_GENERIC_READ | win32::FILE_GENERIC_WRITE,
        _ => return Err(E::EINVAL),
    };

    if flags & O::APPEND != 0 {
        // Append-only access makes the kernel write at end-of-file atomically.
        access &= !win32::FILE_WRITE_DATA;
        access |= win32::FILE_APPEND_DATA;
    }

    const CREAT_EXCL: i32 = O::CREAT | O::EXCL;
    const CREAT_TRUNC_EXCL: i32 = O::CREAT | O::TRUNC | O::EXCL;
    const TRUNC_EXCL: i32 = O::TRUNC | O::EXCL;
    const CREAT_TRUNC: i32 = O::CREAT | O::TRUNC;
    let disposition = match flags & (O::CREAT | O::EXCL | O::TRUNC) {
        0 | O::EXCL => win32::OPEN_EXISTING,
        O::CREAT => win32::OPEN_ALWAYS,
        CREAT_EXCL | CREAT_TRUNC_EXCL => win32::CREATE_NEW,
        O::TRUNC | TRUNC_EXCL => win32::TRUNCATE_EXISTING,
        CREAT_TRUNC => win32::CREATE_ALWAYS,
        _ => return Err(E::EINVAL),
    };

    let mut attributes = win32::FILE_ATTRIBUTE_NORMAL;
    if flags & O::CREAT != 0 {
        // The CRT only has a setter; read the umask by setting it twice.
        let umask = crate::umask(0);
        crate::umask(umask);
        if (mode & !umask) & S::IWUSR == 0 {
            attributes |= win32::FILE_ATTRIBUTE_READONLY;
        }
    }

    if flags & O::DIRECT != 0 {
        // FILE_APPEND_DATA (part of FILE_GENERIC_WRITE) cannot be combined
        // with FILE_FLAG_NO_BUFFERING. FILE_WRITE_DATA also permits appends,
        // so drop it when both are present; append-only + direct is invalid.
        if access & win32::FILE_APPEND_DATA != 0 {
            if access & win32::FILE_WRITE_DATA != 0 {
                access &= !win32::FILE_APPEND_DATA;
            } else {
                return Err(E::EINVAL);
            }
        }
        attributes |= win32::FILE_FLAG_NO_BUFFERING;
    }

    match flags & (O::DSYNC | O::SYNC) {
        0 => {}
        O::DSYNC | O::SYNC => attributes |= win32::FILE_FLAG_WRITE_THROUGH,
        _ => return Err(E::EINVAL),
    }

    // Makes it possible to open a directory.
    attributes |= win32::FILE_FLAG_BACKUP_SEMANTICS;

    let wpath = WPath::new(path).map_err(|e| e.to_e())?;
    // All sharing modes, to match UNIX semantics: in particular the file can
    // be deleted or renamed while it is open.
    match create_file(wpath.as_ptr(), access, SHARE_ALL, disposition, attributes) {
        Ok(handle) => {
            let raw = handle.0;
            core::mem::forget(handle);
            Ok(raw)
        }
        // With O_CREAT and no O_EXCL this means the path is a directory.
        Err(Win32Error::FILE_EXISTS) if flags & O::CREAT != 0 && flags & O::EXCL == 0 => {
            Err(E::EISDIR)
        }
        Err(e) => Err(e.to_e()),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// read / write
// ──────────────────────────────────────────────────────────────────────────

pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    read_at(fd, buf, None)
}

pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    write_at(fd, buf, None)
}

/// The `OVERLAPPED` of a synchronous `ReadFile`/`WriteFile` at `off`.
fn overlapped_at(off: u64) -> win32::OVERLAPPED {
    win32::OVERLAPPED {
        Internal: 0,
        InternalHigh: 0,
        Offset: off as u32,
        OffsetHigh: (off >> 32) as u32,
        hEvent: core::ptr::null_mut(),
    }
}

/// A positioned `ReadFile`/`WriteFile` on a synchronous handle moves its
/// file pointer too. `fs.read(fd, .., position)` must leave it alone, so it
/// is put back for the fds JS can see (CRT fds). HANDLE-kind callers never
/// mix positioned and sequential I/O on one handle and skip the two calls.
struct RestoreFilePointer {
    handle: HANDLE,
    saved: Option<i64>,
}

impl RestoreFilePointer {
    fn new(fd: Fd) -> Self {
        const FILE_POSITION_INFORMATION: win32::FILE_INFORMATION_CLASS =
            win32::FILE_INFORMATION_CLASS(14);
        let handle = fd.native();
        let mut saved = None;
        if fd.kind() == crate::FdKind::Crt {
            let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
            let mut current: i64 = 0;
            // One system call; `SetFilePointerEx(FILE_CURRENT)` is this
            // query followed by a set.
            // SAFETY: FFI; `handle` is the fd's HANDLE, and the class
            // writes one `LARGE_INTEGER` into `current`.
            let status = unsafe {
                win32::ntdll::NtQueryInformationFile(
                    handle,
                    &mut io,
                    core::ptr::from_mut(&mut current).cast(),
                    core::mem::size_of::<i64>() as u32,
                    FILE_POSITION_INFORMATION,
                )
            };
            if win32::NT_SUCCESS(status) {
                saved = Some(current);
            }
        }
        Self { handle, saved }
    }
}

impl Drop for RestoreFilePointer {
    fn drop(&mut self) {
        if let Some(position) = self.saved {
            // SAFETY: FFI; `handle` outlives the guard.
            unsafe {
                win32::SetFilePointerEx(
                    self.handle,
                    position,
                    core::ptr::null_mut(),
                    win32::FILE_BEGIN,
                )
            };
        }
    }
}

/// A negative `off` reads at the file pointer.
pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
    if off < 0 {
        return read(fd, buf);
    }
    let _restore = RestoreFilePointer::new(fd);
    read_at(fd, buf, Some(off as u64))
}

/// `ReadFile` at `at`, or at the file pointer. A positioned read runs
/// under a [`RestoreFilePointer`] the caller holds.
fn read_at(fd: Fd, buf: &mut [u8], at: Option<u64>) -> Maybe<usize> {
    let adjusted_len = buf.len().min(crate::MAX_COUNT) as u32;
    // Stdin callers route through this function (via
    // `File::stdin().read_to_end_into` / `output_sink().read`), so the
    // OPERATION_ABORTED retry lives here.
    loop {
        let mut overlapped = at.map(overlapped_at);
        let mut amount_read: u32 = 0;
        // SAFETY: FFI; `buf` valid for `adjusted_len`, `overlapped` lives
        // for the synchronous call (handle was not opened
        // FILE_FLAG_OVERLAPPED).
        let rc = unsafe {
            win32::kernel32::ReadFile(
                fd.native(),
                buf.as_mut_ptr(),
                adjusted_len,
                &mut amount_read,
                overlapped
                    .as_mut()
                    .map_or(core::ptr::null_mut(), |o| core::ptr::from_mut(o).cast()),
            )
        };
        if rc == 0 {
            let er = Win32Error::get();
            if er == Win32Error::OPERATION_ABORTED {
                continue;
            }
            return match read_error(er, Tag::read) {
                Some(err) => Err(err.with_fd(fd)),
                None => Ok(0),
            };
        }
        return Ok(amount_read as usize);
    }
}

/// A negative `off` writes at the file pointer; see `pread`.
pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
    if off < 0 {
        return write(fd, buf);
    }
    let _restore = RestoreFilePointer::new(fd);
    write_at(fd, buf, Some(off as u64))
}

/// `WriteFile` at `at`, or at the file pointer. A positioned write runs
/// under a [`RestoreFilePointer`] the caller holds.
fn write_at(fd: Fd, buf: &[u8], at: Option<u64>) -> Maybe<usize> {
    let adjusted_len = buf.len().min(crate::MAX_COUNT) as u32;
    let mut overlapped = at.map(overlapped_at);
    let mut bytes_written: u32 = 0;
    // SAFETY: FFI; `buf` valid for `adjusted_len`, `overlapped` lives for
    // the synchronous call (handle was not opened FILE_FLAG_OVERLAPPED).
    let rc = unsafe {
        win32::kernel32::WriteFile(
            fd.native(),
            buf.as_ptr(),
            adjusted_len,
            &mut bytes_written,
            overlapped
                .as_mut()
                .map_or(core::ptr::null_mut(), |o| core::ptr::from_mut(o).cast()),
        )
    };
    if rc == 0 {
        return Err(write_error(Win32Error::get(), Tag::write).with_fd(fd));
    }
    Ok(bytes_written as usize)
}

/// One `ReadFile` per buffer. `position < 0` reads at the file pointer.
/// A short read goes on to the next buffer, as libuv's `fs__read` does (on a
/// pipe that waits for more); a read of nothing ends it. An error after some
/// bytes were read reports those bytes instead.
pub fn preadv(fd: Fd, bufs: &[PlatformIoVec], position: i64) -> Maybe<usize> {
    let _restore = (position >= 0).then(|| RestoreFilePointer::new(fd));
    let mut total: usize = 0;
    for buf in bufs {
        if buf.iov_len == 0 {
            continue;
        }
        // SAFETY: a `PlatformIoVec` describes a writable buffer of `iov_len`
        // bytes that the caller keeps alive for the call.
        let slice = unsafe { core::slice::from_raw_parts_mut(buf.iov_base.cast(), buf.iov_len) };
        let at = (position >= 0).then(|| position as u64 + total as u64);
        match read_at(fd, slice, at) {
            Ok(n) => {
                total += n;
                if n == 0 {
                    break;
                }
            }
            Err(_) if total > 0 => break,
            Err(e) => return Err(e),
        }
    }
    Ok(total)
}

/// One `WriteFile` per buffer. `position < 0` writes at the file pointer.
pub fn pwritev(fd: Fd, bufs: &[PlatformIoVecConst], position: i64) -> Maybe<usize> {
    let _restore = (position >= 0).then(|| RestoreFilePointer::new(fd));
    let mut total: usize = 0;
    for buf in bufs {
        if buf.len == 0 {
            continue;
        }
        // SAFETY: a `PlatformIoVecConst` describes a readable buffer of `len`
        // bytes that the caller keeps alive for the call.
        let slice = unsafe { core::slice::from_raw_parts(buf.base, buf.len) };
        let at = (position >= 0).then(|| position as u64 + total as u64);
        match write_at(fd, slice, at) {
            Ok(n) => {
                total += n;
                if n < slice.len() {
                    break;
                }
            }
            Err(_) if total > 0 => break,
            Err(e) => return Err(e),
        }
    }
    Ok(total)
}

// ──────────────────────────────────────────────────────────────────────────
// stat / lstat / fstat
// ──────────────────────────────────────────────────────────────────────────

pub fn stat(path: &ZStr) -> Maybe<Stat> {
    let result = stat_path(path.as_bytes(), false);
    crate::syslog!(
        "stat({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|e| Error::from_win32(e, Tag::stat).with_path(path.as_bytes()))
}

pub fn lstat(path: &ZStr) -> Maybe<Stat> {
    let result = stat_path(path.as_bytes(), true);
    crate::syslog!(
        "lstat({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|e| Error::from_win32(e, Tag::lstat).with_path(path.as_bytes()))
}

pub fn fstat(fd: Fd) -> Maybe<Stat> {
    let handle = handle_of(fd, Tag::fstat)?;
    let result = fstat_handle(handle);
    crate::syslog!("fstat({}) = {:?}", fd, result.as_ref().err());
    result.map_err(|e| Error::from_win32(e, Tag::fstat).with_fd(fd))
}

fn fstat_handle(handle: HANDLE) -> Win32Result<Stat> {
    // Pipes and consoles have nothing to query; set what can be known.
    let synthetic = |mode: u32, device_type: u32| Stat {
        st_mode: u64::from(mode),
        st_nlink: 1,
        st_rdev: u64::from(device_type) << 16,
        st_ino: handle as usize as u64,
        ..Default::default()
    };
    match super::GetFileType(handle) {
        super::FILE_TYPE_CHAR if is_console(handle) => {
            Ok(synthetic(S::IFCHR, win32::FILE_DEVICE_CONSOLE))
        }
        // A character device that is not a console (NUL, COM1) is statted
        // like a disk file; `stat_handle` special-cases NUL.
        super::FILE_TYPE_CHAR => stat_handle(handle, false),
        // `GetFileType` has read the device type: it is not NUL's.
        super::FILE_TYPE_DISK => stat_file_handle(handle, false),
        super::FILE_TYPE_PIPE => Ok(synthetic(S::IFIFO, win32::FILE_DEVICE_NAMED_PIPE)),
        _ => Err(Win32Error::INVALID_HANDLE),
    }
}

fn is_console(handle: HANDLE) -> bool {
    let mut mode: u32 = 0;
    // SAFETY: `mode` is a valid out-pointer; any handle value is acceptable.
    unsafe { win32::GetConsoleMode(handle, &mut mode) != 0 }
}

fn stat_path(path: &[u8], do_lstat: bool) -> Win32Result<Stat> {
    let mut wpath = WPath::new(path)?;

    // Strip one trailing slash, unless it follows a drive colon (`C:\`).
    let units = wpath.units();
    let len = units.len();
    if len > 1 && units[len - 2] != b':' as u16 && is_sep_any_t(units[len - 1]) {
        wpath.truncate(len - 1);
    }

    match stat_wpath(&mut wpath, do_lstat) {
        // A reparse point that is not a symlink is an ordinary file.
        Err(Win32Error::SYMLINK_NOT_SUPPORTED | Win32Error::NOT_A_REPARSE_POINT) if do_lstat => {
            stat_wpath(&mut wpath, false)
        }
        result => result,
    }
}

fn stat_wpath(wpath: &mut WPath, do_lstat: bool) -> Win32Result<Stat> {
    match stat_by_name(wpath, do_lstat) {
        ByName::Done(stat) => return Ok(stat),
        ByName::Failed(e) => return Err(e),
        ByName::NeedsHandle => {}
    }

    let mut flags = win32::FILE_FLAG_BACKUP_SEMANTICS;
    if do_lstat {
        flags |= win32::FILE_FLAG_OPEN_REPARSE_POINT;
    }
    match create_file(
        wpath.as_ptr(),
        win32::FILE_READ_ATTRIBUTES,
        SHARE_ALL,
        win32::OPEN_EXISTING,
        flags,
    ) {
        Ok(handle) => stat_handle(handle.0, do_lstat),
        // Not even FILE_READ_ATTRIBUTES is granted (`C:\pagefile.sys`, a
        // file another process holds exclusively): the parent directory's
        // listing still has most of the fields.
        Err(e @ (Win32Error::ACCESS_DENIED | Win32Error::SHARING_VIOLATION)) => {
            stat_from_directory_listing(wpath, do_lstat, e)
        }
        Err(e) => Err(e),
    }
}

enum ByName {
    Done(Stat),
    Failed(Win32Error),
    NeedsHandle,
}

/// `GetFileInformationByName` (Windows 11 24H2+) answers a stat without
/// opening a handle.
fn stat_by_name(wpath: &WPath, do_lstat: bool) -> ByName {
    static GET_FILE_INFORMATION_BY_NAME: std::sync::OnceLock<
        Option<win32::GetFileInformationByNameFn>,
    > = std::sync::OnceLock::new();
    let Some(get_file_information_by_name) = *GET_FILE_INFORMATION_BY_NAME.get_or_init(|| {
        const MODULE: &[u16] = bun_core::w!("api-ms-win-core-file-l2-1-4.dll\0");
        // SAFETY: NUL-terminated literals; a null module handle is checked
        // before use. The export has the `GetFileInformationByNameFn` signature.
        unsafe {
            let module = win32::kernel32::GetModuleHandleW(MODULE.as_ptr());
            if module.is_null() {
                return None;
            }
            let proc = win32::GetProcAddress(module, c"GetFileInformationByName".as_ptr());
            if proc.is_null() {
                return None;
            }
            Some(core::mem::transmute::<
                *mut c_void,
                win32::GetFileInformationByNameFn,
            >(proc))
        }
    }) else {
        return ByName::NeedsHandle;
    };

    let mut info: win32::FILE_STAT_BASIC_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `wpath` is NUL-terminated; `info` is writable for its size.
    let ok = unsafe {
        get_file_information_by_name(
            wpath.as_ptr(),
            win32::FileStatBasicByNameInfo,
            ptr::from_mut(&mut info).cast(),
            core::mem::size_of::<win32::FILE_STAT_BASIC_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        return match Win32Error::get() {
            // Opening a handle would fail the same way.
            e @ (Win32Error::FILE_NOT_FOUND
            | Win32Error::PATH_NOT_FOUND
            | Win32Error::NOT_READY
            | Win32Error::BAD_NET_NAME) => ByName::Failed(e),
            _ => ByName::NeedsHandle,
        };
    }
    // Following a link, or measuring its target for `st_size`, needs a handle.
    if info.FileAttributes & win32::FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return ByName::NeedsHandle;
    }
    if info.DeviceType == win32::FILE_DEVICE_NULL {
        return ByName::Done(null_device_stat());
    }
    ByName::Done(stat_from_info(&info, do_lstat))
}

fn stat_handle(handle: HANDLE, do_lstat: bool) -> Win32Result<Stat> {
    let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();

    let mut device_info: win32::FILE_FS_DEVICE_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `handle` is live; the out-buffers are writable for their size.
    let status = unsafe {
        win32::ntdll::NtQueryVolumeInformationFile(
            handle,
            &mut io,
            ptr::from_mut(&mut device_info).cast(),
            core::mem::size_of::<win32::FILE_FS_DEVICE_INFORMATION>() as u32,
            win32::FS_INFORMATION_CLASS::FileFsDeviceInformation,
        )
    };
    if win32::NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }
    if device_info.DeviceType == win32::FILE_DEVICE_NULL {
        return Ok(null_device_stat());
    }
    stat_file_handle(handle, do_lstat)
}

/// [`stat_handle`] for a handle that is known not to be the null device's.
fn stat_file_handle(handle: HANDLE, do_lstat: bool) -> Win32Result<Stat> {
    let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut file_info: win32::FILE_ALL_INFORMATION = bun_core::ffi::zeroed();
    // The file name does not fit the fixed-size struct, so the expected
    // status is the STATUS_BUFFER_OVERFLOW warning, which NT_ERROR excludes.
    // SAFETY: `handle` is live; the out-buffers are writable for their size.
    let status = unsafe {
        win32::ntdll::NtQueryInformationFile(
            handle,
            &mut io,
            ptr::from_mut(&mut file_info).cast(),
            core::mem::size_of::<win32::FILE_ALL_INFORMATION>() as u32,
            win32::FILE_INFORMATION_CLASS::FileAllInformation,
        )
    };
    if win32::NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }

    let volume_serial = volume_serial_number(handle)?;

    let attributes = file_info.BasicInformation.FileAttributes;
    let end_of_file = if do_lstat && attributes & win32::FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        // `st_size` of a symlink is the length of its target. When the
        // reparse point is not a symlink this fails and the caller retries
        // without `do_lstat`.
        let mut reparse = ReparseBuffer::new();
        bun_core::strings::element_length_utf16_into_utf8(reparse.read_link_target(handle)?) as i64
    } else {
        file_info.StandardInformation.EndOfFile
    };

    Ok(stat_from_info(
        &win32::FILE_STAT_BASIC_INFORMATION {
            FileId: file_info.InternalInformation.IndexNumber,
            CreationTime: file_info.BasicInformation.CreationTime,
            LastAccessTime: file_info.BasicInformation.LastAccessTime,
            LastWriteTime: file_info.BasicInformation.LastWriteTime,
            ChangeTime: file_info.BasicInformation.ChangeTime,
            AllocationSize: file_info.StandardInformation.AllocationSize,
            EndOfFile: end_of_file,
            FileAttributes: attributes,
            NumberOfLinks: file_info.StandardInformation.NumberOfLinks,
            VolumeSerialNumber: i64::from(volume_serial),
            ..bun_core::ffi::zeroed()
        },
        do_lstat,
    ))
}

/// 0 for a filesystem driver that does not implement the query.
fn volume_serial_number(handle: HANDLE) -> Win32Result<u32> {
    let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut volume_info: win32::FILE_FS_VOLUME_INFORMATION = bun_core::ffi::zeroed();
    // The volume label does not fit the fixed-size struct; see `stat_file_handle`.
    // SAFETY: `handle` is live; the out-buffers are writable for their size.
    let status = unsafe {
        win32::ntdll::NtQueryVolumeInformationFile(
            handle,
            &mut io,
            ptr::from_mut(&mut volume_info).cast(),
            core::mem::size_of::<win32::FILE_FS_VOLUME_INFORMATION>() as u32,
            win32::FS_INFORMATION_CLASS::FileFsVolumeInformation,
        )
    };
    if status == NTSTATUS::NOT_IMPLEMENTED {
        return Ok(0);
    }
    if win32::NT_ERROR(status) {
        return Err(Win32Error::from_ntstatus(status));
    }
    Ok(volume_info.VolumeSerialNumber)
}

fn null_device_stat() -> Stat {
    Stat {
        st_mode: u64::from(S::IFCHR | 0o666),
        st_nlink: 1,
        st_blksize: 4096,
        st_rdev: u64::from(win32::FILE_DEVICE_NULL) << 16,
        ..Default::default()
    }
}

fn stat_from_info(info: &win32::FILE_STAT_BASIC_INFORMATION, do_lstat: bool) -> Stat {
    let attributes = info.FileAttributes;
    // Symlinks and junctions are the only reparse points treated as links,
    // and only by lstat; callers have already established that this one is.
    let (file_type, size) = if do_lstat && attributes & win32::FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        (S::IFLNK, info.EndOfFile as u64)
    } else if attributes & win32::FILE_ATTRIBUTE_DIRECTORY != 0 {
        (S::IFDIR, 0)
    } else {
        (S::IFREG, info.EndOfFile as u64)
    };
    // The read-only attribute is the only permission there is to report;
    // no execute bits, directories included.
    let permissions = if attributes & win32::FILE_ATTRIBUTE_READONLY != 0 {
        0o444
    } else {
        0o666
    };
    Stat {
        st_dev: u64::from(info.VolumeSerialNumber as u32),
        st_mode: u64::from(file_type | permissions),
        st_nlink: u64::from(info.NumberOfLinks),
        st_ino: info.FileId as u64,
        st_size: size,
        // Querying the real sector size would cost another syscall.
        st_blksize: 4096,
        st_blocks: (info.AllocationSize as u64) >> 9,
        atim: filetime_to_timespec(info.LastAccessTime),
        mtim: filetime_to_timespec(info.LastWriteTime),
        ctim: filetime_to_timespec(info.ChangeTime),
        birthtim: filetime_to_timespec(info.CreationTime),
        ..Default::default()
    }
}

/// Stat `wpath` from its parent directory's listing. `open_error` is why the
/// file itself could not be opened; it is returned when the listing cannot
/// answer either (a link that would have to be followed).
fn stat_from_directory_listing(
    wpath: &mut WPath,
    do_lstat: bool,
    open_error: Win32Error,
) -> Win32Result<Stat> {
    let path = wpath.units_with_nul_mut();
    let len = path.len() - 1;

    // Find where the last component starts.
    let mut split = len;
    let mut includes_name = false;
    while split > 0 && !is_sep_any_t(path[split - 1]) && path[split - 1] != b':' as u16 {
        if path[split - 1] != b'.' as u16 {
            includes_name = true;
        }
        split -= 1;
    }

    const DOT: [u16; 2] = [b'.' as u16, 0];
    let mut root = [0u16; 8];
    // The separator that was overwritten with a NUL to terminate the
    // directory part in place.
    let mut restore: Option<(usize, u16)> = None;
    let dir: *const u16 = if split == 0 && includes_name {
        // A bare relative name.
        DOT.as_ptr()
    } else if split > 0 && is_sep_any_t(path[split - 1]) {
        if !includes_name {
            // `dir\`, `dir\..`: the whole path is the directory.
            split = len;
            path.as_ptr()
        } else if split == 1 {
            // `\name`: the separator alone is the current drive's root.
            root[0] = path[0];
            root.as_ptr()
        } else if (3..=7).contains(&split) && path[split - 2] == b':' as u16 {
            // `X:\name`, `\\?\X:\name`: the root keeps its backslash. `X:` is
            // the drive's current directory and `\\?\X:` the volume device.
            root[..split].copy_from_slice(&path[..split]);
            root.as_ptr()
        } else {
            restore = Some((split - 1, path[split - 1]));
            path[split - 1] = 0;
            path.as_ptr()
        }
    } else {
        // `..`, `C:`
        split = len;
        path.as_ptr()
    };

    let result = (|| {
        let name = &path[split..len];
        // These are wildcards to NtQueryDirectoryFile.
        const WILDCARDS: [u16; 5] = [
            b'*' as u16,
            b'?' as u16,
            b'>' as u16,
            b'<' as u16,
            b'"' as u16,
        ];
        if bun_core::strings::index_of_any16(name, &WILDCARDS).is_some() {
            return Err(Win32Error::INVALID_NAME);
        }

        let dir_handle = create_file(
            dir,
            win32::FILE_LIST_DIRECTORY,
            SHARE_ALL,
            win32::OPEN_EXISTING,
            win32::FILE_FLAG_BACKUP_SEMANTICS,
        )?;

        let Ok(name_bytes) = u16::try_from(name.len() * 2) else {
            return Err(Win32Error::INVALID_PARAMETER);
        };
        let mut file_mask = win32::UNICODE_STRING {
            Length: name_bytes,
            MaximumLength: name_bytes,
            Buffer: name.as_ptr().cast_mut(),
        };
        let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        let mut dir_info: win32::FILE_ID_FULL_DIR_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: `dir_handle` is live; `dir_info` is writable for its size;
        // `file_mask` is only read.
        let status = unsafe {
            win32::ntdll::NtQueryDirectoryFile(
                dir_handle.0,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                &mut io,
                ptr::from_mut(&mut dir_info).cast(),
                core::mem::size_of::<win32::FILE_ID_FULL_DIR_INFORMATION>() as u32,
                win32::FILE_INFORMATION_CLASS::FileIdFullDirectoryInformation,
                1,
                &mut file_mask,
                1,
            )
        };
        // STATUS_BUFFER_OVERFLOW is success: only the file name did not fit.
        if !win32::NT_SUCCESS(status) && status != NTSTATUS::BUFFER_OVERFLOW {
            return Err(if status == NTSTATUS::NO_MORE_FILES {
                Win32Error::PATH_NOT_FOUND
            } else {
                Win32Error::from_ntstatus(status)
            });
        }

        let is_reparse_point = dir_info.FileAttributes & win32::FILE_ATTRIBUTE_REPARSE_POINT != 0;
        if is_reparse_point && !do_lstat {
            // Following the link needs the handle that could not be opened.
            return Err(open_error);
        }

        let volume_serial = volume_serial_number(dir_handle.0)?;

        Ok(stat_from_info(
            &win32::FILE_STAT_BASIC_INFORMATION {
                FileId: dir_info.FileId,
                CreationTime: dir_info.CreationTime,
                LastAccessTime: dir_info.LastAccessTime,
                LastWriteTime: dir_info.LastWriteTime,
                ChangeTime: dir_info.ChangeTime,
                // A link's target length needs the handle too; report 0.
                AllocationSize: if is_reparse_point {
                    0
                } else {
                    dir_info.AllocationSize
                },
                EndOfFile: if is_reparse_point {
                    0
                } else {
                    dir_info.EndOfFile
                },
                FileAttributes: dir_info.FileAttributes,
                // Not part of a directory listing.
                NumberOfLinks: 1,
                VolumeSerialNumber: i64::from(volume_serial),
                ..bun_core::ffi::zeroed()
            },
            do_lstat,
        ))
    })();

    if let Some((index, separator)) = restore {
        path[index] = separator;
    }
    result
}

// ──────────────────────────────────────────────────────────────────────────
// Reparse points
// ──────────────────────────────────────────────────────────────────────────

/// Aligned storage for a `REPARSE_DATA_BUFFER` (the first
/// `MAXIMUM_REPARSE_DATA_BUFFER_SIZE` bytes of a pooled wide path buffer):
///
/// ```text
///  0  u32 ReparseTag
///  4  u16 ReparseDataLength
///  6  u16 Reserved
///  8  symlink / mount point: u16 SubstituteNameOffset, SubstituteNameLength,
///                            PrintNameOffset, PrintNameLength (bytes, relative
///                            to PathBuffer)
/// 16  symlink: u32 Flags, then PathBuffer at 20
/// 16  mount point: PathBuffer
///  8  app exec link: u32 StringCount, then NUL-separated strings at 12
/// ```
struct ReparseBuffer(bun_paths::w_path_buffer_pool::Guard);

const _: () = assert!(bun_paths::PATH_MAX_WIDE >= win32::MAXIMUM_REPARSE_DATA_BUFFER_SIZE / 2);

impl ReparseBuffer {
    fn new() -> Self {
        Self(bun_paths::w_path_buffer_pool::get())
    }

    /// The path a symlink-like reparse point on `handle` points to, as the
    /// caller of `readlink` should see it. `ERROR_SYMLINK_NOT_SUPPORTED` for
    /// a reparse point that is not treated as a symlink.
    fn read_link_target(&mut self, handle: HANDLE) -> Win32Result<&[u16]> {
        let mut bytes: u32 = 0;
        // SAFETY: `handle` is live; `self.0` is writable for its size.
        let ok = unsafe {
            win32::DeviceIoControl(
                handle,
                win32::FSCTL_GET_REPARSE_POINT,
                ptr::null_mut(),
                0,
                self.0.as_mut_ptr().cast(),
                win32::MAXIMUM_REPARSE_DATA_BUFFER_SIZE as u32,
                &mut bytes,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }

        const NOT_A_SYMLINK: Win32Error = Win32Error::SYMLINK_NOT_SUPPORTED;
        let units = &mut self.0[..bytes as usize / 2];
        if units.len() < 8 {
            return Err(NOT_A_SYMLINK);
        }
        let tag = u32::from(units[0]) | u32::from(units[1]) << 16;
        let is_drive_path = |t: &[u16]| {
            t.len() >= 2
                && is_drive_letter_t(t[0])
                && t[1] == b':' as u16
                && (t.len() == 2 || t[2] == b'\\' as u16)
        };
        let has_nt_prefix = |t: &[u16]| t.len() >= 4 && t[..4] == super::NT_OBJECT_PREFIX;

        match tag {
            win32::IO_REPARSE_TAG_SYMLINK | win32::IO_REPARSE_TAG_MOUNT_POINT => {
                let path_buffer = if tag == win32::IO_REPARSE_TAG_SYMLINK {
                    10
                } else {
                    8
                };
                let start = path_buffer + usize::from(units[4]) / 2;
                let end = start + usize::from(units[5]) / 2;
                if end > units.len() {
                    return Err(Win32Error::INVALID_REPARSE_DATA);
                }
                let target = &mut units[start..end];

                if tag == win32::IO_REPARSE_TAG_MOUNT_POINT {
                    // Only `\??\X:\…` junctions are links. A volume mount
                    // point (`\??\Volume{guid}\`) is not, as in Node.
                    if !(has_nt_prefix(target) && is_drive_path(&target[4..])) {
                        return Err(NOT_A_SYMLINK);
                    }
                    return Ok(&target[4..]);
                }

                // Undo the NT namespacing CreateSymbolicLinkW applies to
                // absolute targets. Any other `\??\` form was written by the
                // link's creator and is returned as is.
                if has_nt_prefix(target) {
                    if is_drive_path(&target[4..]) {
                        return Ok(&target[4..]);
                    }
                    let rest = &target[4..];
                    if rest.len() >= 4
                        && matches!(u8::try_from(rest[0]), Ok(b'U' | b'u'))
                        && matches!(u8::try_from(rest[1]), Ok(b'N' | b'n'))
                        && matches!(u8::try_from(rest[2]), Ok(b'C' | b'c'))
                        && rest[3] == b'\\' as u16
                    {
                        // `\??\UNC\server\share` → `\\server\share`
                        target[6] = b'\\' as u16;
                        return Ok(&target[6..]);
                    }
                }
                Ok(target)
            }
            win32::IO_REPARSE_TAG_APPEXECLINK => {
                // The target executable is the third NUL-separated string.
                let string_count = u32::from(units[4]) | u32::from(units[5]) << 16;
                if string_count < 3 {
                    return Err(NOT_A_SYMLINK);
                }
                let mut rest: &[u16] = &units[6..];
                for _ in 0..2 {
                    match bun_core::strings::index_of_any16(rest, &[0]) {
                        Some(len) if len > 0 => rest = &rest[len + 1..],
                        _ => return Err(NOT_A_SYMLINK),
                    }
                }
                let target = match bun_core::strings::index_of_any16(rest, &[0]) {
                    Some(len) => &rest[..len],
                    None => rest,
                };
                if !(target.len() >= 3 && is_drive_path(target) && target[2] == b'\\' as u16) {
                    return Err(NOT_A_SYMLINK);
                }
                Ok(target)
            }
            _ => Err(NOT_A_SYMLINK),
        }
    }
}

/// Writes the link target into `buf`, NUL-terminated; returns its length.
pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
    let result = readlink_impl(path.as_bytes(), buf);
    crate::syslog!(
        "readlink({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().map(|&len| bstr::BStr::new(&buf[..len]))
    );
    result.map_err(|errno| Error::from_code(errno, Tag::readlink).with_path(path.as_bytes()))
}

fn readlink_impl(path: &[u8], buf: &mut [u8]) -> core::result::Result<usize, E> {
    let win32_err = |e: Win32Error| match e {
        Win32Error::NOT_A_REPARSE_POINT => E::EINVAL,
        e => e.to_e(),
    };
    let wpath = WPath::new(path).map_err(win32_err)?;
    let handle = create_file(
        wpath.as_ptr(),
        0,
        0,
        win32::OPEN_EXISTING,
        win32::FILE_FLAG_OPEN_REPARSE_POINT | win32::FILE_FLAG_BACKUP_SEMANTICS,
    )
    .map_err(win32_err)?;
    let mut reparse = ReparseBuffer::new();
    let target = reparse.read_link_target(handle.0).map_err(win32_err)?;

    // One byte is reserved for the NUL.
    let Some(capacity) = buf.len().checked_sub(1) else {
        return Err(E::ENAMETOOLONG);
    };
    let encoded = bun_core::strings::copy_utf16_into_utf8(&mut buf[..capacity], target);
    if (encoded.read as usize) < target.len() {
        return Err(E::ENAMETOOLONG);
    }
    let written = encoded.written as usize;
    buf[written] = 0;
    Ok(written)
}

// ──────────────────────────────────────────────────────────────────────────
// unlink / rmdir / mkdir / rename / link
// ──────────────────────────────────────────────────────────────────────────

pub fn unlink(path: &ZStr) -> Maybe<()> {
    let result = unlink_or_rmdir(path.as_bytes(), false);
    crate::syslog!(
        "unlink({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result
    );
    result.map_err(|errno| Error::from_code(errno, Tag::unlink).with_path(path.as_bytes()))
}

pub fn rmdir(path: &ZStr) -> Maybe<()> {
    let result = unlink_or_rmdir(path.as_bytes(), true);
    crate::syslog!("rmdir({}) = {:?}", bstr::BStr::new(path.as_bytes()), result);
    result.map_err(|errno| Error::from_code(errno, Tag::rmdir).with_path(path.as_bytes()))
}

fn unlink_or_rmdir(path: &[u8], is_rmdir: bool) -> core::result::Result<(), E> {
    let to_e = |e: Win32Error| e.to_e();
    let wpath = WPath::new(path).map_err(to_e)?;
    // Never follows a link: the link itself is what gets removed.
    let handle = create_file(
        wpath.as_ptr(),
        win32::FILE_READ_ATTRIBUTES | win32::DELETE,
        SHARE_ALL,
        win32::OPEN_EXISTING,
        win32::FILE_FLAG_OPEN_REPARSE_POINT | win32::FILE_FLAG_BACKUP_SEMANTICS,
    )
    .map_err(to_e)?;

    let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut info: win32::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `handle` is live; `info` is writable for its size.
    let status = unsafe {
        win32::ntdll::NtQueryInformationFile(
            handle.0,
            &mut io,
            ptr::from_mut(&mut info).cast(),
            core::mem::size_of::<win32::FILE_BASIC_INFORMATION>() as u32,
            win32::FILE_INFORMATION_CLASS::FileBasicInformation,
        )
    };
    if !win32::NT_SUCCESS(status) {
        return Err(Win32Error::from_ntstatus(status).to_e());
    }
    let attributes = info.FileAttributes;
    let is_directory = attributes & win32::FILE_ATTRIBUTE_DIRECTORY != 0;

    if is_rmdir && !is_directory {
        // What Node on Windows reports for `rmdir(file)`, not ENOTDIR.
        return Err(E::ENOENT);
    }

    if !is_rmdir && is_directory {
        // POSIX wants EPERM for unlink(directory). A directory symlink or
        // junction is a link, though, and unlink removes those.
        if attributes & win32::FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            return Err(Win32Error::ACCESS_DENIED.to_e());
        }
        let mut reparse = ReparseBuffer::new();
        if let Err(e) = reparse.read_link_target(handle.0) {
            return Err(match e {
                Win32Error::SYMLINK_NOT_SUPPORTED => Win32Error::ACCESS_DENIED.to_e(),
                e => e.to_e(),
            });
        }
    }

    // POSIX delete: the name disappears at once even while other handles are
    // open, and a read-only file needs no attribute change.
    let mut disposition_ex = win32::FILE_DISPOSITION_INFORMATION_EX {
        Flags: win32::FILE_DISPOSITION_DELETE
            | win32::FILE_DISPOSITION_POSIX_SEMANTICS
            | win32::FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };
    // SAFETY: `handle` is live; the info struct matches the class.
    let status = unsafe {
        win32::ntdll::NtSetInformationFile(
            handle.0,
            &mut io,
            ptr::from_mut(&mut disposition_ex).cast(),
            core::mem::size_of::<win32::FILE_DISPOSITION_INFORMATION_EX>() as u32,
            win32::FILE_INFORMATION_CLASS::FileDispositionInformationEx,
        )
    };
    if win32::NT_SUCCESS(status) {
        return Ok(());
    }
    let error = Win32Error::from_ntstatus(status);
    // The errors libuv takes to mean that the file system or the OS has no
    // POSIX delete.
    if !matches!(
        error,
        Win32Error::NOT_SUPPORTED | Win32Error::INVALID_PARAMETER | Win32Error::INVALID_FUNCTION
    ) {
        return Err(error.to_e());
    }

    if attributes & win32::FILE_ATTRIBUTE_READONLY != 0 {
        // A classic delete refuses read-only files. The first handle was
        // opened without FILE_WRITE_ATTRIBUTES because asking for it up front
        // fails under Wine (https://bugs.winehq.org/show_bug.cgi?id=50771).
        // SAFETY: `handle` is live.
        let write_attributes = unsafe {
            win32::ReOpenFile(
                handle.0,
                win32::FILE_WRITE_ATTRIBUTES,
                SHARE_ALL,
                win32::FILE_FLAG_OPEN_REPARSE_POINT | win32::FILE_FLAG_BACKUP_SEMANTICS,
            )
        };
        if write_attributes == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get().to_e());
        }
        let write_attributes = OwnedHandle(write_attributes);
        let mut basic: win32::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
        basic.FileAttributes =
            (attributes & !win32::FILE_ATTRIBUTE_READONLY) | win32::FILE_ATTRIBUTE_ARCHIVE;
        // SAFETY: `write_attributes` is live; the info struct matches the class.
        let status = unsafe {
            win32::ntdll::NtSetInformationFile(
                write_attributes.0,
                &mut io,
                ptr::from_mut(&mut basic).cast(),
                core::mem::size_of::<win32::FILE_BASIC_INFORMATION>() as u32,
                win32::FILE_INFORMATION_CLASS::FileBasicInformation,
            )
        };
        if !win32::NT_SUCCESS(status) {
            return Err(Win32Error::from_ntstatus(status).to_e());
        }
    }

    let mut disposition = win32::FILE_DISPOSITION_INFORMATION { DeleteFile: 1 };
    // SAFETY: `handle` is live; the info struct matches the class.
    let status = unsafe {
        win32::ntdll::NtSetInformationFile(
            handle.0,
            &mut io,
            ptr::from_mut(&mut disposition).cast(),
            core::mem::size_of::<win32::FILE_DISPOSITION_INFORMATION>() as u32,
            win32::FILE_INFORMATION_CLASS::FileDispositionInformation,
        )
    };
    if win32::NT_SUCCESS(status) {
        Ok(())
    } else {
        Err(Win32Error::from_ntstatus(status).to_e())
    }
}

/// `mode` is ignored: a Windows directory has no permission bits to set.
pub fn mkdir(path: &ZStr, _mode: Mode) -> Maybe<()> {
    // libuv's mapping of what `CreateDirectoryW` reports; a path that does
    // not convert is `ENOENT` as for every other call.
    let result = match WPath::new(path.as_bytes()) {
        Err(e) => Err(e.to_e()),
        // SAFETY: `wpath` is NUL-terminated.
        Ok(wpath) if unsafe { win32::CreateDirectoryW(wpath.as_ptr(), ptr::null_mut()) } == 0 => {
            Err(match Win32Error::get() {
                Win32Error::INVALID_NAME | Win32Error::DIRECTORY => E::EINVAL,
                e => e.to_e(),
            })
        }
        Ok(_) => Ok(()),
    };
    crate::syslog!("mkdir({}) = {:?}", bstr::BStr::new(path.as_bytes()), result);
    result.map_err(|errno| Error::from_code(errno, Tag::mkdir).with_path(path.as_bytes()))
}

/// `mkdtemp(3)`: replaces the trailing `XXXXXX` of `template` in place and
/// creates that directory.
pub fn mkdtemp(template: &mut [u8]) -> Maybe<()> {
    const CHARS: &[u8; 62] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const NUM_X: usize = 6;
    // The CRT's `TMP_MAX`.
    const TRIES: u32 = i32::MAX as u32;

    let len = template.len();
    if len < NUM_X || &template[len - NUM_X..] != b"XXXXXX" {
        return Err(Error::from_code(E::EINVAL, Tag::mkdtemp).with_path(template));
    }
    let mut wpath = match WPath::new(template) {
        Ok(wpath) => wpath,
        Err(e) => return Err(Error::from_win32(e, Tag::mkdtemp).with_path(template)),
    };
    let wide_len = wpath.len;
    // A template that does not convert comes back empty.
    if wide_len < NUM_X {
        return Err(Error::from_code(E::EINVAL, Tag::mkdtemp).with_path(template));
    }
    let mut last = Win32Error::ALREADY_EXISTS;
    for _ in 0..TRIES {
        // Not `fast_random`: every thread's generator starts from one seed.
        let mut v = [0u8; 8];
        bun_core::os_entropy(&mut v);
        let mut v = u64::from_ne_bytes(v);
        let mut name = [0u8; NUM_X];
        for c in &mut name {
            *c = CHARS[(v % CHARS.len() as u64) as usize];
            v /= CHARS.len() as u64;
        }
        let units = wpath.units_with_nul_mut();
        for (dst, src) in units[wide_len - NUM_X..wide_len].iter_mut().zip(name) {
            *dst = u16::from(src);
        }
        // SAFETY: `wpath` is NUL-terminated.
        if unsafe { win32::CreateDirectoryW(wpath.as_ptr(), ptr::null_mut()) } != 0 {
            template[len - NUM_X..].copy_from_slice(&name);
            return Ok(());
        }
        last = Win32Error::get();
        if last != Win32Error::ALREADY_EXISTS {
            break;
        }
    }
    Err(Error::from_win32(last, Tag::mkdtemp).with_path(template))
}

/// `realpath(3)` over `GetFinalPathNameByHandleW`. The file is opened with no
/// access rights, so neither its ACL's read permission nor another open's
/// share mode can make this fail.
pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_paths::PathBuffer) -> Maybe<&'a [u8]> {
    let to_error = |e: Win32Error| Error::from_win32(e, Tag::realpath).with_path(path.as_bytes());
    let wpath = WPath::new(path.as_bytes()).map_err(to_error)?;
    let handle = create_file(
        wpath.as_ptr(),
        0,
        0,
        win32::OPEN_EXISTING,
        win32::FILE_ATTRIBUTE_NORMAL | win32::FILE_FLAG_BACKUP_SEMANTICS,
    )
    .map_err(to_error)?;
    let mut wide = bun_paths::w_path_buffer_pool::get();
    let resolved = super::GetFinalPathNameByHandle(handle.0, Default::default(), &mut wide[..])
        .map_err(|e| {
            let error = match e {
                super::GetFinalPathNameByHandleError::NameTooLong => {
                    Error::from_code(E::ENAMETOOLONG, Tag::realpath)
                }
                super::GetFinalPathNameByHandleError::FileNotFound => {
                    // The wrapper tried several forms of the query. Ask once
                    // more for the code itself: a volume that cannot answer
                    // is EISDIR to Node, not ENOENT.
                    // SAFETY: a zero-length buffer is valid; the call only sizes.
                    let sized = unsafe {
                        bun_windows_sys::externs::GetFinalPathNameByHandleW(
                            handle.0,
                            ptr::null_mut(),
                            0,
                            0,
                        )
                    };
                    if sized == 0 {
                        Error::from_win32(Win32Error::get(), Tag::realpath)
                    } else {
                        Error::from_code(E::ENOENT, Tag::realpath)
                    }
                }
            };
            error.with_path(path.as_bytes())
        })?;
    let len = bun_paths::string_paths::from_w_path(&mut buf.0[..], resolved).len();
    Ok(&buf.0[..len])
}

/// `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`: no cross-volume copy, and a
/// destination that is open elsewhere fails with `EPERM`/`EBUSY` (the errors
/// graceful-fs and friends retry on).
pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let result = (|| {
        let from = WPath::new(from.as_bytes())?;
        let to = WPath::new(to.as_bytes())?;
        // SAFETY: both paths are NUL-terminated.
        if unsafe {
            super::kernel32::MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                super::MOVEFILE_REPLACE_EXISTING,
            )
        } == 0
        {
            return Err(Win32Error::get());
        }
        Ok(())
    })();
    crate::syslog!(
        "rename({}, {}) = {:?}",
        bstr::BStr::new(from.as_bytes()),
        bstr::BStr::new(to.as_bytes()),
        result
    );
    result.map_err(|e| Error::from_win32(e, Tag::rename))
}

/// Hard link `to` → existing file `from`.
pub fn link(from: &ZStr, to: &ZStr) -> Maybe<()> {
    let result = (|| {
        let existing = WPath::new(from.as_bytes())?;
        let new = WPath::new(to.as_bytes())?;
        if super::CreateHardLinkW(new.as_ptr(), existing.as_ptr(), None) == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    })();
    result
        .map_err(|e| Error::from_win32(e, Tag::link).with_path_dest(from.as_bytes(), to.as_bytes()))
}

// ──────────────────────────────────────────────────────────────────────────
// symlink / junction
// ──────────────────────────────────────────────────────────────────────────

/// `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`, until the OS rejects it
/// (before Windows 10 1703 the flag is `ERROR_INVALID_PARAMETER`).
static UNPRIVILEGED_CREATE_FLAG: AtomicU32 =
    AtomicU32::new(win32::SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE);

/// `CreateSymbolicLinkW`. The caller says whether the target is a directory;
/// Windows does not find out for itself.
pub(crate) fn create_symbolic_link(
    link: *const u16,
    target: *const u16,
    directory: bool,
) -> Win32Result<()> {
    loop {
        let unprivileged = UNPRIVILEGED_CREATE_FLAG.load(Ordering::Relaxed);
        let flags = unprivileged
            | if directory {
                win32::SYMBOLIC_LINK_FLAG_DIRECTORY
            } else {
                0
            };
        // SAFETY: the caller passes NUL-terminated wide strings.
        if unsafe { win32::CreateSymbolicLinkW(link, target, flags) } != 0 {
            return Ok(());
        }
        let error = Win32Error::get();
        if error == Win32Error::INVALID_PARAMETER && unprivileged != 0 {
            UNPRIVILEGED_CREATE_FLAG.store(0, Ordering::Relaxed);
            continue;
        }
        return Err(error);
    }
}

fn symlink_impl(target: &ZStr, link: &ZStr, directory: bool) -> Maybe<()> {
    let result = (|| {
        let target = WPath::verbatim(target.as_bytes())?;
        let link = WPath::new(link.as_bytes())?;
        create_symbolic_link(link.as_ptr(), target.as_ptr(), directory)
    })();
    crate::syslog!(
        "symlink({}, {}) = {:?}",
        bstr::BStr::new(target.as_bytes()),
        bstr::BStr::new(link.as_bytes()),
        result
    );
    result.map_err(|e| Error::from_win32(e, Tag::symlink))
}

/// A symlink to a file.
pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
    symlink_impl(target, link, false)
}

/// A symlink to a directory.
pub fn symlink_dir(target: &ZStr, link: &ZStr) -> Maybe<()> {
    symlink_impl(target, link, true)
}

/// A junction at `link` pointing to the directory `target`, which must be an
/// absolute drive path (optionally `\\?\`-prefixed). Needs no privilege.
pub fn junction(target: &ZStr, link: &ZStr) -> Maybe<()> {
    let result = junction_impl(target.as_bytes(), link.as_bytes());
    crate::syslog!(
        "junction({}, {}) = {:?}",
        bstr::BStr::new(target.as_bytes()),
        bstr::BStr::new(link.as_bytes()),
        result
    );
    result.map_err(|errno| Error::from_code(errno, Tag::symlink))
}

fn junction_impl(target: &[u8], link: &[u8]) -> core::result::Result<(), E> {
    let to_e = |e: Win32Error| e.to_e();
    let target = WPath::verbatim(target).map_err(to_e)?;
    let target = target.units();

    let is_long_path = target.len() >= 4 && target[..4] == super::LONG_PATH_PREFIX;
    let is_absolute = is_long_path
        || (target.len() >= 3
            && is_drive_letter_t(target[0])
            && target[1] == b':' as u16
            && is_sep_any_t(target[2]));
    if !is_absolute {
        return Err(E::EINVAL);
    }
    let target = if is_long_path { &target[4..] } else { target };

    // `REPARSE_DATA_BUFFER` header (8 bytes), mount point header (8 bytes),
    // then `\??\` + target + NUL (substitute name) and target + `\` + NUL
    // (print name). See `ReparseBuffer` for the layout.
    const HEADER_UNITS: usize = 8;
    let mut buffer = vec![0u16; HEADER_UNITS + 4 + 2 * (target.len() + 2)];
    let mut at = HEADER_UNITS;

    // Appends `target` with each run of slashes collapsed into one `\`;
    // returns whether it ended in a slash that has not been written yet.
    let append_target = |buffer: &mut [u16], at: &mut usize| {
        let mut pending_slash = false;
        for &c in target {
            if is_sep_any_t(c) {
                pending_slash = true;
                continue;
            }
            if pending_slash {
                buffer[*at] = b'\\' as u16;
                *at += 1;
                pending_slash = false;
            }
            buffer[*at] = c;
            *at += 1;
        }
        pending_slash
    };

    let substitute_start = at;
    buffer[at..at + 4].copy_from_slice(&super::NT_OBJECT_PREFIX);
    at += 4;
    if append_target(&mut buffer, &mut at) {
        buffer[at] = b'\\' as u16;
        at += 1;
    }
    let substitute_len = at - substitute_start;
    at += 1; // NUL

    let print_start = at;
    let trailing_slash = append_target(&mut buffer, &mut at);
    // A bare `X:` is printed as the root, `X:\`.
    if trailing_slash || at - print_start == 2 {
        buffer[at] = b'\\' as u16;
        at += 1;
    }
    let print_len = at - print_start;
    at += 1; // NUL

    let used_bytes = at * 2;
    buffer[0] = win32::IO_REPARSE_TAG_MOUNT_POINT as u16;
    buffer[1] = (win32::IO_REPARSE_TAG_MOUNT_POINT >> 16) as u16;
    let Ok(data_len) = u16::try_from(used_bytes - 8) else {
        return Err(E::ENAMETOOLONG);
    };
    buffer[2] = data_len;
    buffer[4] = ((substitute_start - HEADER_UNITS) * 2) as u16;
    buffer[5] = (substitute_len * 2) as u16;
    buffer[6] = ((print_start - HEADER_UNITS) * 2) as u16;
    buffer[7] = (print_len * 2) as u16;

    let link = WPath::new(link).map_err(to_e)?;
    // SAFETY: `link` is NUL-terminated.
    if unsafe { win32::CreateDirectoryW(link.as_ptr(), ptr::null_mut()) } == 0 {
        return Err(Win32Error::get().to_e());
    }
    let set_reparse_point = || {
        let handle = create_file(
            link.as_ptr(),
            win32::GENERIC_WRITE,
            0,
            win32::OPEN_EXISTING,
            win32::FILE_FLAG_BACKUP_SEMANTICS | win32::FILE_FLAG_OPEN_REPARSE_POINT,
        )?;
        let mut bytes: u32 = 0;
        // SAFETY: `handle` is live; `buffer` is readable for `used_bytes`.
        let ok = unsafe {
            win32::DeviceIoControl(
                handle.0,
                win32::FSCTL_SET_REPARSE_POINT,
                buffer.as_ptr().cast_mut().cast(),
                used_bytes as u32,
                ptr::null_mut(),
                0,
                &mut bytes,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    };
    set_reparse_point().map_err(|e| {
        // SAFETY: `link` is NUL-terminated. Undo the directory made above.
        unsafe { win32::RemoveDirectoryW(link.as_ptr()) };
        e.to_e()
    })
}

// ──────────────────────────────────────────────────────────────────────────
// chmod / fchmod / chown
// ──────────────────────────────────────────────────────────────────────────

/// The owner-write bit decides the read-only attribute; nothing else in
/// `mode` has a Windows equivalent.
pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
    let result = (|| {
        let wpath = WPath::new(path.as_bytes())?;
        // SAFETY: `wpath` is NUL-terminated.
        let attributes = unsafe { win32::GetFileAttributesW(wpath.as_ptr()) };
        if attributes == super::INVALID_FILE_ATTRIBUTES {
            return Err(Win32Error::get());
        }
        let attributes = if mode & S::IWUSR != 0 {
            attributes & !win32::FILE_ATTRIBUTE_READONLY
        } else {
            attributes | win32::FILE_ATTRIBUTE_READONLY
        };
        // SAFETY: `wpath` is NUL-terminated.
        if unsafe { win32::SetFileAttributesW(wpath.as_ptr(), attributes) } == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    })();
    crate::syslog!(
        "chmod({}, {:#o}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        mode,
        result
    );
    result.map_err(|e| Error::from_win32(e, Tag::chmod).with_path(path.as_bytes()))
}

pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
    let handle = handle_of(fd, Tag::fchmod)?;
    let result = fchmod_handle(handle, mode);
    crate::syslog!("fchmod({}, {:#o}) = {:?}", fd, mode, result);
    result.map_err(|e| Error::from_win32(e, Tag::fchmod).with_fd(fd))
}

fn fchmod_handle(handle: HANDLE, mode: Mode) -> Win32Result<()> {
    // The caller's handle may lack FILE_WRITE_ATTRIBUTES.
    // SAFETY: `handle` is live.
    let reopened = unsafe { win32::ReOpenFile(handle, win32::FILE_WRITE_ATTRIBUTES, 0, 0) };
    if reopened == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    let reopened = OwnedHandle(reopened);

    let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut info: win32::FILE_BASIC_INFORMATION = bun_core::ffi::zeroed();
    // SAFETY: `reopened` is live; `info` is writable for its size.
    let status = unsafe {
        win32::ntdll::NtQueryInformationFile(
            reopened.0,
            &mut io,
            ptr::from_mut(&mut info).cast(),
            core::mem::size_of::<win32::FILE_BASIC_INFORMATION>() as u32,
            win32::FILE_INFORMATION_CLASS::FileBasicInformation,
        )
    };
    if !win32::NT_SUCCESS(status) {
        return Err(Win32Error::from_ntstatus(status));
    }

    let mut set = |info: &mut win32::FILE_BASIC_INFORMATION| {
        // SAFETY: `reopened` is live; the info struct matches the class.
        let status = unsafe {
            win32::ntdll::NtSetInformationFile(
                reopened.0,
                &mut io,
                ptr::from_mut(info).cast(),
                core::mem::size_of::<win32::FILE_BASIC_INFORMATION>() as u32,
                win32::FILE_INFORMATION_CLASS::FileBasicInformation,
            )
        };
        if win32::NT_SUCCESS(status) {
            Ok(())
        } else {
            Err(Win32Error::from_ntstatus(status))
        }
    };

    // Toggling read-only does not take effect unless the archive attribute
    // is set, so set it for the duration.
    let clear_archive = info.FileAttributes & win32::FILE_ATTRIBUTE_ARCHIVE == 0;
    if clear_archive {
        info.FileAttributes |= win32::FILE_ATTRIBUTE_ARCHIVE;
        set(&mut info)?;
    }

    if mode & S::IWUSR != 0 {
        info.FileAttributes &= !win32::FILE_ATTRIBUTE_READONLY;
    } else {
        info.FileAttributes |= win32::FILE_ATTRIBUTE_READONLY;
    }
    set(&mut info)?;

    if clear_archive {
        info.FileAttributes &= !win32::FILE_ATTRIBUTE_ARCHIVE;
        if info.FileAttributes == 0 {
            // 0 means "leave unchanged".
            info.FileAttributes = win32::FILE_ATTRIBUTE_NORMAL;
        }
        set(&mut info)?;
    }
    Ok(())
}

/// Windows files have no POSIX owner: succeeds without doing anything, as in
/// Node.
pub fn chown(_path: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

/// See [`chown`].
pub fn lchown(_path: &ZStr, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

/// See [`chown`].
pub fn fchown(_fd: Fd, _uid: u32, _gid: u32) -> Maybe<()> {
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// statfs
// ──────────────────────────────────────────────────────────────────────────

pub fn statfs(path: &ZStr) -> Maybe<StatFS> {
    let result = statfs_impl(path.as_bytes());
    crate::syslog!(
        "statfs({}) = {:?}",
        bstr::BStr::new(path.as_bytes()),
        result.as_ref().err()
    );
    result.map_err(|e| Error::from_win32(e, Tag::statfs).with_path(path.as_bytes()))
}

fn statfs_impl(path: &[u8]) -> Win32Result<StatFS> {
    let wpath = WPath::new(path)?;
    let mut sectors_per_cluster: u32 = 0;
    let mut bytes_per_sector: u32 = 0;
    let mut free_clusters: u32 = 0;
    let mut total_clusters: u32 = 0;
    let mut get_disk_free_space = |dir: *const u16| {
        // SAFETY: `dir` is NUL-terminated; the out-pointers are valid.
        if unsafe {
            win32::GetDiskFreeSpaceW(
                dir,
                &mut sectors_per_cluster,
                &mut bytes_per_sector,
                &mut free_clusters,
                &mut total_clusters,
            )
        } == 0
        {
            return Err(Win32Error::get());
        }
        Ok(())
    };

    match get_disk_free_space(wpath.as_ptr()) {
        Ok(()) => {}
        // `path` is a file; ask about the directory it is in.
        Err(Win32Error::DIRECTORY) => {
            let mut parent = bun_paths::w_path_buffer_pool::get();
            let mut file_part: *mut u16 = ptr::null_mut();
            // SAFETY: `wpath` is NUL-terminated; `parent` is writable for its
            // length; `file_part` receives a pointer into `parent`.
            let n = unsafe {
                win32::GetFullPathNameW(
                    wpath.as_ptr(),
                    parent.len() as u32,
                    parent.as_mut_ptr(),
                    &mut file_part,
                )
            } as usize;
            if n == 0 || n >= parent.len() {
                return Err(Win32Error::DIRECTORY);
            }
            if !file_part.is_null() {
                // SAFETY: `file_part` points into `parent`, at or before its NUL.
                unsafe { *file_part = 0 };
            }
            get_disk_free_space(parent.as_ptr())?;
        }
        Err(e) => return Err(e),
    }

    Ok(StatFS {
        f_type: 0,
        f_bsize: u64::from(bytes_per_sector) * u64::from(sectors_per_cluster),
        f_blocks: u64::from(total_clusters),
        f_bfree: u64::from(free_clusters),
        f_bavail: u64::from(free_clusters),
        f_files: 0,
        f_ffree: 0,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// utimes
// ──────────────────────────────────────────────────────────────────────────

/// `None` leaves the timestamp unchanged. A time outside what a FILETIME can
/// hold is `ERROR_INVALID_PARAMETER`, the error `SetFileTime` has for one.
fn time_like_to_filetime(
    time: TimeLike,
    now: &mut Option<win32::FILETIME>,
) -> Win32Result<Option<win32::FILETIME>> {
    if time.nsec == crate::UTIME_OMIT {
        return Ok(None);
    }
    if time.nsec == crate::UTIME_NOW {
        return Ok(Some(*now.get_or_insert_with(|| {
            let mut ft = win32::FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            // SAFETY: `ft` is a valid out-pointer.
            unsafe { win32::GetSystemTimeAsFileTime(&mut ft) };
            ft
        })));
    }
    // Negative values are not times to `SetFileTime`: -1 and -2 switch the
    // handle's own timestamp updates off and on, the rest are rejected.
    let ticks = time
        .sec
        .checked_mul(TICKS_PER_SEC)
        .and_then(|ticks| ticks.checked_add(time.nsec / 100))
        .and_then(|ticks| ticks.checked_add(EPOCH_DIFFERENCE_100NS))
        .and_then(|ticks| u64::try_from(ticks).ok())
        .ok_or(Win32Error::INVALID_PARAMETER)?;
    Ok(Some(win32::FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    }))
}

/// Sets the access and modification times; the creation time is left alone.
fn utime_handle(handle: HANDLE, atime: TimeLike, mtime: TimeLike) -> Win32Result<()> {
    let mut now = None;
    let atime = time_like_to_filetime(atime, &mut now)?;
    let mtime = time_like_to_filetime(mtime, &mut now)?;
    // SAFETY: `handle` is live; each pointer is null or a valid FILETIME.
    if unsafe {
        win32::SetFileTime(
            handle,
            ptr::null(),
            atime.as_ref().map_or(ptr::null(), ptr::from_ref),
            mtime.as_ref().map_or(ptr::null(), ptr::from_ref),
        )
    } == 0
    {
        return Err(Win32Error::get());
    }
    Ok(())
}

fn utime_path(path: &[u8], atime: TimeLike, mtime: TimeLike, no_follow: bool) -> Win32Result<()> {
    let wpath = WPath::new(path)?;
    let mut flags = win32::FILE_FLAG_BACKUP_SEMANTICS;
    if no_follow {
        flags |= win32::FILE_FLAG_OPEN_REPARSE_POINT;
    }
    let handle = create_file(
        wpath.as_ptr(),
        win32::FILE_WRITE_ATTRIBUTES,
        SHARE_ALL,
        win32::OPEN_EXISTING,
        flags,
    )?;
    utime_handle(handle.0, atime, mtime)
}

pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    utime_path(path.as_bytes(), atime, mtime, false)
        .map_err(|e| Error::from_win32(e, Tag::utime).with_path(path.as_bytes()))
}

/// Like [`utimens`], but sets the times of a symlink instead of its target.
pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    utime_path(path.as_bytes(), atime, mtime, true)
        .map_err(|e| Error::from_win32(e, Tag::lutime).with_path(path.as_bytes()))
}

pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
    let handle = handle_of(fd, Tag::futime)?;
    utime_handle(handle, atime, mtime).map_err(|e| Error::from_win32(e, Tag::futime).with_fd(fd))
}

// ──────────────────────────────────────────────────────────────────────────
// fsync / ftruncate / isatty / pipe
// ──────────────────────────────────────────────────────────────────────────

fn flush(fd: Fd, tag: Tag) -> Maybe<()> {
    let handle = handle_of(fd, tag)?;
    // SAFETY: `handle` is a HANDLE value; a stale one fails with
    // ERROR_INVALID_HANDLE.
    if unsafe { win32::kernel32::FlushFileBuffers(handle) } == 0 {
        return Err(Error::from_win32(Win32Error::get(), tag).with_fd(fd));
    }
    Ok(())
}

pub fn fsync(fd: Fd) -> Maybe<()> {
    flush(fd, Tag::fsync)
}

/// Windows has no data-only flush; same as [`fsync`].
pub fn fdatasync(fd: Fd) -> Maybe<()> {
    flush(fd, Tag::fdatasync)
}

/// Does not move the file pointer.
pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
    let handle = handle_of(fd, Tag::ftruncate)?;
    let mut io: win32::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    let mut eof = win32::FILE_END_OF_FILE_INFORMATION { EndOfFile: len };
    // SAFETY: `handle` is a HANDLE value; the info struct matches the class.
    let status = unsafe {
        win32::ntdll::NtSetInformationFile(
            handle,
            &mut io,
            ptr::from_mut(&mut eof).cast(),
            core::mem::size_of::<win32::FILE_END_OF_FILE_INFORMATION>() as u32,
            win32::FILE_INFORMATION_CLASS::FileEndOfFileInformation,
        )
    };
    if !win32::NT_SUCCESS(status) {
        return Err(
            Error::from_win32(Win32Error::from_ntstatus(status), Tag::ftruncate).with_fd(fd),
        );
    }
    Ok(())
}

pub fn isatty(fd: Fd) -> bool {
    let handle = fd.native();
    handle != INVALID_HANDLE_VALUE
        && super::GetFileType(handle) == super::FILE_TYPE_CHAR
        && is_console(handle)
}

/// A pipe as `[read end, write end]`: HANDLE-kind, byte-mode, blocking
/// (not overlapped) and non-inheritable.
pub fn pipe() -> Maybe<[Fd; 2]> {
    pipe_impl().map_err(|e| Error::from_win32(e, Tag::pipe))
}

/// The `<n>` of the next `bun\<pid>-<n>` pipe name. One sequence for every
/// pipe this process names, so that two creators cannot pick the same.
pub fn next_pipe_serial() -> u64 {
    use core::sync::atomic::AtomicU64;
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    SERIAL.fetch_add(1, Ordering::Relaxed)
}

fn pipe_impl() -> Win32Result<[Fd; 2]> {
    use std::io::Write as _;

    let mut wide = [0u16; 97];
    let read_end = loop {
        // An AppContainer process may only create pipes under `LOCAL\`.
        let mut name = [0u8; 96];
        let name_len = {
            let mut cursor = std::io::Cursor::new(&mut name[..]);
            let _ = write!(
                cursor,
                "\\\\?\\pipe\\{}bun\\{}-{}",
                if super::is_app_container() {
                    "LOCAL\\"
                } else {
                    ""
                },
                super::GetCurrentProcessId(),
                next_pipe_serial(),
            );
            cursor.position() as usize
        };
        for (dst, src) in wide.iter_mut().zip(&name[..name_len]) {
            *dst = u16::from(*src);
        }
        wide[name_len] = 0;

        // The read end is the server so that both ends get FILE_READ_ATTRIBUTES.
        // SAFETY: `wide` is NUL-terminated.
        let read_end = unsafe {
            win32::kernel32::CreateNamedPipeW(
                wide.as_ptr(),
                win32::PIPE_ACCESS_INBOUND
                    | win32::WRITE_DAC
                    | win32::FILE_FLAG_FIRST_PIPE_INSTANCE,
                win32::PIPE_TYPE_BYTE
                    | win32::PIPE_READMODE_BYTE
                    | win32::PIPE_WAIT
                    | win32::PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                0,
                ptr::null_mut(),
            )
        };
        if read_end != INVALID_HANDLE_VALUE {
            break read_end;
        }
        match Win32Error::get() {
            // The name is somebody else's: FILE_FLAG_FIRST_PIPE_INSTANCE
            // refuses to join their pipe. Try the next one.
            Win32Error::PIPE_BUSY | Win32Error::ACCESS_DENIED => {}
            err => return Err(err),
        }
    };
    let read_end = OwnedHandle(read_end);

    let write_end = create_file(
        wide.as_ptr(),
        win32::GENERIC_WRITE | win32::FILE_READ_ATTRIBUTES | win32::WRITE_DAC,
        0,
        win32::OPEN_EXISTING,
        0,
    )?;

    // Both ends exist, so this does not block.
    // SAFETY: `read_end` is live; a null OVERLAPPED is valid for a
    // synchronous handle.
    if unsafe { win32::ConnectNamedPipe(read_end.0, ptr::null_mut()) } == 0 {
        let error = Win32Error::get();
        if error != Win32Error::PIPE_CONNECTED {
            return Err(error);
        }
    }

    let fds = [Fd::from_system(read_end.0), Fd::from_system(write_end.0)];
    core::mem::forget(read_end);
    core::mem::forget(write_end);
    Ok(fds)
}
