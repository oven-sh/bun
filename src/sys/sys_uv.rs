//! bun.sys.sys_uv is a polyfill of bun.sys but with libuv.
//! TODO: Probably should merge this into bun.sys itself with isWindows checks
#![cfg(windows)]

use core::ffi::{CStr, c_char, c_int, c_uint};

use bstr::BStr;

use bun_core::ZStr;

use crate::Tag;
use crate::windows::libuv as uv;
use crate::{E, Fd, FdExt, Mode, PlatformIOVec, PlatformIOVecConst, Stat, StatFS};
// `ReturnCodeExt::err_enum_e` overlays the libuv→POSIX errno translation that
// Zig's `ReturnCode::errno()` does inline; without it the raw `UV_E*` magnitude
// (e.g. 4058 for UV_ENOENT) would land in `Error.errno` and break callers that
// compare against `E::NOENT as _`.
use crate::ReturnCodeExt;

/// `Maybe(T)` from Zig.
type Result<T> = crate::Result<T>;

// `pub const log = bun.sys.syslog;`
// In Rust the scoped log is a macro; re-export the crate macro and alias locally.
pub use crate::syslog;
bun_core::define_scoped_log!(log, crate::fd::SYS);

pub use crate::Error;
pub use crate::PosixStat;

// libuv dont support openat (https://github.com/libuv/libuv/issues/4167)
pub use crate::access;
pub use crate::get_fd_path;
pub use crate::openat;
pub use crate::openat_os_path;
pub use crate::set_file_offset;
// sys_uv.zig re-exports the bun.sys versions of these (libuv has no
// equivalent or `bun.sys` already routes through Win32 directly).
pub use crate::lseek;
pub use crate::symlink;
pub use crate::unlinkat;
pub use crate::unlinkat_with_flags;
// Zig: `pub const mkdirOSPath = bun.sys.mkdirOSPath;` — on Windows that's the
// WTF-16 `CreateDirectoryW` wrapper (handles unpaired surrogates / `\\?\` long
// paths). Wrap the real port (`mkdir_w`), NOT the UTF-8 `mkdir`, so callers
// passing an `OSPathSlice` keep WTF-16 semantics.
//
// Spec: `pub fn mkdirOSPath(file_path: bun.OSPathSliceZ, flags: mode_t) Maybe(void)`
// (sys.zig:939). The `flags` param is ignored on Windows (`_ = flags;`) but is
// part of the public 2-arg signature, so we cannot `pub use mkdir_w as ...` —
// that would drop the second arg and break Zig-ported callers that pass a mode.
#[inline]
pub fn mkdir_os_path(file_path: &bun_core::WStr, flags: Mode) -> Result<()> {
    let _ = flags;
    crate::mkdir_w(file_path)
}

// Note: `req = undefined; req.deinit()` has a safety-check in a debug build

/// RAII owner for a synchronous `uv_fs_t` request.
///
/// `uv_fs_t` becomes **self-referential** after `uv_fs_read`/`uv_fs_write` with
/// `nbufs <= 4`: libuv points `req->fs.info.bufs` at the inline
/// `req->fs.info.bufsml[4]` array (vendor/libuv/src/win/fs.c:3291). If the
/// struct is bitwise-moved before `uv_fs_req_cleanup`, the cleanup check
/// `if (bufs != bufsml) uv__free(bufs);` (fs.c:3237) sees the *old* stack
/// address ≠ the *new* `bufsml` slot and frees a stack pointer — heap UB.
///
/// `scopeguard::guard(fs_t, |mut r| r.deinit())` triggers exactly that move
/// (its `Drop` `ManuallyDrop::take`s the value into the closure arg), so we
/// instead give the request a real `Drop` impl: Rust calls `Drop::drop` *in
/// place* at the original address, so `bufs == bufsml` still holds and cleanup
/// is sound. Do **not** move an `FsReq` after passing it to libuv.
#[repr(transparent)]
struct FsReq(uv::fs_t);

impl FsReq {
    #[inline]
    fn new() -> Self {
        Self(uv::fs_t::uninitialized())
    }
}

impl Drop for FsReq {
    #[inline]
    fn drop(&mut self) {
        self.0.deinit();
    }
}

