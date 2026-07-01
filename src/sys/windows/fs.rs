//! Native Windows fs syscall wrappers — the Windows twins of the POSIX free
//! fns, composed from the `bun_winfs` engines, WTF-8→WTF-16 path conversion,
//! and one-shot errno translation at this boundary. // quirk: FSMETA-48
//!
//! fd-based wrappers (`fstat`) land together with the fd-table module that
//! owns CRT-fd-free `Fd` resolution. // quirk: FSMETA-29

use bstr::BStr;
use bun_core::{Fd, Mode, WStr, ZStr};
use bun_paths::string_paths::try_to_kernel32_path;
use bun_windows_sys::Win32Error;
use bun_winfs::{OpenFlags, WindowsStat};

use super::{widepath_error_to_e, win_error};
use crate::{E, Error, Result, Tag};

bun_core::define_scoped_log!(log, crate::fd::SYS);

/// The engines take the terminator explicitly: re-slice a `WStr` (whose
/// invariant is `ptr[len] == 0`) to include it.
fn with_nul(w: &WStr) -> &[u16] {
    // SAFETY: `WStr`'s type invariant — `ptr[len]` is a readable 0.
    unsafe { core::slice::from_raw_parts(w.as_ptr(), w.len() + 1) }
}

fn stat_impl(path: &ZStr, tag: Tag, follow: bool) -> Result<WindowsStat> {
    let mut wbuf = bun_paths::os_path_buffer_pool::get();
    let wide = match try_to_kernel32_path(&mut *wbuf, path.as_bytes()) {
        Ok(w) => w,
        Err(e) => {
            return Err(Error::new(widepath_error_to_e(e), tag).with_path(path.as_bytes()));
        }
    };
    let mut st = WindowsStat::default();
    let r = if follow {
        bun_winfs::stat_path(with_nul(wide), &mut st)
    } else {
        bun_winfs::lstat_path(with_nul(wide), &mut st)
    };
    log!("{:?}({}) = {:?}", tag, BStr::new(path.as_bytes()), r);
    match r {
        Ok(()) => Ok(st),
        Err(w) => Err(Error::new(win_error::translate(w), tag).with_path(path.as_bytes())),
    }
}

pub fn stat(path: &ZStr) -> Result<WindowsStat> {
    stat_impl(path, Tag::stat, true)
}

pub fn lstat(path: &ZStr) -> Result<WindowsStat> {
    stat_impl(path, Tag::lstat, false)
}

/// The CRT umask, queried per open exactly as libuv does (fs.c:476-477's
/// set-zero-then-restore dance, including its benign race) so
/// `process.umask()` changes keep affecting later opens. // quirk: FSIO-08
fn current_umask() -> Mode {
    let prev = crate::umask(0);
    crate::umask(prev);
    prev
}

/// `bun_sys::O` keeps Linux-shaped octal values on every platform (the
/// portable currency all producers build); the engine speaks UCRT `_O_*`
/// bits. Translate at this boundary only — nowhere else.
fn open_flags_from_bun_o(flags: i32) -> OpenFlags {
    let mut f = OpenFlags((flags & 0o3) as u32);
    if flags & crate::O::CREAT != 0 {
        f |= OpenFlags::CREAT;
    }
    if flags & crate::O::EXCL != 0 {
        f |= OpenFlags::EXCL;
    }
    if flags & crate::O::TRUNC != 0 {
        f |= OpenFlags::TRUNC;
    }
    if flags & crate::O::APPEND != 0 {
        f |= OpenFlags::APPEND;
    }
    // bun-octal `O::SYNC` (0o4010000) contains the `O::DSYNC` bit (0o10000)
    // and the engine EINVALs SYNC+DSYNC together (FSIO-10) — emit exactly
    // one. Any overlap (so a DSYNC-only input too) becomes engine SYNC,
    // matching the deleted uv boundary (`uv::O::from_bun_o`).
    if flags & crate::O::SYNC != 0 {
        f |= OpenFlags::SYNC;
    }
    // uv-numbered high bits (DIRECT/DSYNC/SYNC/FILEMAP) arrive verbatim from
    // numeric JS flags via `bun_o_from_ucrt`; bun-octal values all sit below
    // 0x0080_0000, so forwarding the high range cannot alias.
    f |= OpenFlags(
        (flags as u32)
            & (OpenFlags::DIRECT.0 | OpenFlags::DSYNC.0 | OpenFlags::SYNC.0 | OpenFlags::FILEMAP.0),
    );
    f
}

/// Close a raw handle whose table adoption failed before ownership
/// transferred (classify errors — mint failures close internally).
fn close_raw_handle(h: bun_windows_sys::HANDLE) {
    // SAFETY: caller-owned live handle, closed exactly once here.
    unsafe { bun_windows_sys::CloseHandle(h) };
}

