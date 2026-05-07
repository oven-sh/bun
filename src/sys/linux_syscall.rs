//! Raw Linux syscalls via `rustix` (linux_raw backend — no libc trampoline).
//!
//! Mirrors Zig's `std.os.linux.*`: every function here issues the kernel
//! syscall directly (inline asm via rustix's `linux_raw` backend) instead of
//! going through glibc's `open(3)`/`read(3)`/etc wrappers. This eliminates the
//! PLT hop, the `errno` TLS write, and the pthread cancellation-point check
//! that glibc adds to every blocking syscall.
//!
//! Return convention: `Result<T, i32>` where the `Err` arm is the *positive*
//! kernel errno (e.g. `libc::EINTR == 4`). Callers map this straight into
//! `bun_sys::Error::from_code_int(e, tag)` — same shape as the existing
//! `Maybe<T>` plumbing, just without the `last_errno()` round-trip.
//!
//! EINTR retry is handled here (matching the sys.zig Linux arms) so callers
//! don't need to loop.
#![cfg(target_os = "linux")]
#![allow(unreachable_pub)]

use core::ffi::CStr;
use rustix::fd::{BorrowedFd, IntoRawFd, OwnedFd};
use rustix::io::Errno;

use crate::{Fd, Mode};
use bun_core::ZStr;

// ──────────────────────────────────────────────────────────────────────────
// Glue: rustix ↔ bun_sys primitive types
// ──────────────────────────────────────────────────────────────────────────

/// Reinterpret a raw posix fd as a `BorrowedFd` for the duration of a single
/// rustix call. SAFETY: `fd` must be a valid open descriptor (and ≠ -1; that
/// value is `BorrowedFd`'s niche) for the duration of the call. Caller-owned;
/// rustix never closes a `BorrowedFd`.
///
/// The lifetime is unbounded (chosen by inference at each call site) rather
/// than `'static` — every use in this module is a single-expression borrow,
/// so inference picks a local lifetime and the wrapper cannot accidentally
/// outlive the real fd.
#[inline(always)]
unsafe fn bfd<'a>(fd: i32) -> BorrowedFd<'a> {
    // SAFETY: forwarded — see fn doc.
    unsafe { BorrowedFd::borrow_raw(fd) }
}

/// `&ZStr` → `&CStr` (both are NUL-terminated; `ZStr` additionally carries the
/// length, which rustix's `path::Arg` for `&CStr` recomputes via `strlen` —
/// acceptable: paths are short and this matches glibc's `open(3)` cost).
#[inline(always)]
fn zcstr(path: &ZStr) -> &CStr {
    // SAFETY: `ZStr` invariant — `as_ptr()` points at `len` bytes followed by NUL.
    unsafe { CStr::from_ptr(path.as_ptr()) }
}

/// rustix `Errno` → raw positive errno (matches `libc::E*` constants on Linux).
#[inline(always)]
fn raw(e: Errno) -> i32 {
    e.raw_os_error()
}

/// EINTR-retry a rustix call. Matches the `while (true) { ...; if .INTR continue }`
/// loop in the sys.zig Linux arms.
#[inline(always)]
fn retry<T>(mut f: impl FnMut() -> rustix::io::Result<T>) -> Result<T, i32> {
    loop {
        match f() {
            Ok(v) => return Ok(v),
            Err(Errno::INTR) => continue,
            Err(e) => return Err(raw(e)),
        }
    }
}

/// Single-shot (no EINTR retry). Used for `close` and any path where the Zig
/// surfaces EINTR to the caller.
#[inline(always)]
fn once<T>(r: rustix::io::Result<T>) -> Result<T, i32> {
    r.map_err(raw)
}

// ──────────────────────────────────────────────────────────────────────────
// Hot path: open / openat / read / write / close / pread / pwrite
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Result<Fd, i32> {
    let oflags = rustix::fs::OFlags::from_bits_retain(flags as u32);
    let mode = rustix::fs::Mode::from_raw_mode(mode);
    // rustix `open` issues `openat(AT_FDCWD, ...)` on arches without SYS_open
    // (aarch64) — same as the kernel's own `open(2)` compat shim.
    retry(|| rustix::fs::open(zcstr(path), oflags, mode)).map(own_fd)
}