impl core::ops::Deref for FsReq {
    type Target = uv::fs_t;
    #[inline]
    fn deref(&self) -> &uv::fs_t {
        &self.0
    }
}

impl core::ops::DerefMut for FsReq {
    #[inline]
    fn deref_mut(&mut self) -> &mut uv::fs_t {
        &mut self.0
    }
}

pub fn open(file_path: &ZStr, c_flags: i32, perm_: Mode) -> Result<Fd> {
    // Zig: `defer req.deinit();` — libuv heap-allocates the WCHAR path copy
    // (`fs__capture_path`) and only `uv_fs_req_cleanup` frees it. `FsReq`'s
    // `Drop` runs cleanup in place on every return path (see `FsReq` doc for
    // why a by-value scopeguard is unsound here).
    let mut req = FsReq::new();

    let flags = uv::O::from_bun_o(c_flags);

    let mut perm = perm_;
    if perm == 0 {
        // Set a sensible default, otherwise on windows the file will be unusable
        perm = 0o644;
    }

    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe {
        uv::uv_fs_open(
            uv::Loop::get(),
            &mut *req,
            file_path.as_ptr(),
            flags,
            perm as c_int,
            None,
        )
    };
    log!(
        "uv open({}, {}, {}) = {}",
        BStr::new(file_path.as_bytes()),
        flags,
        perm,
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::open).with_path(file_path.as_bytes()))
    } else {
        Result::Ok(Fd::from_uv(req.result.to_fd()))
    }
}

pub fn mkdir(file_path: &ZStr, flags: Mode) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe {
        uv::uv_fs_mkdir(
            uv::Loop::get(),
            &mut *req,
            file_path.as_ptr(),
            flags as c_int,
            None,
        )
    };

    log!(
        "uv mkdir({}, {}) = {}",
        BStr::new(file_path.as_bytes()),
        flags,
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::mkdir).with_path(file_path.as_bytes()))
    } else {
        Result::Ok(())
    }
}

pub fn chmod(file_path: &ZStr, flags: Mode) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();

    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe {
        uv::uv_fs_chmod(
            uv::Loop::get(),
            &mut *req,
            file_path.as_ptr(),
            flags as c_int,
            None,
        )
    };

    log!(
        "uv chmod({}, {}) = {}",
        BStr::new(file_path.as_bytes()),
        flags,
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::chmod).with_path(file_path.as_bytes()))
    } else {
        Result::Ok(())
    }
}

pub fn fchmod(fd: Fd, flags: Mode) -> Result<()> {
    let uv_fd = fd.uv();
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_fchmod(uv::Loop::get(), &mut *req, uv_fd, flags as c_int, None) };

    log!("uv fchmod({}, {}) = {}", uv_fd, flags, rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::fchmod).with_fd(fd))
    } else {
        Result::Ok(())
    }
}

pub fn statfs(file_path: &ZStr) -> Result<StatFS> {
    // Zig: `defer req.deinit();` — `uv_fs_statfs` heap-allocates the
    // `uv_statfs_t` result into `req.ptr` (plus the WCHAR path copy); only
    // `uv_fs_req_cleanup` frees them. Guard so both success and error paths
    // free.
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_statfs(uv::Loop::get(), &mut *req, file_path.as_ptr(), None) };

    log!(
        "uv statfs({}) = {}",
        BStr::new(file_path.as_bytes()),
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::statfs).with_path(file_path.as_bytes()))
    } else {
        // SAFETY: on success, req.ptr points to a uv_statfs_t (layout-compatible with StatFS).
        // Zig used `*align(1)` — read_unaligned to match.
        // PORT: on Windows `StatFS == uv_statfs_t`, so the libuv result *is* the
        // public type — no Zig-side `.init(*align(1) StatFS)` wrapper to call.
        // SAFETY: libuv guarantees `req.ptr` points to a valid `uv_statfs_t`
        // on success; we read it by value (Zig used `*align(1)` → unaligned).
        // The value is copied out *before* `FsReq::drop` runs `uv_fs_req_cleanup`
        // and frees the backing allocation.
        let p = unsafe { req.ptr_as::<StatFS>() };
        Result::Ok(unsafe { core::ptr::read_unaligned(p) })
    }
}