pub fn open(file_path: &ZStr, c_flags: i32, perm: Mode) -> Result<Fd> {
    let mut wbuf = bun_paths::os_path_buffer_pool::get();
    let wide = match try_to_kernel32_path(&mut *wbuf, file_path.as_bytes()) {
        Ok(w) => w,
        Err(e) => {
            return Err(
                Error::new(widepath_error_to_e(e), Tag::open).with_path(file_path.as_bytes())
            );
        }
    };
    // 0 means "unspecified": default 0644 or the file is created read-only
    // and unusable (matches the libuv-path behavior this replaces).
    let perm = if perm == 0 { 0o644 } else { perm };
    let readonly = (perm & !current_umask()) & 0o200 == 0;

    let flags = open_flags_from_bun_o(c_flags);
    let r = bun_winfs::open_path(with_nul(wide), flags, readonly);
    log!(
        "open({}, {:#x}) = {:?}",
        BStr::new(file_path.as_bytes()),
        c_flags,
        r
    );
    match r {
        Ok(h) => {
            // SAFETY: `h` is the handle open_path just returned; classify
            // does not close, so a classify failure must close it here.
            let kind = match unsafe { bun_fdtable::classify_handle(h) } {
                Ok(k) => k,
                Err(w) => {
                    close_raw_handle(h);
                    return Err(Error::new(win_error::translate(w), Tag::open)
                        .with_path(file_path.as_bytes()));
                }
            };
            let fdflags = if flags.0 & OpenFlags::APPEND.0 != 0 {
                bun_fdtable::FdFlags::APPEND
            } else {
                bun_fdtable::FdFlags::NONE
            };
            // SAFETY: same ownership transfer; on Err the handle is closed.
            let idx = unsafe { bun_fdtable::the().mint(h, kind, fdflags) }.map_err(|w| {
                Error::new(win_error::translate(w), Tag::open).with_path(file_path.as_bytes())
            })?;
            Ok(Fd::from_table_index(idx))
        }
        Err(w) => {
            // CreateFileW reports "create over an existing directory" as
            // FILE_EXISTS; POSIX wants EISDIR unless O_EXCL made EEXIST the
            // right answer. // quirk: FSIO-06
            let errno = if w == Win32Error::FILE_EXISTS
                && flags.0 & OpenFlags::CREAT.0 != 0
                && flags.0 & OpenFlags::EXCL.0 == 0
            {
                E::ISDIR
            } else {
                win_error::translate(w)
            };
            Err(Error::new(errno, Tag::open).with_path(file_path.as_bytes()))
        }
    }
}

/// Positioned op on a table fd: minted fds take the single-syscall path;
/// adopted fds get the save→I/O→restore bracket (their kernel pointer IS
/// their live sequential state, shared with the parent). // quirk: FSIO-21
fn positioned_table_io(
    idx: u32,
    op: impl FnOnce(bun_windows_sys::HANDLE) -> core::result::Result<usize, Win32Error>,
) -> core::result::Result<usize, Win32Error> {
    use bun_windows_sys::kernel32::SetFilePointerEx;
    use bun_windows_sys::{FILE_BEGIN, FILE_CURRENT};
    let ticket = bun_fdtable::the().positioned_io(idx)?;
    if !ticket.restore_pointer {
        return op(ticket.handle);
    }
    let mut saved: i64 = 0;
    // SAFETY: live handle per the ticket contract; out-param is a local.
    let have_saved =
        unsafe { SetFilePointerEx(ticket.handle, 0, &raw mut saved, FILE_CURRENT) } != 0;
    let r = op(ticket.handle);
    if have_saved {
        // Best-effort restore (FSIO-21's documented concession).
        // SAFETY: as above; null out-param is allowed.
        unsafe { SetFilePointerEx(ticket.handle, saved, core::ptr::null_mut(), FILE_BEGIN) };
    }
    r
}

