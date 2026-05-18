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
//!
//! Android: bionic is just another userspace libc on the same Linux kernel —
//! every raw syscall here is identical (Zig's `std.os.linux.*` makes no
//! gnu/musl/bionic distinction). Rust splits `target_os` into
//! `linux`/`android`, so the gate must list both.
#![cfg(any(target_os = "linux", target_os = "android"))]
#![allow(unreachable_pub)]

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

/// rustix `Errno` → raw positive errno (matches `libc::E*` constants on Linux).
#[inline(always)]
fn raw(e: Errno) -> i32 {
    e.raw_os_error()
}

/// Read the calling thread's `errno`. Canonical target_os→symbol ladder lives
/// in `bun_core::ffi` (already a safe wrapper over `__errno_location()`), so
/// this is just a local re-export — no caller obligation.
#[inline(always)]
fn errno() -> i32 {
    bun_core::ffi::errno()
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
    retry(|| rustix::fs::open(path.as_cstr(), oflags, mode)).map(own_fd)
}

#[inline]
pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Result<Fd, i32> {
    let oflags = rustix::fs::OFlags::from_bits_retain(flags as u32);
    let mode = rustix::fs::Mode::from_raw_mode(mode);
    let dir = dir.as_borrowed_fd();
    retry(|| rustix::fs::openat(dir, path.as_cstr(), oflags, mode)).map(own_fd)
}

#[inline]
pub fn read(fd: Fd, buf: &mut [u8]) -> Result<usize, i32> {
    let fd = fd.as_borrowed_fd();
    retry(|| rustix::io::read(fd, buf))
}

#[inline]
pub fn write(fd: Fd, buf: &[u8]) -> Result<usize, i32> {
    let fd = fd.as_borrowed_fd();
    retry(|| rustix::io::write(fd, buf))
}

#[inline]
pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Result<usize, i32> {
    let fd = fd.as_borrowed_fd();
    retry(|| rustix::io::pread(fd, buf, off as u64))
}

#[inline]
pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Result<usize, i32> {
    let fd = fd.as_borrowed_fd();
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
    if rc == 0 { Ok(()) } else { Err(errno()) }
}

// ──────────────────────────────────────────────────────────────────────────
// stat family — write into `libc::stat` so the public `bun_sys::Stat` alias
// stays unchanged for downstream callers.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn fstat(fd: Fd) -> Result<libc::stat, i32> {
    let fd = fd.as_borrowed_fd();
    retry(|| rustix::fs::fstat(fd)).map(stat_to_libc)
}

#[inline]
pub fn stat(path: &ZStr) -> Result<libc::stat, i32> {
    retry(|| rustix::fs::stat(path.as_cstr())).map(stat_to_libc)
}

#[inline]
pub fn lstat(path: &ZStr) -> Result<libc::stat, i32> {
    retry(|| rustix::fs::lstat(path.as_cstr())).map(stat_to_libc)
}

#[inline]
pub fn fstatat(dir: i32, path: &ZStr, flags: i32) -> Result<libc::stat, i32> {
    // SAFETY: `dir` is caller-owned (or AT_FDCWD) for the call.
    let dir = unsafe { bfd(dir) };
    let at = rustix::fs::AtFlags::from_bits_retain(flags as u32);
    retry(|| rustix::fs::statat(dir, path.as_cstr(), at)).map(stat_to_libc)
}

/// Map rustix's kernel `struct stat` → `libc::stat`.
///
/// On Bun's tier-1 Linux targets (x86_64, aarch64 — gnu/musl/bionic alike),
/// `rustix::fs::Stat` (= `linux_raw_sys::general::stat`, bindgen'd from the
/// kernel UAPI `asm/stat.h`) and `libc::stat` are *the same struct*: every
/// libc on those arches defines its userspace `struct stat` as a verbatim
/// copy of the kernel layout so the syscall can write into it directly. The
/// conversion is therefore a no-op `transmute` — no `zeroed()` memset, no
/// 16-field move chain — matching Zig's single `fstat(fd, &out)` with zero
/// post-processing. The const assert turns any future layout divergence into
/// a compile error rather than silent field corruption.
///
/// (Perf: the previous field-by-field copy showed up in `bun install` profiles
/// as `write_bytes<stat>` — the 144-byte memset behind `zeroed()` — plus the
/// move chain, on a path that runs once per installed file.)
#[inline(always)]
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
fn stat_to_libc(s: rustix::fs::Stat) -> libc::stat {
    const _: () = assert!(
        core::mem::size_of::<rustix::fs::Stat>() == core::mem::size_of::<libc::stat>()
            && core::mem::align_of::<rustix::fs::Stat>() == core::mem::align_of::<libc::stat>(),
        "rustix::fs::Stat / libc::stat layout mismatch on this target — \
         drop it from the cfg above so it takes the field-copy fallback",
    );
    // SAFETY: identical layout (both are the per-arch kernel UAPI `struct stat`;
    // see doc comment + const assert). All-integer POD — every bit-pattern is
    // valid for every field, so no invalid-value hazard either way.
    unsafe { core::mem::transmute::<rustix::fs::Stat, libc::stat>(s) }
}