pub fn chown(file_path: &ZStr, uid: uv::uv_uid_t, gid: uv::uv_uid_t) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe {
        uv::uv_fs_chown(
            uv::Loop::get(),
            &mut *req,
            file_path.as_ptr(),
            uid,
            gid,
            None,
        )
    };

    log!(
        "uv chown({}, {}, {}) = {}",
        BStr::new(file_path.as_bytes()),
        uid,
        gid,
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::chown).with_path(file_path.as_bytes()))
    } else {
        Result::Ok(())
    }
}

pub fn fchown(fd: Fd, uid: uv::uv_uid_t, gid: uv::uv_uid_t) -> Result<()> {
    let uv_fd = fd.uv();

    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_fchown(uv::Loop::get(), &mut *req, uv_fd, uid, gid, None) };

    log!("uv chown({}, {}, {}) = {}", uv_fd, uid, gid, rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::fchown).with_fd(fd))
    } else {
        Result::Ok(())
    }
}

pub fn rmdir(file_path: &ZStr) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_rmdir(uv::Loop::get(), &mut *req, file_path.as_ptr(), None) };

    log!(
        "uv rmdir({}) = {}",
        BStr::new(file_path.as_bytes()),
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::rmdir).with_path(file_path.as_bytes()))
    } else {
        Result::Ok(())
    }
}

pub fn unlink(file_path: &ZStr) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_unlink(uv::Loop::get(), &mut *req, file_path.as_ptr(), None) };

    log!(
        "uv unlink({}) = {}",
        BStr::new(file_path.as_bytes()),
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::unlink).with_path(file_path.as_bytes()))
    } else {
        Result::Ok(())
    }
}

pub fn readlink<'a>(file_path: &ZStr, buf: &'a mut [u8]) -> Result<&'a mut ZStr> {
    // Zig: `defer req.deinit();` — `uv_fs_readlink` heap-allocates the target
    // string into `req.ptr` (plus the WCHAR path copy); only `uv_fs_req_cleanup`
    // frees them. The guard covers all four return paths below; the bytes are
    // copied into `buf` *before* the guard runs.
    let mut req = FsReq::new();
    // Edge cases: http://docs.libuv.org/en/v1.x/fs.html#c.uv_fs_realpath
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_readlink(uv::Loop::get(), &mut *req, file_path.as_ptr(), None) };

    if let Some(errno) = rc.err_enum_e() {
        log!(
            "uv readlink({}) = {}, [err]",
            BStr::new(file_path.as_bytes()),
            rc.int()
        );
        return Result::Err(Error::new(errno, Tag::readlink).with_path(file_path.as_bytes()));
    } else {
        // Seems like `rc` does not contain the size?
        debug_assert!(rc.int() == 0);
        let result_ptr: *mut c_char = unsafe { req.ptr_as::<c_char>() } as *mut c_char;
        let Some(result_ptr) = (!result_ptr.is_null()).then_some(result_ptr) else {
            return Result::Err(
                Error::new(E::NOENT, Tag::readlink).with_path(file_path.as_bytes()),
            );
        };
        // SAFETY: libuv guarantees req.ptr is a NUL-terminated string on success.
        let slice = unsafe { bun_core::ffi::cstr(result_ptr) }.to_bytes();
        // Reserve one byte for the NUL sentinel below. When slice.len == buf.len
        // there is no room for it and buf[slice.len] = 0 would be out of bounds.
        if slice.len() >= buf.len() {
            log!(
                "uv readlink({}) = {}, {} TRUNCATED",
                BStr::new(file_path.as_bytes()),
                rc.int(),
                BStr::new(slice)
            );
            return Result::Err(
                Error::new(E::NAMETOOLONG, Tag::readlink).with_path(file_path.as_bytes()),
            );
        }
        log!(
            "uv readlink({}) = {}, {}",
            BStr::new(file_path.as_bytes()),
            rc.int(),
            BStr::new(slice)
        );
        let len = slice.len();
        buf[0..len].copy_from_slice(slice);
        buf[len] = 0;
        // SAFETY: buf[len] == 0 written above; buf[0..len] is valid.
        return Result::Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) });
    }
}