/// `position < 0` selects sequential I/O — the same sentinel contract as the
/// libuv-path functions these replace. Table fds own a LOGICAL sequential
/// position (positioned ops never disturb it; the seek/write interleaving race is structurally
/// impossible); System fds use the kernel file pointer directly.
fn read_impl(fd: Fd, bufs: &mut [&mut [u8]], position: Option<u64>, tag: Tag) -> Result<usize> {
    let r = match fd.decode_windows() {
        // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
        bun_core::DecodeWindows::Windows(h) => unsafe { bun_winfs::read_at(h, bufs, position) },
        bun_core::DecodeWindows::Table(idx) => match position {
            None => {
                bun_fdtable::the().sequential_io(idx, bun_fdtable::IoDir::Read, |h, off| {
                    // SAFETY: the table holds the slot for the call.
                    unsafe { bun_winfs::read_at(h, bufs, off) }
                })
            }
            Some(pos) => positioned_table_io(idx, |h| {
                // SAFETY: live handle per the ticket contract.
                unsafe { bun_winfs::read_at(h, bufs, Some(pos)) }
            }),
        },
    };
    log!("{:?}({:?}, pos={:?}) = {:?}", tag, fd, position, r);
    match r {
        Ok(n) => Ok(n),
        // A canceled synchronous console read (CancelSynchronousIo on
        // Ctrl-C) is retried, preserving the long-standing stdin contract.
        Err(Win32Error::OPERATION_ABORTED) => read_impl(fd, bufs, position, tag),
        Err(w) => match win_error::classify_file_read(w) {
            // EOF-shaped failures are POSIX read() == 0. // quirk: FSIO-23
            win_error::ReadClass::Eof => Ok(0),
            win_error::ReadClass::Err(errno) => Err(Error::new(errno, tag).with_fd(fd)),
        },
    }
}

fn write_impl(fd: Fd, bufs: &[&[u8]], position: Option<u64>, tag: Tag) -> Result<usize> {
    let r = match fd.decode_windows() {
        // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
        bun_core::DecodeWindows::Windows(h) => unsafe { bun_winfs::write_at(h, bufs, position) },
        bun_core::DecodeWindows::Table(idx) => match position {
            None => {
                bun_fdtable::the().sequential_io(idx, bun_fdtable::IoDir::Write, |h, off| {
                    // SAFETY: the table holds the slot for the call.
                    unsafe { bun_winfs::write_at(h, bufs, off) }
                })
            }
            Some(pos) => positioned_table_io(idx, |h| {
                // SAFETY: live handle per the ticket contract.
                unsafe { bun_winfs::write_at(h, bufs, Some(pos)) }
            }),
        },
    };
    log!("{:?}({:?}, pos={:?}) = {:?}", tag, fd, position, r);
    match r {
        Ok(n) => Ok(n),
        // quirk: FSIO-24, FSIO-25
        Err(w) => Err(Error::new(win_error::classify_file_write(w), tag).with_fd(fd)),
    }
}

/// POSIX close semantics over the table: stdio slots are protected
/// (FSIO-16), stale fds are EBADF, and the engine closes the surrendered
/// handle. System-kind closes the raw handle directly.
pub fn close(fd: Fd) -> Option<Error> {
    let r: core::result::Result<(), Win32Error> = match fd.decode_windows() {
        bun_core::DecodeWindows::Table(idx) => match bun_fdtable::the().close(idx) {
            Ok(None) => Ok(()), // stdio: success without surrendering
            // SAFETY: the table surrendered the handle exactly once.
            Ok(Some(h)) => unsafe { bun_winfs::close(h) },
            Err(w) => Err(w),
        },
        // SAFETY: bun_sys contract — System fds are owned by the caller.
        bun_core::DecodeWindows::Windows(h) => unsafe { bun_winfs::close(h) },
    };
    log!("close({:?}) = {:?}", fd, r);
    match r {
        Ok(()) => None,
        Err(w) => Some(Error::new(win_error::translate(w), Tag::close).with_fd(fd)),
    }
}

/// `lseek(2)`. Table fds reposition through the table so the LOGICAL
/// sequential position moves (minted fds) or the kernel pointer moves
/// (ADOPTED fds); System fds seek the raw handle. `whence` is POSIX
/// SEEK_SET/CUR/END (== FILE_BEGIN/CURRENT/END).
pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Result<i64> {
    use bun_windows_sys::kernel32::SetFilePointerEx;
    let r: core::result::Result<u64, Win32Error> = match fd.decode_windows() {
        bun_core::DecodeWindows::Table(idx) => bun_fdtable::the().seek(idx, offset, whence as u32),
        bun_core::DecodeWindows::Windows(h) => {
            let mut new: i64 = 0;
            // SAFETY: bun_sys contract — the caller keeps `fd` open for the
            // call; `new` is an owned out-param.
            if unsafe { SetFilePointerEx(h, offset, &raw mut new, whence as u32) } == 0 {
                Err(Win32Error::get())
            } else {
                u64::try_from(new).map_err(|_| Win32Error::INVALID_PARAMETER)
            }
        }
    };
    log!("lseek({:?}, {}, {}) = {:?}", fd, offset, whence, r);
    match r {
        Ok(n) => Ok(n as i64),
        // The general table is row-for-row libuv parity, which has no 132
        // row; POSIX lseek-on-pipe/device is ESPIPE, so map it at this
        // boundary. // quirk: FSIO-21
        Err(Win32Error::SEEK_ON_DEVICE) => {
            Err(Error::new(bun_errno::SystemErrno::ESPIPE, Tag::lseek).with_fd(fd))
        }
        Err(w) => Err(Error::new(win_error::translate(w), Tag::lseek).with_fd(fd)),
    }
}