#[inline]
pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Result<Fd, i32> {
    let oflags = rustix::fs::OFlags::from_bits_retain(flags as u32);
    let mode = rustix::fs::Mode::from_raw_mode(mode);
    // SAFETY: `dir` is caller-owned for the call.
    let dir = unsafe { bfd(dir.native()) };
    retry(|| rustix::fs::openat(dir, zcstr(path), oflags, mode)).map(own_fd)
}

#[inline]
pub fn read(fd: Fd, buf: &mut [u8]) -> Result<usize, i32> {
    // SAFETY: `fd` is caller-owned for the call.
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::io::read(fd, buf))
}

#[inline]
pub fn write(fd: Fd, buf: &[u8]) -> Result<usize, i32> {
    // SAFETY: `fd` is caller-owned for the call.
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::io::write(fd, buf))
}

#[inline]
pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Result<usize, i32> {
    // SAFETY: `fd` is caller-owned for the call.
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::io::pread(fd, buf, off as u64))
}

#[inline]
pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Result<usize, i32> {
    // SAFETY: `fd` is caller-owned for the call.
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::io::pwrite(fd, buf, off as u64))
}

/// `close(2)` — single shot, never retried (Linux may have already released
/// the fd on EINTR; retrying could close a racing thread's new fd). Returns
/// `Err(EBADF)` etc. on failure; callers only surface `EBADF` (fd.zig:266).
#[inline]
pub fn close(fd: i32) -> Result<(), i32> {
    // rustix's safe `io::close(OwnedFd)` is infallible by design (it swallows
    // the rc because POSIX says "the fd is released regardless"), and
    // constructing an `OwnedFd` from a possibly-invalid int is UB — but we
    // *need* the rc to surface `EBADF` (debug double-close detection).
    //
    // rustix has no public generic `syscall!`, so go through `libc::syscall`
    // with `SYS_close`. This is *not* the glibc `close(3)` wrapper: `syscall(2)`
    // is a thin register-shuffle + `syscall` instruction with no pthread
    // cancellation point and no per-call PLT entry beyond `syscall` itself.
    // glibc still translates the kernel `-errno` return into `-1`+TLS-errno,
    // so decode via `last_errno`-equivalent here.
    //
    // PERF(port): replace with inline-asm `syscall` (or rustix fallible close
    // once it lands) to drop the last libc touch on this path.
    // SAFETY: raw `close(2)`; `fd` is caller-owned (or already invalid, which
    // is exactly the EBADF case we want to detect).
    let rc = unsafe { libc::syscall(libc::SYS_close, fd) };
    if rc == 0 {
        Ok(())
    } else {
        // SAFETY: `__errno_location()` returns a valid thread-local int*.
        Err(unsafe { *libc::__errno_location() })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// stat family — write into `libc::stat` so the public `bun_sys::Stat` alias
// stays unchanged for downstream callers.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn fstat(fd: Fd) -> Result<libc::stat, i32> {
    // SAFETY: `fd` is caller-owned for the call.
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::fs::fstat(fd)).map(stat_to_libc)
}

#[inline]
pub fn stat(path: &ZStr) -> Result<libc::stat, i32> {
    retry(|| rustix::fs::stat(zcstr(path))).map(stat_to_libc)
}

#[inline]
pub fn lstat(path: &ZStr) -> Result<libc::stat, i32> {
    retry(|| rustix::fs::lstat(zcstr(path))).map(stat_to_libc)
}

#[inline]
pub fn fstatat(dir: i32, path: &ZStr, flags: i32) -> Result<libc::stat, i32> {
    // SAFETY: `dir` is caller-owned (or AT_FDCWD) for the call.
    let dir = unsafe { bfd(dir) };
    let at = rustix::fs::AtFlags::from_bits_retain(flags as u32);
    retry(|| rustix::fs::statat(dir, zcstr(path), at)).map(stat_to_libc)
}