pub fn rename(from: &ZStr, to: &ZStr) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc =
        unsafe { uv::uv_fs_rename(uv::Loop::get(), &mut *req, from.as_ptr(), to.as_ptr(), None) };

    log!(
        "uv rename({}, {}) = {}",
        BStr::new(from.as_bytes()),
        BStr::new(to.as_bytes()),
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        // which one goes in the .path field?
        Result::Err(Error::new(errno, Tag::rename))
    } else {
        Result::Ok(())
    }
}

pub fn link(from: &ZStr, to: &ZStr) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc =
        unsafe { uv::uv_fs_link(uv::Loop::get(), &mut *req, from.as_ptr(), to.as_ptr(), None) };

    log!(
        "uv link({}, {}) = {}",
        BStr::new(from.as_bytes()),
        BStr::new(to.as_bytes()),
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(
            Error::new(errno, Tag::link)
                .with_path(from.as_bytes())
                .with_dest(to.as_bytes()),
        )
    } else {
        Result::Ok(())
    }
}

pub fn symlink_uv(target: &ZStr, new_path: &ZStr, flags: c_int) -> Result<()> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe {
        uv::uv_fs_symlink(
            uv::Loop::get(),
            &mut *req,
            target.as_ptr(),
            new_path.as_ptr(),
            flags,
            None,
        )
    };

    log!(
        "uv symlink({}, {}) = {}",
        BStr::new(target.as_bytes()),
        BStr::new(new_path.as_bytes()),
        rc.int()
    );
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::symlink))
    } else {
        Result::Ok(())
    }
}

pub fn ftruncate(fd: Fd, size: i64) -> Result<()> {
    // Zig spec types `size: isize` (= i64 on every supported Windows target);
    // accept `i64` directly so this matches the cross-platform `bun_sys::ftruncate`
    // signature and callers don't need a per-platform `as isize` cast.
    let uv_fd = fd.uv();
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_ftruncate(uv::Loop::get(), &mut *req, uv_fd, size, None) };

    log!("uv ftruncate({}, {}) = {}", uv_fd, size, rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::ftruncate).with_fd(fd))
    } else {
        Result::Ok(())
    }
}

pub fn fstat(fd: Fd) -> Result<Stat> {
    let uv_fd = fd.uv();
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_fstat(uv::Loop::get(), &mut *req, uv_fd, None) };

    log!("uv fstat({}) = {}", uv_fd, rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::fstat).with_fd(fd))
    } else {
        // `statbuf` is inline in `fs_t` (not heap), copied out before deinit.
        Result::Ok(req.statbuf)
    }
}

pub fn fdatasync(fd: Fd) -> Result<()> {
    let uv_fd = fd.uv();
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_fdatasync(uv::Loop::get(), &mut *req, uv_fd, None) };

    log!("uv fdatasync({}) = {}", uv_fd, rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::fdatasync).with_fd(fd))
    } else {
        Result::Ok(())
    }
}

pub fn fsync(fd: Fd) -> Result<()> {
    let uv_fd = fd.uv();
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_fsync(uv::Loop::get(), &mut *req, uv_fd, None) };

    log!("uv fsync({}) = {}", uv_fd, rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::fsync).with_fd(fd))
    } else {
        Result::Ok(())
    }
}

pub fn stat(path: &ZStr) -> Result<Stat> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_stat(uv::Loop::get(), &mut *req, path.as_ptr(), None) };

    log!("uv stat({}) = {}", BStr::new(path.as_bytes()), rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::stat).with_path(path.as_bytes()))
    } else {
        // `statbuf` is inline in `fs_t` (not heap), copied out before deinit.
        Result::Ok(req.statbuf)
    }
}

pub fn lstat(path: &ZStr) -> Result<Stat> {
    // Zig: `defer req.deinit();`
    let mut req = FsReq::new();
    // SAFETY: synchronous libuv fs call; req lives on the stack for the duration.
    let rc = unsafe { uv::uv_fs_lstat(uv::Loop::get(), &mut *req, path.as_ptr(), None) };

    log!("uv lstat({}) = {}", BStr::new(path.as_bytes()), rc.int());
    if let Some(errno) = rc.err_enum_e() {
        Result::Err(Error::new(errno, Tag::lstat).with_path(path.as_bytes()))
    } else {
        // `statbuf` is inline in `fs_t` (not heap), copied out before deinit.
        Result::Ok(req.statbuf)
    }
}