pub fn read(fd: Fd, buf: &mut [u8]) -> Result<usize> {
    read_impl(fd, &mut [buf], None, Tag::read)
}

pub fn pread(fd: Fd, buf: &mut [u8], position: i64) -> Result<usize> {
    read_impl(fd, &mut [buf], u64::try_from(position).ok(), Tag::pread)
}

pub fn write(fd: Fd, buf: &[u8]) -> Result<usize> {
    write_impl(fd, &[buf], None, Tag::write)
}

pub fn pwrite(fd: Fd, buf: &[u8], position: i64) -> Result<usize> {
    write_impl(fd, &[buf], u64::try_from(position).ok(), Tag::pwrite)
}

/// Vectored twins. Zero iovecs is EINVAL (the libuv contract this replaces);
/// the iovec structs are layout-pinned views the caller guarantees live for
/// the call. // quirk: FSIO-47
pub fn readv(fd: Fd, vecs: &[crate::PlatformIOVec]) -> Result<usize> {
    if vecs.is_empty() {
        return Err(Error::new(E::INVAL, Tag::readv).with_fd(fd));
    }
    // SAFETY: iovec contract — each (base, len) is a live writable buffer
    // for the duration of the call.
    let mut slices: Vec<&mut [u8]> = vecs
        .iter()
        .map(|v| unsafe { core::slice::from_raw_parts_mut(v.base, v.len) })
        .collect();
    read_impl(fd, &mut slices, None, Tag::readv)
}

pub fn writev(fd: Fd, vecs: &[crate::PlatformIOVec]) -> Result<usize> {
    if vecs.is_empty() {
        return Err(Error::new(E::INVAL, Tag::writev).with_fd(fd));
    }
    // SAFETY: iovec contract — each (base, len) is a live readable buffer
    // for the duration of the call.
    let slices: Vec<&[u8]> = vecs
        .iter()
        .map(|v| unsafe { core::slice::from_raw_parts(v.base.cast_const(), v.len) })
        .collect();
    write_impl(fd, &slices, None, Tag::writev)
}

pub fn preadv(fd: Fd, vecs: &[crate::PlatformIOVec], position: i64) -> Result<usize> {
    if vecs.is_empty() {
        return Err(Error::new(E::INVAL, Tag::preadv).with_fd(fd));
    }
    // SAFETY: iovec contract — each (base, len) is a live writable buffer
    // for the duration of the call.
    let mut slices: Vec<&mut [u8]> = vecs
        .iter()
        .map(|v| unsafe { core::slice::from_raw_parts_mut(v.base, v.len as usize) })
        .collect();
    read_impl(fd, &mut slices, u64::try_from(position).ok(), Tag::preadv)
}

pub fn pwritev(fd: Fd, vecs: &[crate::PlatformIoVecConst], position: i64) -> Result<usize> {
    if vecs.is_empty() {
        return Err(Error::new(E::INVAL, Tag::pwritev).with_fd(fd));
    }
    // SAFETY: iovec contract — each (base, len) is a live readable buffer
    // for the duration of the call.
    let slices: Vec<&[u8]> = vecs
        .iter()
        .map(|v| unsafe { core::slice::from_raw_parts(v.base, v.len as usize) })
        .collect();
    write_impl(fd, &slices, u64::try_from(position).ok(), Tag::pwritev)
}

pub fn fstat(fd: Fd) -> Result<WindowsStat> {
    let mut st = WindowsStat::default();
    // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
    let r = unsafe { bun_winfs::fstat_handle(fd.native(), &mut st) };
    log!("fstat({:?}) = {:?}", fd, r);
    match r {
        Ok(()) => Ok(st),
        // INVALID_HANDLE → EBADF via the general table. // quirk: FSMETA-29
        Err(w) => Err(Error::new(win_error::translate(w), Tag::fstat).with_fd(fd)),
    }
}

pub fn ftruncate(fd: Fd, len: i64) -> Result<()> {
    // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
    let r = unsafe { bun_winfs::ftruncate(fd.native(), len) };
    log!("ftruncate({:?}, {}) = {:?}", fd, len, r);
    r.map_err(|w| Error::new(win_error::translate(w), Tag::ftruncate).with_fd(fd))
}

pub fn fsync(fd: Fd) -> Result<()> {
    // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
    let r = unsafe { bun_winfs::fsync(fd.native()) };
    log!("fsync({:?}) = {:?}", fd, r);
    r.map_err(|w| Error::new(win_error::translate(w), Tag::fsync).with_fd(fd))
}