/// Fallback for arches where userspace `libc::stat` is *not* guaranteed
/// layout-identical to the kernel struct (e.g. mips64 glibc reorders fields).
/// Field-by-field copy by name — both expose every public `st_*` field, only
/// padding/reserved names differ. Compiles to straight moves.
#[inline]
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
fn stat_to_libc(s: rustix::fs::Stat) -> libc::stat {
    // SAFETY: `libc::stat` is POD; zero is a valid bit-pattern for every field
    // (all integers). We overwrite every meaningful field below.
    let mut out: libc::stat = bun_core::ffi::zeroed();
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

/// EINTR-retry a raw `libc::syscall` returning a byte count. The closure
/// itself carries any FFI `unsafe`; the retry loop is pure control flow.
#[inline(always)]
fn sys_retry(mut f: impl FnMut() -> libc::c_long) -> Result<usize, i32> {
    loop {
        let rc = f();
        if rc >= 0 {
            return Ok(rc as usize);
        }
        let e = errno();
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
    sys_retry(|| {
        // SAFETY: caller guarantees `vecs[..n]` are valid iovecs whose
        // `iov_base` are writable for `iov_len` bytes.
        unsafe { libc::syscall(libc::SYS_readv, fd.native(), vecs, n as libc::c_long) }
    })
}

/// Raw `writev(2)`.
#[inline]
pub unsafe fn writev(fd: Fd, vecs: *const libc::iovec, n: usize) -> Result<usize, i32> {
    // Same shape as `readv` above: hand the raw `(iovec*, n)` pair straight to
    // the kernel rather than fabricating a `&[IoSlice]` just to satisfy
    // rustix's typed wrapper. The caller already owns a `&[PlatformIoVec]`;
    // round-tripping through a reconstructed borrowed slice buys nothing.
    sys_retry(|| {
        // SAFETY: caller guarantees `vecs[..n]` are valid `iovec`s whose
        // `iov_base` are readable for `iov_len` bytes.
        unsafe { libc::syscall(libc::SYS_writev, fd.native(), vecs, n as libc::c_long) }
    })
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
    sys_retry(|| {
        // SAFETY: caller guarantees `vecs[..n]` are valid iovecs whose
        // `iov_base` are writable for `iov_len` bytes.
        unsafe {
            libc::syscall(
                libc::SYS_preadv,
                fd.native(),
                vecs,
                n as libc::c_long,
                lo,
                hi,
            )
        }
    })
}

/// Raw `pwritev(2)`.
#[inline]
pub unsafe fn pwritev(fd: Fd, vecs: *const libc::iovec, n: usize, off: i64) -> Result<usize, i32> {
    // Mirror `preadv`: split offset per the kernel `pwritev` ABI and pass the
    // raw `(iovec*, n)` straight through instead of reconstructing a borrowed
    // `&[IoSlice]` for rustix's typed wrapper.
    let lo = off as libc::c_long;
    let hi = ((off as u64) >> 32) as libc::c_long;
    sys_retry(|| {
        // SAFETY: caller guarantees `vecs[..n]` are valid `iovec`s whose
        // `iov_base` are readable for `iov_len` bytes.
        unsafe {
            libc::syscall(
                libc::SYS_pwritev,
                fd.native(),
                vecs,
                n as libc::c_long,
                lo,
                hi,
            )
        }
    })
}

// ──────────────────────────────────────────────────────────────────────────
// Linux-only kernel features (epoll / pidfd / copy_file_range / sendfile /
// getdents64). These keep the *libc-convention* return shape (`-1` on error
// with thread-local errno set) so existing callers in `bun_io`/`bun_runtime`
// that decode via `GetErrno for isize` continue to work unchanged. The syscall
// itself is raw; glibc's `syscall(2)` trampoline writes thread-local errno on
// `-errno` returns, which callers decode via `GetErrno for isize`.
// ──────────────────────────────────────────────────────────────────────────

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

/// Raw `epoll_ctl(2)` — libc-convention return.
///
/// Routed via `libc::syscall(SYS_epoll_ctl, ..)` rather than rustix's typed
/// `epoll::add/modify/delete` because the typed API would require:
///   (a) constructing `BorrowedFd` for `epfd`/`fd` — UB if a caller probes
///       with `-1` (the niche value), whereas the kernel returns EBADF;
///   (b) reinterpreting `*mut libc::epoll_event` as rustix's `Event` and
///       reading its fields — a cross-crate layout pun whose soundness
///       depends on `EventData`/`EventFlags` having no invalid bit-patterns;
///   (c) synthesizing EINVAL for unknown `op` values ourselves rather than
///       letting the kernel reject them.
/// Passing the raw quad straight through avoids all three and matches Zig's
/// `std.os.linux.epoll_ctl` 1:1.
#[inline]
pub unsafe fn epoll_ctl(epfd: i32, op: i32, fd: i32, event: *mut libc::epoll_event) -> i32 {
    // SAFETY: raw `epoll_ctl(2)`; kernel validates `epfd`/`op`/`fd`; `event`
    // may be null for CTL_DEL (kernel ignores it).
    unsafe { libc::syscall(libc::SYS_epoll_ctl, epfd, op, fd, event) as i32 }
}

/// Raw `sendfile(2)` — libc-convention return.
///
/// Routed via `libc::syscall(SYS_sendfile, ..)` rather than rustix's
/// `fs::sendfile` so that (a) `out_fd`/`in_fd == -1` yield EBADF instead of
/// constructing a niche-invalid `BorrowedFd`, and (b) `offset` stays a raw
/// `*mut loff_t` with no `&mut u64` type-pun. Matches Zig's
/// `std.os.linux.sendfile` 1:1.
#[inline]
pub unsafe fn sendfile(out_fd: i32, in_fd: i32, offset: *mut i64, count: usize) -> isize {
    // libc 0.2.186 omits `SYS_sendfile` from its aarch64 syscall tables (gnu,
    // musl, *and* android — every other arch has it). Zig didn't hit this
    // because `std.os.linux.SYS` is a complete kernel-derived table. The
    // generic-syscall ABI (aarch64/riscv64/loongarch64) places `sendfile` at
    // 71; the legacy ABIs that *do* have the constant differ, so the polyfill
    // is aarch64-only and the rest still come from `libc`.
    #[cfg(target_arch = "aarch64")]
    const SYS_SENDFILE: libc::c_long = 71;
    #[cfg(not(target_arch = "aarch64"))]
    const SYS_SENDFILE: libc::c_long = libc::SYS_sendfile;

    // SAFETY: raw `sendfile(2)`; kernel validates fds; `offset` may be null.
    unsafe { libc::syscall(SYS_SENDFILE, out_fd, in_fd, offset, count) as isize }
}

/// Raw `copy_file_range(2)` — libc-convention return.
///
/// Routed via `libc::syscall(SYS_copy_file_range, ..)` rather than rustix's
/// `fs::copy_file_range` because the rustix wrapper hard-codes `flags = 0`.
/// The Zig `std.os.linux.copy_file_range` and the pre-refactor path both
/// forward `flags` verbatim so the kernel can EINVAL future flag bits;
/// preserve that behavior exactly. Also avoids the `BorrowedFd` niche hazard
/// and `*mut i64 → &mut u64` type-pun on the offset pointers.
#[inline]
pub unsafe fn copy_file_range(
    in_: i32,
    off_in: *mut i64,
    out: i32,
    off_out: *mut i64,
    len: usize,
    flags: u32,
) -> isize {
    // SAFETY: raw `copy_file_range(2)`; kernel validates fds; offset ptrs may
    // be null.
    unsafe {
        libc::syscall(
            libc::SYS_copy_file_range,
            in_,
            off_in,
            out,
            off_out,
            len,
            flags as libc::c_long,
        ) as isize
    }
}

/// `pidfd_open(2)` — `Result` shape (caller maps to `bun_sys::Error`).
#[inline]
#[cfg(target_os = "linux")]
pub fn pidfd_open(pid: i32, flags: u32) -> Result<Fd, i32> {
    let pid = rustix::process::Pid::from_raw(pid).ok_or(libc::EINVAL)?;
    let flags = rustix::process::PidfdFlags::from_bits_retain(flags);
    once(rustix::process::pidfd_open(pid, flags)).map(own_fd)
}
/// Android: rustix 0.38 gates `process::pidfd_open` behind
/// `cfg(target_os = "linux")`, but the kernel ABI is identical (same generic
/// syscall number 434 since Linux 5.3, before any Android NDK target shipped).
/// Raw-syscall it like the other shims here.
#[inline]
#[cfg(target_os = "android")]
pub fn pidfd_open(pid: i32, flags: u32) -> Result<Fd, i32> {
    if pid <= 0 {
        return Err(libc::EINVAL);
    }
    // libc 0.2.x doesn't expose `SYS_pidfd_open` for Android either, so use
    // the kernel constant. `pidfd_open` has the same number on every arch.
    const SYS_PIDFD_OPEN: libc::c_long = 434;
    // SAFETY: raw `pidfd_open(2)`; kernel validates pid/flags.
    let rc = unsafe { libc::syscall(SYS_PIDFD_OPEN, pid, flags) };
    if rc < 0 {
        return Err(errno());
    }
    Ok(Fd::from_native(rc as i32))
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