pub fn close(fd: Fd) -> Option<Error> {
    // TODO(port): @returnAddress() — Rust has no stable equivalent; pass None for now.
    fd.close_allowing_bad_file_descriptor(None)
}

pub fn close_allowing_stdout_and_stderr(fd: Fd) -> Option<Error> {
    // TODO(port): @returnAddress() — Rust has no stable equivalent; pass None for now.
    fd.close_allowing_standard_io(None)
}

/// Maximum number of iovec buffers that can be passed to uv_fs_read/uv_fs_write.
/// libuv uses c_uint for nbufs, so we must not exceed its maximum value.
const MAX_IOVEC_COUNT: usize = c_uint::MAX as usize;

/// Maximum size of a single buffer in uv_buf_t.
/// libuv uses ULONG (u32) for the buffer length on Windows.
const MAX_BUF_LEN: usize = u32::MAX as usize;

/// Returns the total byte capacity of a slice of iovec buffers.
fn sum_bufs_len(bufs: &[PlatformIOVec]) -> usize {
    let mut total: usize = 0;
    for buf in bufs {
        total += buf.len as usize;
    }
    total
}

pub fn preadv(fd: Fd, bufs: &[PlatformIOVec], position: i64) -> Result<usize> {
    let uv_fd = fd.uv();
    // TODO(port): comptime bun.assert(bun.PlatformIOVec == uv.uv_buf_t) — static type-eq assert
    const _: () = assert!(
        core::mem::size_of::<PlatformIOVec>() == core::mem::size_of::<uv::uv_buf_t>()
            && core::mem::align_of::<PlatformIOVec>() == core::mem::align_of::<uv::uv_buf_t>()
    );

    let debug_timer = bun_core::Output::DebugTimer::start();

    let mut total_read: usize = 0;
    let mut remaining_bufs = bufs;
    let mut current_position = position;

    while !remaining_bufs.is_empty() {
        let chunk_len = remaining_bufs.len().min(MAX_IOVEC_COUNT);
        let chunk_bufs = &remaining_bufs[0..chunk_len];

        // Zig: `defer req.deinit();` — `uv_fs_read` heap-allocates
        // `req->fs.info.bufs` when `nbufs > 4` and self-points it at
        // `req->fs.info.bufsml` when `nbufs <= 4`; `FsReq::drop` runs
        // `uv_fs_req_cleanup` in place every iteration (early-return included).
        let mut req = FsReq::new();

        // The int return value of uv_fs_read truncates req.result (ssize_t) and
        // wraps negative when bytes read > INT_MAX, so use req.result directly.
        // SAFETY: synchronous libuv fs call; req and chunk_bufs live on the stack.
        let _ = unsafe {
            uv::uv_fs_read(
                uv::Loop::get(),
                &mut *req,
                uv_fd,
                chunk_bufs.as_ptr(),
                c_uint::try_from(chunk_len).expect("int cast"),
                current_position,
                None,
            )
        };

        let chunk_capacity = sum_bufs_len(chunk_bufs);

        if cfg!(debug_assertions) {
            log!(
                "uv read({}, {} total bytes) = {} ({})",
                uv_fd,
                chunk_capacity,
                req.result.int(),
                debug_timer
            );
        }

        if let Some(e) = req.result.err_enum_e() {
            return Result::Err(Error::new(e, Tag::read).with_fd(fd));
        }

        let bytes_read: usize = usize::try_from(req.result.int()).expect("int cast");
        total_read += bytes_read;

        // If we read less than requested, we're done (EOF or partial read)
        if bytes_read == 0 || bytes_read < chunk_capacity {
            break;
        }

        remaining_bufs = &remaining_bufs[chunk_len..];

        // Update position for the next chunk (if position tracking is enabled)
        if current_position >= 0 {
            current_position += i64::try_from(bytes_read).expect("int cast");
        }
    }

    Result::Ok(total_read)
}