pub fn fdatasync(fd: Fd) -> Result<()> {
    // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
    let r = unsafe { bun_winfs::fdatasync(fd.native()) };
    log!("fdatasync({:?}) = {:?}", fd, r);
    r.map_err(|w| Error::new(win_error::translate(w), Tag::fdatasync).with_fd(fd))
}

/// Convert one path and run `f` on its wide form; errors carry `tag` + path.
fn with_wide<T>(
    path: &ZStr,
    tag: Tag,
    f: impl FnOnce(&[u16]) -> core::result::Result<T, Win32Error>,
) -> core::result::Result<T, Error> {
    let mut wbuf = bun_paths::os_path_buffer_pool::get();
    let wide = try_to_kernel32_path(&mut *wbuf, path.as_bytes())
        .map_err(|e| Error::new(widepath_error_to_e(e), tag).with_path(path.as_bytes()))?;
    f(with_nul(wide))
        .map_err(|w| Error::new(win_error::translate(w), tag).with_path(path.as_bytes()))
}

pub fn unlink(file_path: &ZStr) -> Result<()> {
    let r = with_wide(file_path, Tag::unlink, bun_winfs::unlink_path);
    log!(
        "unlink({}) = {:?}",
        BStr::new(file_path.as_bytes()),
        r.is_ok()
    );
    r
}

pub fn rmdir(file_path: &ZStr) -> Result<()> {
    let r = with_wide(file_path, Tag::rmdir, bun_winfs::rmdir_path);
    log!(
        "rmdir({}) = {:?}",
        BStr::new(file_path.as_bytes()),
        r.is_ok()
    );
    r
}

/// `mode` is accepted for cross-platform API parity and ignored, as libuv
/// does on Windows. // quirk: FSLNK-26
pub fn mkdir(file_path: &ZStr, _mode: Mode) -> Result<()> {
    let mut wbuf = bun_paths::os_path_buffer_pool::get();
    let wide = try_to_kernel32_path(&mut *wbuf, file_path.as_bytes()).map_err(|e| {
        Error::new(widepath_error_to_e(e), Tag::mkdir).with_path(file_path.as_bytes())
    })?;
    let r = bun_winfs::mkdir_path(with_nul(wide));
    log!(
        "mkdir({}) = {:?}",
        BStr::new(file_path.as_bytes()),
        r.is_ok()
    );
    r.map_err(|w| {
        // mkdir-local shapes: malformed names are EINVAL here, ENOENT
        // everywhere else (the general table's mapping). // quirk: FSLNK-26
        let errno = if w == Win32Error::INVALID_NAME {
            E::INVAL
        } else {
            win_error::translate(w)
        };
        Error::new(errno, Tag::mkdir).with_path(file_path.as_bytes())
    })
}

fn two_path_impl(
    a: &ZStr,
    b: &ZStr,
    tag: Tag,
    f: impl FnOnce(&[u16], &[u16]) -> core::result::Result<(), Win32Error>,
) -> Result<()> {
    let mut wa = bun_paths::os_path_buffer_pool::get();
    let mut wb = bun_paths::os_path_buffer_pool::get();
    let wide_a = try_to_kernel32_path(&mut *wa, a.as_bytes())
        .map_err(|e| Error::new(widepath_error_to_e(e), tag).with_path(a.as_bytes()))?;
    let wide_b = try_to_kernel32_path(&mut *wb, b.as_bytes())
        .map_err(|e| Error::new(widepath_error_to_e(e), tag).with_path(b.as_bytes()))?;
    f(with_nul(wide_a), with_nul(wide_b))
        .map_err(|w| Error::new(win_error::translate(w), tag).with_path(a.as_bytes()))
}

pub fn rename(from: &ZStr, to: &ZStr) -> Result<()> {
    // No rename-local remaps: the engine's fallback chain makes the general
    // table correct for every probed cell. // quirk: FSLNK-23
    let r = two_path_impl(from, to, Tag::rename, bun_winfs::rename_path);
    log!(
        "rename({} -> {}) = {:?}",
        BStr::new(from.as_bytes()),
        BStr::new(to.as_bytes()),
        r.is_ok()
    );
    r
}

pub fn link(from: &ZStr, to: &ZStr) -> Result<()> {
    // CreateHardLinkW argument order is (new, existing). // quirk: FSLNK-18
    let r = two_path_impl(from, to, Tag::link, |existing, new| {
        bun_winfs::link_path(existing, new)
    });
    log!(
        "link({} -> {}) = {:?}",
        BStr::new(from.as_bytes()),
        BStr::new(to.as_bytes()),
        r.is_ok()
    );
    r
}