/// Map rustix's kernel `struct stat` → `libc::stat`. Field-by-field copy by
/// name — both are the Linux UAPI `struct stat` so every public `st_*` field
/// is present on both, but padding/reserved field names differ per-arch so a
/// blind transmute is not portable. This compiles to straight moves.
#[inline]
fn stat_to_libc(s: rustix::fs::Stat) -> libc::stat {
    // SAFETY: `libc::stat` is POD; zero is a valid bit-pattern for every field
    // (all integers). We overwrite every meaningful field below.
    let mut out: libc::stat = unsafe { core::mem::zeroed() };
    out.st_dev = s.st_dev as _;
    out.st_ino = s.st_ino as _;
    out.st_nlink = s.st_nlink as _;
    out.st_mode = s.st_mode as _;
    out.st_uid = s.st_uid as _;
    out.st_gid = s.st_gid as _;
    out.st_rdev = s.st_rdev as _;
    out.st_size = s.st_size as _;
    out.st_blksize = s.st_blksize as _;
    out.st_blocks = s.st_blocks as _;
    out.st_atime = s.st_atime as _;
    out.st_atime_nsec = s.st_atime_nsec as _;
    out.st_mtime = s.st_mtime as _;
    out.st_mtime_nsec = s.st_mtime_nsec as _;
    out.st_ctime = s.st_ctime as _;
    out.st_ctime_nsec = s.st_ctime_nsec as _;
    out
}

// ──────────────────────────────────────────────────────────────────────────
// vectored I/O
//
// `readv`/`preadv` cannot route through rustix's typed `io::readv` because
// that API requires `&mut [IoSliceMut]`, and our callers (lib.rs:3211/3258)
// hand us `vecs.as_ptr()` derived from a *shared* `&[PlatformIoVec]` —
// fabricating a `&mut` slice from that pointer is UB under Stacked/Tree
// Borrows regardless of whether rustix actually writes to the iovec array.
// Instead pass the raw pointer straight to the kernel via `libc::syscall`,
// exactly as the Zig `std.os.linux.readv` path does. `syscall(2)` is a thin
// register-shuffle (no PLT entry per call, no pthread cancellation point);
// glibc translates the kernel `-errno` to `-1`+TLS-errno, which `sys_retry`
// decodes.
// ──────────────────────────────────────────────────────────────────────────

/// EINTR-retry a raw `libc::syscall` returning a byte count.
#[inline(always)]
unsafe fn sys_retry(mut f: impl FnMut() -> libc::c_long) -> Result<usize, i32> {
    loop {
        let rc = f();
        if rc >= 0 {
            return Ok(rc as usize);
        }
        // SAFETY: `__errno_location()` returns a valid thread-local int*.
        let e = unsafe { *libc::__errno_location() };
        if e == libc::EINTR {
            continue;
        }
        return Err(e);
    }
}

/// Raw `readv(2)`. `vecs` is `*const libc::iovec` (the public `PlatformIoVec`
/// alias). The kernel reads the iovec array and writes through each
/// `iov_base`; the array itself is never mutated.
#[inline]
pub unsafe fn readv(fd: Fd, vecs: *const libc::iovec, n: usize) -> Result<usize, i32> {
    // SAFETY: caller guarantees `vecs[..n]` are valid iovecs whose `iov_base`
    // are writable for `iov_len` bytes.
    unsafe {
        sys_retry(|| libc::syscall(libc::SYS_readv, fd.native(), vecs, n as libc::c_long))
    }
}

/// Raw `writev(2)`.
#[inline]
pub unsafe fn writev(fd: Fd, vecs: *const libc::iovec, n: usize) -> Result<usize, i32> {
    // SAFETY: caller guarantees `vecs[..n]` are valid `iovec`s.
    let slice = unsafe {
        core::slice::from_raw_parts(vecs as *const rustix::io::IoSlice<'_>, n)
    };
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::io::writev(fd, slice))
}

/// Raw `preadv(2)`.
#[inline]
pub unsafe fn preadv(fd: Fd, vecs: *const libc::iovec, n: usize, off: i64) -> Result<usize, i32> {
    // The kernel `preadv` ABI splits the offset into (lo, hi) longs on every
    // arch; on LP64 the kernel's `pos_from_hilo` shifts `hi` out entirely, so
    // `lo` carries the full 64-bit offset. Mirror glibc's `LO_HI_LONG` for
    // documentation fidelity.
    let lo = off as libc::c_long;
    let hi = ((off as u64) >> 32) as libc::c_long;
    // SAFETY: caller guarantees `vecs[..n]` are valid iovecs whose `iov_base`
    // are writable for `iov_len` bytes.
    unsafe {
        sys_retry(|| {
            libc::syscall(libc::SYS_preadv, fd.native(), vecs, n as libc::c_long, lo, hi)
        })
    }
}