pub fn pwritev(fd: Fd, bufs: &[PlatformIOVecConst], position: i64) -> Result<usize> {
    let uv_fd = fd.uv();
    // TODO(port): comptime bun.assert(bun.PlatformIOVec == uv.uv_buf_t) — static type-eq assert
    const _: () = assert!(
        core::mem::size_of::<PlatformIOVec>() == core::mem::size_of::<uv::uv_buf_t>()
            && core::mem::align_of::<PlatformIOVec>() == core::mem::align_of::<uv::uv_buf_t>()
    );

    let debug_timer = bun_core::Output::DebugTimer::start();

    let mut total_written: usize = 0;
    let mut remaining_bufs = bufs;
    let mut current_position = position;

    while !remaining_bufs.is_empty() {
        let chunk_len = remaining_bufs.len().min(MAX_IOVEC_COUNT);
        let chunk_bufs = &remaining_bufs[0..chunk_len];

        // Zig: `defer req.deinit();` — `uv_fs_write` heap-allocates
        // `req->fs.info.bufs` when `nbufs > 4` and self-points it at
        // `req->fs.info.bufsml` when `nbufs <= 4`; `FsReq::drop` runs
        // `uv_fs_req_cleanup` in place every iteration (early-return included).
        let mut req = FsReq::new();

        // The int return value of uv_fs_write truncates req.result (ssize_t) and
        // wraps negative when bytes written > INT_MAX, so use req.result directly.
        // SAFETY: synchronous libuv fs call; req and chunk_bufs live on the stack.
        let _ = unsafe {
            uv::uv_fs_write(
                uv::Loop::get(),
                &mut *req,
                uv_fd,
                chunk_bufs.as_ptr().cast(),
                c_uint::try_from(chunk_len).expect("int cast"),
                current_position,
                None,
            )
        };

        // `sum_bufs_len` expects `&[PlatformIOVec]`; rather than repr-punning the
        // const slice through `from_raw_parts`, sum the `.len` fields directly.
        let chunk_capacity: usize = chunk_bufs.iter().map(|b| b.len as usize).sum();

        if cfg!(debug_assertions) {
            log!(
                "uv write({}, {} total bytes) = {} ({})",
                uv_fd,
                chunk_capacity,
                req.result.int(),
                debug_timer
            );
        }

        if let Some(e) = req.result.err_enum_e() {
            return Result::Err(Error::new(e, Tag::write).with_fd(fd));
        }

        let bytes_written: usize = usize::try_from(req.result.int()).expect("int cast");
        total_written += bytes_written;

        // If we wrote less than requested, we're done (partial write)
        if bytes_written == 0 || bytes_written < chunk_capacity {
            break;
        }

        remaining_bufs = &remaining_bufs[chunk_len..];

        // Update position for the next chunk (if position tracking is enabled)
        if current_position >= 0 {
            current_position += i64::try_from(bytes_written).expect("int cast");
        }
    }

    Result::Ok(total_written)
}

#[inline]
pub fn readv(fd: Fd, bufs: &[PlatformIOVec]) -> Result<usize> {
    preadv(fd, bufs, -1)
}

pub fn pread(fd: Fd, buf: &mut [u8], position: i64) -> Result<usize> {
    // If buffer fits in a single uv_buf_t, use the simple path
    if buf.len() <= MAX_BUF_LEN {
        let bufs: [PlatformIOVec; 1] = [crate::platform_iovec_create(buf)];
        return preadv(fd, &bufs, position);
    }

    // Buffer is too large, need to chunk it
    let mut total_read: usize = 0;
    let mut remaining = buf;
    let mut current_position = position;

    while !remaining.is_empty() {
        let chunk_len = remaining.len().min(MAX_BUF_LEN);
        let bufs: [PlatformIOVec; 1] = [crate::platform_iovec_create(&mut remaining[0..chunk_len])];

        match preadv(fd, &bufs, current_position) {
            Result::Err(err) => return Result::Err(err),
            Result::Ok(bytes_read) => {
                total_read += bytes_read;

                if bytes_read == 0 || bytes_read < chunk_len {
                    break;
                }

                remaining = &mut remaining[chunk_len..];
                if current_position >= 0 {
                    current_position += i64::try_from(bytes_read).expect("int cast");
                }
            }
        }
    }

    Result::Ok(total_read)
}