/// `flags` are the `UV_FS_SYMLINK_*` bits, passed through bit-for-bit.
pub fn symlink(target: &ZStr, new_path: &ZStr, flags: i32) -> Result<()> {
    let mut wt = bun_paths::os_path_buffer_pool::get();
    let mut wn = bun_paths::os_path_buffer_pool::get();
    let tag = Tag::symlink;
    let wide_t = try_to_kernel32_path(&mut *wt, target.as_bytes())
        .map_err(|e| Error::new(widepath_error_to_e(e), tag).with_path(target.as_bytes()))?;
    let wide_n = try_to_kernel32_path(&mut *wn, new_path.as_bytes())
        .map_err(|e| Error::new(widepath_error_to_e(e), tag).with_path(new_path.as_bytes()))?;
    let r = bun_winfs::symlink_path(
        with_nul(wide_t),
        with_nul(wide_n),
        bun_winfs::SymlinkFlags(flags as u32),
    );
    log!(
        "symlink({} -> {}, {:#x}) = {:?}",
        BStr::new(target.as_bytes()),
        BStr::new(new_path.as_bytes()),
        flags,
        r.is_ok()
    );
    r.map_err(|w| {
        // symlink-local shapes: junction targets that cannot be represented
        // are EINVAL; missing privilege is EPERM. // quirk: FSLNK-12, FSLNK-13
        let errno = match w {
            Win32Error::NOT_SUPPORTED => E::INVAL,
            Win32Error::PRIVILEGE_NOT_HELD => E::PERM,
            other => win_error::translate(other),
        };
        Error::new(errno, tag).with_path(new_path.as_bytes())
    })
}

pub fn readlink<'a>(file_path: &ZStr, buf: &'a mut [u8]) -> Result<&'a mut ZStr> {
    let target = {
        let mut wbuf = bun_paths::os_path_buffer_pool::get();
        let wide = try_to_kernel32_path(&mut *wbuf, file_path.as_bytes()).map_err(|e| {
            Error::new(widepath_error_to_e(e), Tag::readlink).with_path(file_path.as_bytes())
        })?;
        bun_winfs::readlink_path(with_nul(wide)).map_err(|w| {
            // readlink on a non-link is EINVAL here only (the general table
            // maps the code elsewhere). // quirk: FSLNK-10
            let errno = if w == Win32Error::NOT_A_REPARSE_POINT {
                E::INVAL
            } else {
                win_error::translate(w)
            };
            Error::new(errno, Tag::readlink).with_path(file_path.as_bytes())
        })?
    };
    let len = match &target {
        // Raw WTF-16 out of the reparse buffer: WTF-8 encode so lone
        // surrogates survive the round trip. // quirk: FSLNK-09
        bun_winfs::ReadlinkTarget::Wide(w16) => {
            let r = bun_core::strings::copy_wtf16_into_wtf8(buf, w16);
            if (r.read as usize) < w16.len() || (r.written as usize) >= buf.len() {
                return Err(
                    Error::new(E::NAMETOOLONG, Tag::readlink).with_path(file_path.as_bytes())
                );
            }
            r.written as usize
        }
        // LX symlink targets are raw Linux bytes, passed through verbatim
        // (they may not be UTF-8). // quirk: FSLNK-05
        bun_winfs::ReadlinkTarget::Bytes(b) => {
            if b.len() >= buf.len() {
                return Err(
                    Error::new(E::NAMETOOLONG, Tag::readlink).with_path(file_path.as_bytes())
                );
            }
            buf[..b.len()].copy_from_slice(b);
            b.len()
        }
    };
    buf[len] = 0;
    log!(
        "readlink({}) = {} bytes",
        BStr::new(file_path.as_bytes()),
        len
    );
    // SAFETY: buf[len] == 0 written above; buf[0..len] is initialized.
    Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) })
}

// ── fsmisc-engine wrappers ──────────────────────────────────────────────────

pub use bun_winfs::FileTimeSpec;