/// Raw `pwritev(2)`.
#[inline]
pub unsafe fn pwritev(fd: Fd, vecs: *const libc::iovec, n: usize, off: i64) -> Result<usize, i32> {
    let slice = unsafe {
        core::slice::from_raw_parts(vecs as *const rustix::io::IoSlice<'_>, n)
    };
    let fd = unsafe { bfd(fd.native()) };
    retry(|| rustix::io::pwritev(fd, slice, off as u64))
}

// ──────────────────────────────────────────────────────────────────────────
// Linux-only kernel features (epoll / pidfd / copy_file_range / sendfile /
// getdents64). These keep the *libc-convention* return shape (`-1` on error
// with thread-local errno set) so existing callers in `bun_aio`/`bun_runtime`
// that decode via `GetErrno for isize` continue to work unchanged. The syscall
// itself is raw — only the errno write touches libc TLS.
// ──────────────────────────────────────────────────────────────────────────

#[inline(always)]
unsafe fn set_errno(e: i32) {
    // SAFETY: `__errno_location()` returns a valid thread-local `*mut c_int`.
    unsafe { *libc::__errno_location() = e; }
}

/// Raw `read(2)` — libc-convention return (for `linux::read` / `posix::read`).
///
/// This is a libc-convention thunk: callers may pass `fd == -1` (expecting
/// EBADF), `buf == NULL` with `count == 0` (expecting `0`), or an
/// uninitialized buffer (legal for `read(2)`). Routing through rustix would
/// require constructing `BorrowedFd` (UB for `-1`, its niche value) and
/// `&mut [u8]` (UB for null or uninit). Instead forward the raw triple to
/// the kernel via `libc::syscall(SYS_read, ..)` — pointer-only, no Rust
/// references, identical semantics to the pre-refactor `libc::read` path
/// minus the PLT hop and pthread cancellation point.
#[inline]
pub unsafe fn read_raw(fd: i32, buf: *mut u8, count: usize) -> isize {
    // SAFETY: raw `read(2)`; kernel validates `fd`/`buf`/`count`.
    unsafe { libc::syscall(libc::SYS_read, fd, buf, count) as isize }
}

/// Raw `write(2)` — libc-convention return. See `read_raw` for why this
/// bypasses rustix's typed wrapper.
#[inline]
pub unsafe fn write_raw(fd: i32, buf: *const u8, count: usize) -> isize {
    // SAFETY: raw `write(2)`; kernel validates `fd`/`buf`/`count`.
    unsafe { libc::syscall(libc::SYS_write, fd, buf, count) as isize }
}

// Cross-crate layout pin: we reinterpret `*mut libc::epoll_event` as
// `*const rustix::event::epoll::Event` below. Both mirror the kernel UAPI
// struct (packed on x86_64, natural on aarch64), but that is an undocumented
// coincidence — fail the build loudly if either crate ever diverges.
const _: () = assert!(
    core::mem::size_of::<libc::epoll_event>()
        == core::mem::size_of::<rustix::event::epoll::Event>()
);
const _: () = assert!(
    core::mem::align_of::<libc::epoll_event>()
        == core::mem::align_of::<rustix::event::epoll::Event>()
);

/// Raw `epoll_ctl(2)` — libc-convention return.
#[inline]
pub unsafe fn epoll_ctl(epfd: i32, op: i32, fd: i32, event: *mut libc::epoll_event) -> i32 {
    // rustix's typed `epoll::add/modify/delete` would force callers to rebuild
    // `EventData`/`EventFlags`; instead route the existing `(op, *event)` shape
    // through the matching rustix call. `event` may be null for CTL_DEL.
    let epfd_b = unsafe { bfd(epfd) };
    let fd_b = unsafe { bfd(fd) };
    let r: rustix::io::Result<()> = match op {
        libc::EPOLL_CTL_DEL => rustix::event::epoll::delete(epfd_b, fd_b),
        libc::EPOLL_CTL_ADD | libc::EPOLL_CTL_MOD => {
            // SAFETY: ADD/MOD require a valid event; caller upholds this
            // (matches `epoll_ctl(2)` contract). Layout equivalence is
            // statically asserted above.
            let ev = unsafe { &*(event as *const rustix::event::epoll::Event) };
            let data = ev.data;
            let flags = ev.flags;
            if op == libc::EPOLL_CTL_ADD {
                rustix::event::epoll::add(epfd_b, fd_b, data, flags)
            } else {
                rustix::event::epoll::modify(epfd_b, fd_b, data, flags)
            }
        }
        // Unknown op: surface the kernel's EINVAL rather than silently
        // aliasing to MOD (previous else-arm behavior).
        _ => Err(Errno::INVAL),
    };
    match r {
        Ok(()) => 0,
        Err(e) => {
            unsafe { set_errno(raw(e)) };
            -1
        }
    }
}

/// Raw `sendfile(2)` — libc-convention return.
#[inline]
pub unsafe fn sendfile(out_fd: i32, in_fd: i32, offset: *mut i64, count: usize) -> isize {
    let out = unsafe { bfd(out_fd) };
    let inp = unsafe { bfd(in_fd) };
    let off_ref: Option<&mut u64> = if offset.is_null() {
        None
    } else {
        // SAFETY: caller passed a valid `*mut i64`; kernel treats it as `loff_t`.
        Some(unsafe { &mut *(offset as *mut u64) })
    };
    match rustix::fs::sendfile(out, inp, off_ref, count) {
        Ok(n) => n as isize,
        Err(e) => {
            unsafe { set_errno(raw(e)) };
            -1
        }
    }
}

/// Raw `copy_file_range(2)` — libc-convention return.
#[inline]
pub unsafe fn copy_file_range(
    in_: i32, off_in: *mut i64, out: i32, off_out: *mut i64, len: usize, flags: u32,
) -> isize {
    // rustix's wrapper hard-codes `flags = 0` (the only value any shipping
    // kernel accepts). The Zig `std.os.linux.copy_file_range` and the
    // pre-refactor `libc::syscall` path both forward `flags` verbatim, so a
    // future flag bit passed through here would otherwise be silently
    // dropped instead of EINVAL-ing. Catch that divergence in debug builds.
    debug_assert_eq!(flags, 0, "copy_file_range: non-zero flags dropped by rustix wrapper");
    let inp = unsafe { bfd(in_) };
    let out = unsafe { bfd(out) };
    let oi: Option<&mut u64> =
        if off_in.is_null() { None } else { Some(unsafe { &mut *(off_in as *mut u64) }) };
    let oo: Option<&mut u64> =
        if off_out.is_null() { None } else { Some(unsafe { &mut *(off_out as *mut u64) }) };
    match rustix::fs::copy_file_range(inp, oi, out, oo, len) {
        Ok(n) => n as isize,
        Err(e) => {
            unsafe { set_errno(raw(e)) };
            -1
        }
    }
}

/// `pidfd_open(2)` — `Result` shape (caller maps to `bun_sys::Error`).
#[inline]
pub fn pidfd_open(pid: i32, flags: u32) -> Result<Fd, i32> {
    let pid = rustix::process::Pid::from_raw(pid).ok_or(libc::EINVAL)?;
    let flags = rustix::process::PidfdFlags::from_bits_retain(flags);
    once(rustix::process::pidfd_open(pid, flags)).map(own_fd)
}

/// `getdents64(2)` into a caller-provided byte buffer — libc-convention return
/// (matches the existing `WrappedIterator` parser which decodes the raw
/// `linux_dirent64` records itself).
#[inline]
pub unsafe fn getdents64(fd: i32, buf: *mut u8, len: usize) -> isize {
    // rustix only exposes `RawDir` (which owns the parse loop). We need the
    // raw byte fill to keep the existing record parser, so issue the syscall
    // via `libc::syscall(SYS_getdents64, ..)`. This is a thin trampoline (no
    // errno-on-return mangling beyond the standard `-1`/errno convention) and
    // is what the Zig path compiles to as well.
    // PERF(port): switch to `rustix::fs::RawDir` once `WrappedIterator` is
    // reworked to consume `RawDirEntry` instead of hand-parsing bytes.
    unsafe { libc::syscall(libc::SYS_getdents64, fd as libc::c_long, buf, len) as isize }
}

#[inline(always)]
fn own_fd(fd: OwnedFd) -> Fd {
    // rustix returns `OwnedFd` (close-on-Drop). bun_sys manages fd lifetime
    // explicitly via `Fd` + `close()`, so leak the RAII wrapper and hand back
    // the raw int. `into_raw_fd` is the canonical leak-and-return.
    Fd::from_native(fd.into_raw_fd())
}