pub fn read(fd: Fd, buf: &mut [u8]) -> Result<usize> {
    // If buffer fits in a single uv_buf_t, use the simple path
    if buf.len() <= MAX_BUF_LEN {
        let bufs: [PlatformIOVec; 1] = [crate::platform_iovec_create(buf)];
        return readv(fd, &bufs);
    }

    // Buffer is too large, need to chunk it
    let mut total_read: usize = 0;
    let mut remaining = buf;

    while !remaining.is_empty() {
        let chunk_len = remaining.len().min(MAX_BUF_LEN);
        let bufs: [PlatformIOVec; 1] = [crate::platform_iovec_create(&mut remaining[0..chunk_len])];

        match readv(fd, &bufs) {
            Result::Err(err) => return Result::Err(err),
            Result::Ok(bytes_read) => {
                total_read += bytes_read;

                if bytes_read == 0 || bytes_read < chunk_len {
                    break;
                }

                remaining = &mut remaining[chunk_len..];
            }
        }
    }

    Result::Ok(total_read)
}

#[inline]
pub fn writev(fd: Fd, bufs: &[PlatformIOVec]) -> Result<usize> {
    // TODO(port): Zig signature is `[]bun.PlatformIOVec` (mutable) but pwritev takes
    // `[]const bun.PlatformIOVecConst`; on Windows both alias uv_buf_t. Reconcile in Phase B.
    // SAFETY: `PlatformIOVec` (= `uv_buf_t`) and `PlatformIOVecConst` are
    // layout-identical on Windows (size/align asserted in lib.rs); the
    // fat-pointer cast preserves the original slice's (ptr, len) metadata
    // exactly instead of re-deriving it.
    let const_bufs = unsafe { &*(bufs as *const [PlatformIOVec] as *const [PlatformIOVecConst]) };
    pwritev(fd, const_bufs, -1)
}

pub fn pwrite(fd: Fd, buf: &[u8], position: i64) -> Result<usize> {
    // If buffer fits in a single uv_buf_t, use the simple path
    if buf.len() <= MAX_BUF_LEN {
        let bufs: [PlatformIOVecConst; 1] = [crate::platform_iovec_const_create(buf)];
        return pwritev(fd, &bufs, position);
    }

    // Buffer is too large, need to chunk it
    let mut total_written: usize = 0;
    let mut remaining = buf;
    let mut current_position = position;

    while !remaining.is_empty() {
        let chunk_len = remaining.len().min(MAX_BUF_LEN);
        let bufs: [PlatformIOVecConst; 1] =
            [crate::platform_iovec_const_create(&remaining[0..chunk_len])];

        match pwritev(fd, &bufs, current_position) {
            Result::Err(err) => return Result::Err(err),
            Result::Ok(bytes_written) => {
                total_written += bytes_written;

                if bytes_written == 0 || bytes_written < chunk_len {
                    break;
                }

                remaining = &remaining[chunk_len..];
                if current_position >= 0 {
                    current_position += i64::try_from(bytes_written).expect("int cast");
                }
            }
        }
    }

    Result::Ok(total_written)
}

pub fn write(fd: Fd, buf: &[u8]) -> Result<usize> {
    // If buffer fits in a single uv_buf_t, use the simple path
    if buf.len() <= MAX_BUF_LEN {
        let bufs: [PlatformIOVecConst; 1] = [crate::platform_iovec_const_create(buf)];
        return writev_const(fd, &bufs);
    }

    // Buffer is too large, need to chunk it
    let mut total_written: usize = 0;
    let mut remaining = buf;

    while !remaining.is_empty() {
        let chunk_len = remaining.len().min(MAX_BUF_LEN);
        let bufs: [PlatformIOVecConst; 1] =
            [crate::platform_iovec_const_create(&remaining[0..chunk_len])];

        match writev_const(fd, &bufs) {
            Result::Err(err) => return Result::Err(err),
            Result::Ok(bytes_written) => {
                total_written += bytes_written;

                if bytes_written == 0 || bytes_written < chunk_len {
                    break;
                }

                remaining = &remaining[chunk_len..];
            }
        }
    }

    Result::Ok(total_written)
}

// PORT NOTE: Zig's `write()` builds a `[1]PlatformIOVecConst` and calls `writev` (which
// takes `[]PlatformIOVec`). The two types alias on Windows so Zig coerces silently. Rust
// can't, so route through pwritev directly with position = -1. Phase B should unify the
// iovec types on Windows.
#[inline]
fn writev_const(fd: Fd, bufs: &[PlatformIOVecConst]) -> Result<usize> {
    pwritev(fd, bufs, -1)
}

// ported from: src/sys/sys_uv.zig