/// UCRT `_O_*` numeric flags (what `fs.constants` exposes on Windows)
/// → the portable bun-octal `O` values. Inverse of the open boundary's
/// `open_flags_from_bun_o`; SYNC/DSYNC/DIRECT pass through by value (the
/// uv numbering, kept as protocol — bun-octal has the same spellings).
pub fn bun_o_from_ucrt(ucrt: i32) -> i32 {
    const UCRT_WRONLY: i32 = 0x0001;
    const UCRT_RDWR: i32 = 0x0002;
    const UCRT_APPEND: i32 = 0x0008;
    const UCRT_CREAT: i32 = 0x0100;
    const UCRT_TRUNC: i32 = 0x0200;
    const UCRT_EXCL: i32 = 0x0400;
    const DIRECT: i32 = 0x0200_0000;
    const DSYNC: i32 = 0x0400_0000;
    const SYNC: i32 = 0x0800_0000;
    const FILEMAP: i32 = 0x2000_0000;
    let mut o = 0;
    if ucrt & UCRT_WRONLY != 0 {
        o |= crate::O::WRONLY;
    }
    if ucrt & UCRT_RDWR != 0 {
        o |= crate::O::RDWR;
    }
    if ucrt & UCRT_CREAT != 0 {
        o |= crate::O::CREAT;
    }
    if ucrt & UCRT_EXCL != 0 {
        o |= crate::O::EXCL;
    }
    if ucrt & UCRT_TRUNC != 0 {
        o |= crate::O::TRUNC;
    }
    if ucrt & UCRT_APPEND != 0 {
        o |= crate::O::APPEND;
    }
    // SYNC/DSYNC/DIRECT/FILEMAP have no bun-octal spelling on Windows —
    // pass the uv-numbered bits through unchanged (fs.constants protocol).
    o |= ucrt & (SYNC | DSYNC | DIRECT | FILEMAP);
    o
}

/// `symlink` flag values (the uv_fs_symlink numbering, kept as protocol).
pub const SYMLINK_DIR: i32 = bun_winfs::SymlinkFlags::DIR.0 as i32;
pub const SYMLINK_JUNCTION: i32 = bun_winfs::SymlinkFlags::JUNCTION.0 as i32;

pub fn utimes(path: &ZStr, atime: FileTimeSpec, mtime: FileTimeSpec) -> Result<()> {
    let r = with_wide(path, Tag::utime, |w| {
        bun_winfs::utimes_path(w, atime, mtime)
    });
    log!("utimes({}) = {:?}", BStr::new(path.as_bytes()), r.is_ok());
    r
}

pub fn lutimes(path: &ZStr, atime: FileTimeSpec, mtime: FileTimeSpec) -> Result<()> {
    let r = with_wide(path, Tag::lutime, |w| {
        bun_winfs::lutimes_path(w, atime, mtime)
    });
    log!("lutimes({}) = {:?}", BStr::new(path.as_bytes()), r.is_ok());
    r
}

pub fn futimes(fd: Fd, atime: FileTimeSpec, mtime: FileTimeSpec) -> Result<()> {
    // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
    let r = unsafe { bun_winfs::futimes_handle(fd.native(), atime, mtime) };
    log!("futimes({:?}) = {:?}", fd, r.is_ok());
    r.map_err(|w| Error::new(win_error::translate(w), Tag::futime).with_fd(fd))
}

/// POSIX writable-bit semantics: only `0o200` maps onto Windows READONLY.
/// // quirk: FSMETA-36
pub fn chmod(path: &ZStr, mode: Mode) -> Result<()> {
    let readonly = mode & 0o200 == 0;
    let r = with_wide(path, Tag::chmod, |w| bun_winfs::chmod_path(w, readonly));
    log!(
        "chmod({}, {:o}) = {:?}",
        BStr::new(path.as_bytes()),
        mode,
        r.is_ok()
    );
    r
}

pub fn fchmod(fd: Fd, mode: Mode) -> Result<()> {
    let readonly = mode & 0o200 == 0;
    // SAFETY: bun_sys contract — the caller keeps `fd` open for the call.
    let r = unsafe { bun_winfs::fchmod_handle(fd.native(), readonly) };
    log!("fchmod({:?}, {:o}) = {:?}", fd, mode, r.is_ok());
    r.map_err(|w| Error::new(win_error::translate(w), Tag::fchmod).with_fd(fd))
}

// Ownership is a no-op on Windows (libuv parity). // quirk: FSMETA-46
pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Result<()> {
    with_wide(path, Tag::chown, |w| bun_winfs::chown_path(w, uid, gid))
}
pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Result<()> {
    with_wide(path, Tag::lchown, |w| bun_winfs::lchown_path(w, uid, gid))
}
pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Result<()> {
    bun_winfs::fchown_handle(fd.native(), uid, gid)
        .map_err(|w| Error::new(win_error::translate(w), Tag::fchown).with_fd(fd))
}

pub fn access(path: &ZStr, mode: i32) -> Result<()> {
    let r = with_wide(path, Tag::access, |w| {
        bun_winfs::access_path(w, bun_winfs::AccessMode(mode as u32))
    });
    log!(
        "access({}, {}) = {:?}",
        BStr::new(path.as_bytes()),
        mode,
        r.is_ok()
    );
    r
}

/// The engine yields the raw NT-prefixed final path; the canonical prefix
/// rewrite runs exactly once here, then WTF-8 encodes into `buf`.
/// // quirk: FSMETA-42
pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Result<&'a [u8]> {
    let mut wide = {
        let mut wbuf = bun_paths::os_path_buffer_pool::get();
        let w = try_to_kernel32_path(&mut *wbuf, path.as_bytes()).map_err(|e| {
            Error::new(widepath_error_to_e(e), Tag::realpath).with_path(path.as_bytes())
        })?;
        bun_winfs::realpath_path(with_nul(w)).map_err(|w| {
            Error::new(win_error::translate(w), Tag::realpath).with_path(path.as_bytes())
        })?
    };
    let (_, rewritten) = bun_core::util::rewrite_final_path_prefix(&mut wide);
    let r = bun_core::strings::copy_wtf16_into_wtf8(&mut buf.0, rewritten);
    if (r.read as usize) < rewritten.len() {
        return Err(Error::new(E::NAMETOOLONG, Tag::realpath).with_path(path.as_bytes()));
    }
    let len = r.written as usize;
    log!("realpath({}) = {} bytes", BStr::new(path.as_bytes()), len);
    Ok(&buf.0[..len])
}

pub fn statfs(path: &ZStr) -> Result<bun_winfs::WindowsStatFs> {
    let mut out = bun_winfs::WindowsStatFs::default();
    with_wide(path, Tag::statfs, |w| bun_winfs::statfs_path(w, &mut out))?;
    log!("statfs({}) ok", BStr::new(path.as_bytes()));
    Ok(out)
}

pub fn copyfile(from: &ZStr, to: &ZStr, flags: i32) -> Result<()> {
    let r = two_path_impl(from, to, Tag::copyfile, |a, b| {
        bun_winfs::copyfile_path(a, b, bun_winfs::CopyFileFlags(flags as u32))
    });
    // FICLONE_FORCE rejection is ENOSYS here only (the general table must
    // not gain a NOT_SUPPORTED row). // quirk: FSMETA-50
    match r {
        Err(e)
            if flags & 4 != 0
                && e.get_errno() == win_error::translate(Win32Error::NOT_SUPPORTED) =>
        {
            Err(Error::new(E::NOSYS, Tag::copyfile).with_path(from.as_bytes()))
        }
        other => other,
    }
}

/// Appends the WTF-8 generated directory path into `out`.
pub fn mkdtemp(template: &ZStr, out: &mut Vec<u8>) -> Result<()> {
    let mut wide = with_wide(template, Tag::mkdtemp, bun_winfs::mkdtemp_path)?;
    // Strip the engine's verbatim spelling — callers expect the user shape.
    let (_, rewritten) = bun_core::util::rewrite_final_path_prefix(&mut wide);
    bun_core::strings::convert_wtf16_to_wtf8_append(out, rewritten);
    Ok(())
}

/// Creates + opens the unique file; the handle is minted into the fd table
/// (CRT-free mkstemp). Returns the table-kind `Fd`; the name is appended
/// WTF-8 into `out`.
pub fn mkstemp(template: &ZStr, out: &mut Vec<u8>) -> Result<Fd> {
    let (mut wide, handle) = with_wide(template, Tag::mkstemp, bun_winfs::mkstemp_path)?;
    // Strip the engine's verbatim spelling — callers expect the user shape.
    let (_, rewritten) = bun_core::util::rewrite_final_path_prefix(&mut wide);
    bun_core::strings::convert_wtf16_to_wtf8_append(out, rewritten);
    // SAFETY: classify does not close, so a classify failure closes the
    // just-created handle here; mint closes it on its own failure below.
    let kind = match unsafe { bun_fdtable::classify_handle(handle) } {
        Ok(k) => k,
        Err(w) => {
            close_raw_handle(handle);
            return Err(
                Error::new(win_error::translate(w), Tag::mkstemp).with_path(template.as_bytes())
            );
        }
    };
    // SAFETY: `handle` was just created by the engine; ownership transfers to
    // mint (which closes it on failure).
    let idx = unsafe { bun_fdtable::the().mint(handle, kind, bun_fdtable::FdFlags::NONE) }
        .map_err(|w| {
            Error::new(win_error::translate(w), Tag::mkstemp).with_path(template.as_bytes())
        })?;
    Ok(Fd::from_table_index(idx))
}

/// C polyfill bridge (`uv_get_osfhandle`): JS-visible fd numbers are table
/// indices — the table answers fd→HANDLE. INVALID_HANDLE_VALUE on a dead or
/// out-of-range index (the uv contract for bad fds).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__FdTable__nativeHandle(fd: i32) -> *mut core::ffi::c_void {
    if fd < 0 {
        return usize::MAX as *mut core::ffi::c_void;
    }
    Fd::from_js_fd(fd).native().cast()
}
