//! Cross-platform "system call" abstractions. On linux, many of these functions
//! emit direct system calls directly (std.os.linux). Others call `libc` APIs.
//! Windows uses a mix of `libuv`, `kernel32` and `ntdll`. macOS uses `libc`.
//!
//! Sometimes this namespace is referred to as "Syscall", prefer "bun.sys"/"sys"

// TODO: Split and organize this file. It is likely worth moving many functions
// into methods on `bun.FD`, and keeping this namespace to just overall stuff
// like `Error`, `Maybe`, `Tag`, and so on.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem;
use core::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, Ordering};

use bun_core::Environment;
use bun_paths::{PathBuffer, WPathBuffer, MAX_PATH_BYTES};
use bun_str::{strings, ZStr, WStr};

#[cfg(windows)]
use bun_errno::windows_errno as platform_defs;
#[cfg(target_os = "linux")]
use bun_errno::linux_errno as platform_defs;
#[cfg(target_os = "macos")]
use bun_errno::darwin_errno as platform_defs;
#[cfg(target_os = "freebsd")]
use bun_errno::freebsd_errno as platform_defs;

pub use bun_workaround_missing_symbols::current as workaround_symbols;

/// Enum of `errno` values
pub use platform_defs::E;
/// Namespace of (potentially polyfilled) libuv `errno` values.
/// Polyfilled on posix, mirrors the real libuv definitions on Windows.
pub use platform_defs::UV_E;
pub use platform_defs::S;
/// TODO: The way we do errors in Bun needs to get cleaned up. This enum is way
/// too complicated; It's duplicated three times, and inside of it it has tons
/// of re-listings of all errno codes. Why is SystemErrno different than `E`? ...etc!
///
/// The problem is because we use libc in some cases and we use zig's std lib in
/// other places and other times we go direct. So we end up with a lot of
/// redundant code.
pub use platform_defs::SystemErrno;
pub use platform_defs::get_errno;

// TODO(port): comptime { _ = &workaround_symbols; } — execute comptime logic to export any needed symbols
// In Rust this is handled by linking the crate; no force-reference needed.

#[cfg(windows)]
pub use crate::sys_uv;
#[cfg(not(windows))]
pub use self as sys_uv; // on posix, sys_uv is just this module

pub const F_OK: i32 = 0;
pub const X_OK: i32 = 1;
pub const W_OK: i32 = 2;
pub const R_OK: i32 = 4;

bun_output::declare_scope!(SYS, visible);
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(SYS, $($arg)*) };
}
pub use log as syslog;

// ──────────────────────────────────────────────────────────────────────────
// Debug-hook registration (CYCLEBREAK.md §Debug-hook). Low-tier `sys` cannot
// depend on `bun_crash_handler` (T3) / `bun_resolver::fs` (T5). High tier
// (`bun_runtime::init()`) writes the fn-ptr at startup; null = no-op.
// ──────────────────────────────────────────────────────------────────────────

/// Set by `bun_runtime::init()` to `bun_crash_handler::dump_current_stack_trace`.
/// Signature: `unsafe fn(return_address: Option<usize>, frame_count: u32, stop_at_jsc_llint: bool)`.
pub static DUMP_STACK: core::sync::atomic::AtomicPtr<()> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

#[inline]
pub fn dump_stack_trace(return_address: Option<usize>, frame_count: u32, stop_at_jsc_llint: bool) {
    let hook = DUMP_STACK.load(core::sync::atomic::Ordering::Relaxed);
    if !hook.is_null() {
        // SAFETY: registered by bun_runtime::init() with the signature documented on DUMP_STACK.
        let f: unsafe fn(Option<usize>, u32, bool) = unsafe { core::mem::transmute(hook) };
        unsafe { f(return_address, frame_count, stop_at_jsc_llint) };
    }
}

/// Set by `bun_runtime::init()` to `bun_resolver::fs::FileSystem::instance().top_level_dir`.
/// Signature: `fn() -> &'static [u8]`.
pub static TOP_LEVEL_DIR_HOOK: core::sync::atomic::AtomicPtr<()> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

#[inline]
pub fn top_level_dir() -> &'static [u8] {
    let hook = TOP_LEVEL_DIR_HOOK.load(core::sync::atomic::Ordering::Relaxed);
    if hook.is_null() {
        b"."
    } else {
        // SAFETY: registered by bun_runtime::init() with the signature documented on TOP_LEVEL_DIR_HOOK.
        let f: fn() -> &'static [u8] = unsafe { core::mem::transmute(hook) };
        f()
    }
}

// `syscall` namespace: on Linux this is direct syscalls, on macOS/FreeBSD it's libc.
// In Rust we route through the `libc` crate / direct syscall wrappers in `bun_sys::raw`.
// TODO(port): map `std.os.linux` vs `std.c` syscall namespace to a `raw` module per-platform.
#[cfg(target_os = "linux")]
use crate::raw::linux as syscall;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
use crate::raw::libc as syscall;

#[inline]
fn to_packed_o(number: u32) -> posix::OFlags {
    // SAFETY: posix::OFlags is repr(transparent) over the same width integer.
    unsafe { core::mem::transmute(number) }
}

pub type Mode = posix::mode_t;

// ──────────────────────────────────────────────────────────────────────────
// O: open(2) flag constants per-platform
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
pub mod O {
    pub const PATH: i32 = 0x0000;
    pub const RDONLY: i32 = 0x0000;
    pub const WRONLY: i32 = 0x0001;
    pub const RDWR: i32 = 0x0002;
    pub const NONBLOCK: i32 = 0x0004;
    pub const APPEND: i32 = 0x0008;
    pub const CREAT: i32 = 0x0200;
    pub const TRUNC: i32 = 0x0400;
    pub const EXCL: i32 = 0x0800;
    pub const SHLOCK: i32 = 0x0010;
    pub const EXLOCK: i32 = 0x0020;
    pub const NOFOLLOW: i32 = 0x0100;
    pub const SYMLINK: i32 = 0x200000;
    pub const EVTONLY: i32 = 0x8000;
    pub const CLOEXEC: i32 = 0x01000000;
    pub const ACCMODE: i32 = 3;
    pub const ALERT: i32 = 536870912;
    pub const ASYNC: i32 = 64;
    pub const DIRECTORY: i32 = 0x00100000;
    pub const DP_GETRAWENCRYPTED: i32 = 1;
    pub const DP_GETRAWUNENCRYPTED: i32 = 2;
    pub const DSYNC: i32 = 4194304;
    pub const FSYNC: i32 = SYNC;
    pub const NOCTTY: i32 = 131072;
    pub const POPUP: u32 = 2147483648;
    pub const SYNC: i32 = 128;

    pub use super::to_packed_o as to_packed;
}

#[cfg(target_os = "freebsd")]
pub mod O {
    pub const RDONLY: i32 = 0x0000;
    pub const WRONLY: i32 = 0x0001;
    pub const RDWR: i32 = 0x0002;
    pub const ACCMODE: i32 = 0x0003;
    pub const NONBLOCK: i32 = 0x0004;
    pub const APPEND: i32 = 0x0008;
    pub const SHLOCK: i32 = 0x0010;
    pub const EXLOCK: i32 = 0x0020;
    pub const ASYNC: i32 = 0x0040;
    pub const FSYNC: i32 = 0x0080;
    pub const SYNC: i32 = 0x0080;
    pub const NOFOLLOW: i32 = 0x0100;
    pub const CREAT: i32 = 0x0200;
    pub const TRUNC: i32 = 0x0400;
    pub const EXCL: i32 = 0x0800;
    pub const NOCTTY: i32 = 0x8000;
    pub const DIRECT: i32 = 0x00010000;
    pub const DIRECTORY: i32 = 0x00020000;
    pub const CLOEXEC: i32 = 0x00100000;
    pub const PATH: i32 = 0x00400000;
    pub const DSYNC: i32 = 0x01000000;
    pub const NDELAY: i32 = NONBLOCK;
    // Darwin-only flags referenced unconditionally elsewhere; map to 0 so
    // `flags & O.EVTONLY` etc. compile and are no-ops.
    pub const EVTONLY: i32 = 0x0000;
    pub const SYMLINK: i32 = 0x0000;
    pub const TMPFILE: i32 = 0x0000;

    pub use super::to_packed_o as to_packed;
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub mod O {
    pub const RDONLY: i32 = 0x0000;
    pub const WRONLY: i32 = 0x0001;
    pub const RDWR: i32 = 0x0002;

    pub const CREAT: i32 = 0o100;
    pub const EXCL: i32 = 0o200;
    pub const NOCTTY: i32 = 0o400;
    pub const TRUNC: i32 = 0o1000;
    pub const APPEND: i32 = 0o2000;
    pub const NONBLOCK: i32 = 0o4000;
    pub const DSYNC: i32 = 0o10000;
    pub const SYNC: i32 = 0o4010000;
    pub const RSYNC: i32 = 0o4010000;
    pub const DIRECTORY: i32 = 0o200000;
    pub const NOFOLLOW: i32 = 0o400000;
    pub const CLOEXEC: i32 = 0o2000000;

    pub const ASYNC: i32 = 0o20000;
    pub const DIRECT: i32 = 0o40000;
    pub const LARGEFILE: i32 = 0;
    pub const NOATIME: i32 = 0o1000000;
    pub const PATH: i32 = 0o10000000;
    pub const TMPFILE: i32 = 0o20200000;
    pub const NDELAY: i32 = NONBLOCK;

    pub use super::to_packed_o as to_packed;
}

#[cfg(all(target_os = "linux", not(target_arch = "x86_64")))]
pub mod O {
    pub const RDONLY: i32 = 0x0000;
    pub const WRONLY: i32 = 0x0001;
    pub const RDWR: i32 = 0x0002;

    pub const CREAT: i32 = 0o100;
    pub const EXCL: i32 = 0o200;
    pub const NOCTTY: i32 = 0o400;
    pub const TRUNC: i32 = 0o1000;
    pub const APPEND: i32 = 0o2000;
    pub const NONBLOCK: i32 = 0o4000;
    pub const DSYNC: i32 = 0o10000;
    pub const SYNC: i32 = 0o4010000;
    pub const RSYNC: i32 = 0o4010000;
    pub const DIRECTORY: i32 = 0o40000;
    pub const NOFOLLOW: i32 = 0o100000;
    pub const CLOEXEC: i32 = 0o2000000;

    pub const ASYNC: i32 = 0o20000;
    pub const DIRECT: i32 = 0o200000;
    pub const LARGEFILE: i32 = 0o400000;
    pub const NOATIME: i32 = 0o1000000;
    pub const PATH: i32 = 0o10000000;
    pub const TMPFILE: i32 = 0o20040000;
    pub const NDELAY: i32 = NONBLOCK;

    pub const SYMLINK: i32 = bun_c::O_SYMLINK;

    pub use super::to_packed_o as to_packed;
}

#[cfg(windows)]
pub mod O {
    pub const RDONLY: i32 = 0o0;
    pub const WRONLY: i32 = 0o1;
    pub const RDWR: i32 = 0o2;

    pub const CREAT: i32 = 0o100;
    pub const EXCL: i32 = 0o200;
    pub const NOCTTY: i32 = 0;
    pub const TRUNC: i32 = 0o1000;
    pub const APPEND: i32 = 0o2000;
    pub const NONBLOCK: i32 = 0o4000;
    pub const DSYNC: i32 = 0o10000;
    pub const SYNC: i32 = 0o4010000;
    pub const RSYNC: i32 = 0o4010000;
    pub const DIRECTORY: i32 = 0o200000;
    pub const NOFOLLOW: i32 = 0o400000;
    pub const CLOEXEC: i32 = 0o2000000;

    pub const ASYNC: i32 = 0o20000;
    pub const DIRECT: i32 = 0o40000;
    pub const LARGEFILE: i32 = 0;
    pub const NOATIME: i32 = 0o1000000;
    pub const PATH: i32 = 0o10000000;
    pub const TMPFILE: i32 = 0o20200000;
    pub const NDELAY: i32 = NONBLOCK;

    pub use super::to_packed_o as to_packed;
}

// ──────────────────────────────────────────────────────────────────────────
// Tag: syscall identifier for error reporting
// ──────────────────────────────────────────────────────────────────────────
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
#[allow(non_camel_case_types)]
pub enum Tag {
    TODO,

    dup,
    access,
    connect,
    chmod,
    chown,
    clonefile,
    clonefileat,
    close,
    copy_file_range,
    copyfile,
    fchmod,
    fchmodat,
    fchown,
    fcntl,
    fdatasync,
    fstat,
    fstatat,
    fsync,
    ftruncate,
    futimens,
    getdents64,
    getdirentries64,
    lchmod,
    lchown,
    link,
    lseek,
    lstat,
    lutime,
    mkdir,
    mkdtemp,
    fnctl,
    memfd_create,
    mmap,
    munmap,
    open,
    pread,
    pwrite,
    read,
    readlink,
    rename,
    stat,
    statfs,
    symlink,
    symlinkat,
    unlink,
    utime,
    utimensat,
    write,
    getcwd,
    getenv,
    chdir,
    fcopyfile,
    recv,
    send,
    sendfile,
    sendmmsg,
    splice,
    rmdir,
    truncate,
    realpath,
    futime,
    pidfd_open,
    poll,
    ppoll,
    watch,
    scandir,

    kevent,
    kqueue,
    epoll_ctl,
    kill,
    waitpid,
    posix_spawn,
    getaddrinfo,
    writev,
    pwritev,
    readv,
    preadv,
    ioctl_ficlone,
    accept,
    bind2,
    connect2,
    listen,
    pipe,
    try_write,
    socketpair,
    setsockopt,
    statx,
    rm,

    uv_spawn,
    uv_pipe,
    uv_tty_set_mode,
    uv_open_osfhandle,
    uv_os_homedir,

    // Below this line are Windows API calls only.

    WriteFile,
    NtQueryDirectoryFile,
    NtSetInformationFile,
    GetFinalPathNameByHandle,
    CloseHandle,
    SetFilePointerEx,
    SetEndOfFile,
}

impl Tag {
    pub fn is_windows(self) -> bool {
        (self as u8) > (Tag::WriteFile as u8)
    }

    // TODO(port): `pub var strings = std.EnumMap(Tag, jsc.C.JSStringRef).initFull(null);`
    // This is a mutable global JSStringRef cache; belongs in *_jsc crate.
}

pub use crate::error::Error;
pub use crate::posix_stat::PosixStat;

/// `Maybe(T)` — tagged union of `Ok(T)` or `Err(Error)`.
/// Aliased as the crate's `Result<T>`.
pub type Result<T> = crate::node::Maybe<T, Error>;
// TODO(b0): `node::Maybe` arrives from move-in (CYCLEBREAK MOVE_DOWN bun_runtime::node → sys).
// In Phase A we use a type alias; the helpers `errno_sys*` are associated fns on it.

// Convenience: in the Zig, `Maybe(T).errnoSys*()` are static helpers that return
// `Option<Maybe<T>>` (Some(err) on failure, None on success). We mirror that.
// TODO(port): these helpers live on the `Maybe` type in `bun.api.node`; re-exported here.

pub fn getcwd(buf: &mut PathBuffer) -> Result<&[u8]> {
    match getcwd_z(buf) {
        Result::Err(err) => Result::Err(err),
        Result::Ok(cwd) => Result::Ok(cwd.as_bytes()),
    }
}

pub fn getcwd_z(buf: &mut PathBuffer) -> Result<&ZStr> {
    buf[0] = 0;

    #[cfg(windows)]
    {
        let wbuf = bun_paths::w_path_buffer_pool().get();
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let len: windows::DWORD = unsafe { kernel32::GetCurrentDirectoryW(wbuf.len() as u32, wbuf.as_mut_ptr()) };
        if let Some(err) = Result::<&ZStr>::errno_sys_p(len, Tag::getcwd, buf) {
            return err;
        }
        return Result::Ok(strings::from_w_path(buf, &wbuf[0..len as usize]));
    }

    #[cfg(not(windows))]
    {
        // SAFETY: getcwd writes into buf and returns either buf.ptr or null.
        let rc: *mut c_char = unsafe { libc::getcwd(buf.as_mut_ptr() as *mut c_char, MAX_PATH_BYTES) };
        if !rc.is_null() {
            // SAFETY: getcwd NUL-terminates on success.
            let len = unsafe { libc::strlen(rc) };
            // SAFETY: buffer is NUL-terminated at the given length (written above).
            Result::Ok(unsafe { ZStr::from_raw(rc as *const u8, len) })
        } else {
            Result::<&ZStr>::errno_sys_p(0 as c_int, Tag::getcwd, buf).unwrap()
        }
    }
}

// `syscall_or_c`: on Linux use direct syscalls, otherwise libc.
// TODO(port): in Rust both go through the `syscall` module above; the distinction is encoded there.

pub fn fchown(fd: Fd, uid: node::uid_t, gid: node::gid_t) -> Result<()> {
    #[cfg(windows)]
    {
        return sys_uv::fchown(fd, uid, gid);
    }

    #[cfg(not(windows))]
    loop {
        // SAFETY: FFI call with valid live fd; uid/gid are plain integers.
        let rc = unsafe { syscall::fchown(fd.cast(), uid, gid) };
        if let Some(err) = Result::<()>::errno_sys_fd(rc, Tag::fchown, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

pub fn fchmod(fd: Fd, mode: Mode) -> Result<()> {
    #[cfg(windows)]
    {
        return sys_uv::fchmod(fd, mode);
    }

    #[cfg(not(windows))]
    loop {
        // SAFETY: FFI call with valid live fd.
        let rc = unsafe { syscall::fchmod(fd.cast(), mode) };
        if let Some(err) = Result::<()>::errno_sys_fd(rc, Tag::fchmod, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

#[cfg(not(windows))]
pub fn fchmodat(
    fd: Fd,
    path: &ZStr,
    mode: Mode,
    #[cfg(target_os = "linux")] flags: u32,
    #[cfg(not(target_os = "linux"))] flags: i32,
) -> Result<()> {
    loop {
        // SAFETY: FFI call with valid fd and NUL-terminated path.
        let rc = unsafe { syscall::fchmodat(fd.cast(), path.as_ptr(), mode, flags) };
        if let Some(err) = Result::<()>::errno_sys_fd(rc, Tag::fchmodat, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

pub fn chmod(path: &ZStr, mode: Mode) -> Result<()> {
    #[cfg(windows)]
    {
        return sys_uv::chmod(path, mode);
    }

    #[cfg(not(windows))]
    loop {
        // SAFETY: FFI call with valid NUL-terminated path.
        let rc = unsafe { syscall::chmod(path.as_ptr(), mode) };
        if let Some(err) = Result::<()>::errno_sys_p(rc, Tag::chmod, path) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

pub fn chdir_os_path(
    path: &ZStr,
    #[cfg(unix)] destination: &ZStr,
    #[cfg(not(unix))] destination: &[u8],
) -> Result<()> {
    #[cfg(unix)]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::chdir(destination.as_ptr()) };
        return Result::<()>::errno_sys_pd(rc, Tag::chdir, path, destination).unwrap_or(Result::Ok(()));
    }

    #[cfg(windows)]
    {
        let wbuf = bun_paths::w_path_buffer_pool().get();
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        if unsafe { c::SetCurrentDirectoryW(strings::to_w_dir_path(&mut *wbuf, destination).as_ptr()) } == windows::FALSE {
            log!("SetCurrentDirectory({}) = {}", bstr::BStr::new(destination), unsafe { kernel32::GetLastError() });
            return Result::<()>::errno_sys_pd(0, Tag::chdir, path, destination).unwrap_or(Result::Ok(()));
        }

        log!("SetCurrentDirectory({}) = {}", bstr::BStr::new(destination), 0);
        return Result::Ok(());
    }

    #[cfg(not(any(unix, windows)))]
    compile_error!("Not implemented yet");
}

// TODO(port): `chdir(path: anytype, destination: anytype)` — Zig uses anytype to dispatch
// on whether the args are sentinel-terminated. In Rust, callers should pass `&ZStr` directly
// or call `chdir_os_path` after building a posix path. We provide a thin wrapper:
pub fn chdir(path: impl AsRef<[u8]>, destination: impl AsRef<[u8]>) -> Result<()> {
    #[cfg(unix)]
    {
        let p = match posix::to_posix_path(path.as_ref()) {
            Ok(p) => p,
            Err(_) => return Result::Err(Error { errno: SystemErrno::EINVAL as _, syscall: Tag::chdir, ..Default::default() }),
        };
        let d = match posix::to_posix_path(destination.as_ref()) {
            Ok(d) => d,
            Err(_) => return Result::Err(Error { errno: SystemErrno::EINVAL as _, syscall: Tag::chdir, ..Default::default() }),
        };
        return chdir_os_path(&p, &d);
    }

    #[cfg(windows)]
    {
        // TODO(port): handle `*[*:0]u16` and `OSPathSliceZ` typed dispatch from Zig anytype.
        return chdir_os_path(
            // path is only used for error reporting on windows
            ZStr::from_bytes(path.as_ref()),
            destination.as_ref(),
        );
    }

    #[cfg(not(any(unix, windows)))]
    Result::<()>::todo()
}

#[cfg(target_os = "linux")]
pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Result<usize> {
    loop {
        // SAFETY: FFI call with valid live fds and null offset pointer (use file offset).
        let rc = unsafe {
            syscall::sendfile(
                dest.cast(),
                src.cast(),
                core::ptr::null_mut(),
                // we set a maximum to avoid EINVAL
                len.min((i32::MAX - 1) as usize),
            )
        };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::sendfile, src) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn stat(path: &ZStr) -> Result<bun_core::Stat> {
    #[cfg(windows)]
    {
        return sys_uv::stat(path);
    }
    #[cfg(not(windows))]
    loop {
        // SAFETY: all-zero is a valid Stat (repr(C) POD).
        let mut stat_ = unsafe { mem::zeroed::<bun_core::Stat>() };
        let rc = {
            #[cfg(target_os = "linux")]
            // aarch64 linux doesn't implement a "stat" syscall. It's all fstatat.
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { syscall::fstatat(posix::AT_FDCWD, path.as_ptr(), &mut stat_, 0) } }
            #[cfg(not(target_os = "linux"))]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { workaround_symbols::stat(path.as_ptr(), &mut stat_) } }
        };

        if cfg!(debug_assertions) {
            log!("stat({}) = {}", bstr::BStr::new(path.as_bytes()), rc);
        }

        if let Some(err) = Result::<bun_core::Stat>::errno_sys_p(rc, Tag::stat, path) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }

        return Result::Ok(stat_);
    }
}

pub fn statfs(path: &ZStr) -> Result<bun_core::StatFS> {
    #[cfg(windows)]
    {
        return Result::Err(Error::from_code(E::NOSYS, Tag::statfs));
    }
    #[cfg(not(windows))]
    loop {
        // SAFETY: all-zero is a valid StatFS.
        let mut statfs_ = unsafe { mem::zeroed::<bun_core::StatFS>() };
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { c::statfs(path.as_ptr(), &mut statfs_) };

        if cfg!(debug_assertions) {
            log!("statfs({}) = {}", bstr::BStr::new(path.as_bytes()), rc);
        }

        if let Some(err) = Result::<bun_core::StatFS>::errno_sys_p(rc, Tag::statfs, path) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(statfs_);
    }
}

pub fn lstat(path: &ZStr) -> Result<bun_core::Stat> {
    #[cfg(windows)]
    {
        return sys_uv::lstat(path);
    }
    #[cfg(not(windows))]
    loop {
        // SAFETY: all-zero is a valid Stat.
        let mut stat_buf = unsafe { mem::zeroed::<bun_core::Stat>() };
        if let Some(err) = Result::<bun_core::Stat>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { workaround_symbols::lstat(path.as_ptr(), &mut stat_buf) },
            Tag::lstat,
            path,
        ) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(stat_buf);
    }
}

pub fn fstat(fd: Fd) -> Result<bun_core::Stat> {
    #[cfg(windows)]
    {
        // TODO: this is a bad usage of makeLibUVOwned
        let uvfd = match fd.make_lib_uv_owned() {
            Ok(f) => f,
            Err(_) => return Result::Err(Error::from_code(E::MFILE, Tag::uv_open_osfhandle)),
        };
        return sys_uv::fstat(uvfd);
    }

    #[cfg(not(windows))]
    loop {
        // SAFETY: all-zero is a valid Stat.
        let mut stat_ = unsafe { mem::zeroed::<bun_core::Stat>() };

        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { workaround_symbols::fstat(fd.cast(), &mut stat_) };

        if cfg!(debug_assertions) {
            log!("fstat({}) = {}", fd, rc);
        }

        if let Some(err) = Result::<bun_core::Stat>::errno_sys_fd(rc, Tag::fstat, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }

        return Result::Ok(stat_);
    }
}

#[cfg(target_os = "linux")]
#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum StatxField {
    Type = syscall::STATX_TYPE,
    Mode = syscall::STATX_MODE,
    Nlink = syscall::STATX_NLINK,
    Uid = syscall::STATX_UID,
    Gid = syscall::STATX_GID,
    Atime = syscall::STATX_ATIME,
    Mtime = syscall::STATX_MTIME,
    Ctime = syscall::STATX_CTIME,
    Btime = syscall::STATX_BTIME,
    Ino = syscall::STATX_INO,
    Size = syscall::STATX_SIZE,
    Blocks = syscall::STATX_BLOCKS,
}

// Linux Kernel v4.11
pub static SUPPORTS_STATX_ON_LINUX: AtomicBool = AtomicBool::new(true);

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
enum LinuxKernel {
    Unknown = 0,
    Linux = 1,
    /// FreeBSD Linuxulator (linprocfs).
    FreeBSD = 2,
}

impl LinuxKernel {
    // TODO(port): Zig used `std.atomic.Value(LinuxKernel)`; Rust atomics don't support
    // arbitrary enums directly, so we store as u8 and transmute on load.
    fn cached() -> &'static AtomicU8 {
        static CACHED: AtomicU8 = AtomicU8::new(0); // Unknown
        &CACHED
    }

    /// Reads /proc/version to determine if we're under FreeBSD's Linuxulator.
    /// linprocfs hardcodes "des@freebsd.org" in the version string.
    fn detect() -> LinuxKernel {
        let mut buf = [0u8; 512];
        let fd = match open(ZStr::from_bytes(b"/proc/version"), O::RDONLY | O::NOCTTY, 0) {
            Result::Ok(fd) => fd,
            Result::Err(_) => return LinuxKernel::Linux,
        };
        let _close = scopeguard::guard((), |_| fd.close());
        let n = match read(fd, &mut buf) {
            Result::Ok(n) => n,
            Result::Err(_) => return LinuxKernel::Linux,
        };
        if strings::contains_case_insensitive_ascii(&buf[0..n], b"freebsd") {
            return LinuxKernel::FreeBSD;
        }
        LinuxKernel::Linux
    }

    fn get() -> LinuxKernel {
        let v = Self::cached().load(Ordering::Acquire);
        if v != LinuxKernel::Unknown as u8 {
            // SAFETY: only stored values are valid LinuxKernel discriminants.
            return unsafe { core::mem::transmute(v) };
        }
        let detected = Self::detect();
        Self::cached().store(detected as u8, Ordering::Release);
        detected
    }
}

/// Linux kernel makedev encoding for device numbers
/// From glibc sys/sysmacros.h and Linux kernel <linux/kdev_t.h>
/// dev_t layout (64 bits):
///   Bits 31-20: major high (12 bits)
///   Bits 19-8:  minor high (12 bits)
///   Bits 7-0:   minor low (8 bits)
#[inline]
fn makedev(major: u32, minor: u32) -> u64 {
    let maj: u64 = (major & 0xFFF) as u64;
    let min: u64 = (minor & 0xFFFFF) as u64;
    (maj << 8) | (min & 0xFF) | ((min & 0xFFF00) << 12)
}

#[cfg(target_os = "linux")]
fn statx_fallback(fd: Fd, path: Option<*const c_char>, flags: u32) -> Result<PosixStat> {
    if let Some(p) = path {
        // SAFETY: caller passed a valid NUL-terminated pointer.
        let path_span = unsafe { ZStr::from_ptr(p as *const u8) };
        let fallback = if flags & syscall::AT_SYMLINK_NOFOLLOW != 0 {
            lstat(path_span)
        } else {
            stat(path_span)
        };
        match fallback {
            Result::Ok(s) => Result::Ok(PosixStat::init(&s)),
            Result::Err(e) => Result::Err(e),
        }
    } else {
        match fstat(fd) {
            Result::Ok(s) => Result::Ok(PosixStat::init(&s)),
            Result::Err(e) => Result::Err(e),
        }
    }
}

#[cfg(target_os = "linux")]
fn statx_impl(fd: Fd, path: Option<*const c_char>, flags: u32, mask: u32) -> Result<PosixStat> {
    // SAFETY: all-zero is a valid Statx (repr(C) POD).
    let mut buf: syscall::Statx = unsafe { mem::zeroed() };

    loop {
        // SAFETY: FFI call with valid fd, NUL-terminated path (or empty), and zeroed out-buffer.
        let rc = unsafe {
            syscall::statx(
                i32::try_from(fd.cast()).unwrap(),
                path.unwrap_or(b"\0".as_ptr() as *const c_char),
                flags,
                mask,
                &mut buf,
            )
        };

        // On some setups (QEMU user-mode, S390 RHEL docker), statx returns a
        // positive value other than 0 with errno unset — neither a normal
        // success (0) nor a kernel -errno. Treat as "not implemented".
        // See nodejs/node#27275 and libuv/libuv src/unix/fs.c.
        if (rc as isize) > 0 {
            SUPPORTS_STATX_ON_LINUX.store(false, Ordering::Relaxed);
            return statx_fallback(fd, path, flags);
        }

        if let Some(err) = Result::<PosixStat>::errno_sys(rc, Tag::statx) {
            // Retry on EINTR
            if err.get_errno() == E::INTR { continue; }

            // Handle unsupported statx by setting the flag and falling back.
            // Fall back on the same errnos libuv does (deps/uv/src/unix/fs.c):
            //   ENOSYS:     kernel < 4.11
            //   EOPNOTSUPP: filesystem doesn't support it
            //   EPERM:      seccomp filter rejects statx (libseccomp < 2.3.3,
            //               docker < 18.04, various CI sandboxes)
            //   EINVAL:     old Android builds
            match err.get_errno() {
                E::NOSYS | E::OPNOTSUPP | E::PERM | E::INVAL => {
                    SUPPORTS_STATX_ON_LINUX.store(false, Ordering::Relaxed);
                    return statx_fallback(fd, path, flags);
                }
                _ => return err,
            }
        }

        // Convert statx buffer to PosixStat structure
        let stat_ = PosixStat {
            dev: makedev(buf.dev_major, buf.dev_minor),
            ino: buf.ino,
            mode: buf.mode,
            nlink: buf.nlink,
            uid: buf.uid,
            gid: buf.gid,
            rdev: makedev(buf.rdev_major, buf.rdev_minor),
            size: buf.size,
            blksize: buf.blksize,
            blocks: buf.blocks,
            atim: PosixStat::Timespec { sec: buf.atime.sec, nsec: buf.atime.nsec },
            mtim: PosixStat::Timespec { sec: buf.mtime.sec, nsec: buf.mtime.nsec },
            ctim: PosixStat::Timespec { sec: buf.ctime.sec, nsec: buf.ctime.nsec },
            birthtim: if buf.mask & syscall::STATX_BTIME != 0 {
                PosixStat::Timespec { sec: buf.btime.sec, nsec: buf.btime.nsec }
            } else {
                PosixStat::Timespec { sec: 0, nsec: 0 }
            },
        };

        return Result::Ok(stat_);
    }
}

#[cfg(target_os = "linux")]
pub fn fstatx(fd: Fd, fields: &[StatxField]) -> Result<PosixStat> {
    // PERF(port): was comptime mask fold — profile in Phase B
    let mut mask: u32 = 0;
    for field in fields {
        mask |= *field as u32;
    }
    statx_impl(fd, None, syscall::AT_EMPTY_PATH, mask)
}

#[cfg(target_os = "linux")]
pub fn statx(path: *const c_char, fields: &[StatxField]) -> Result<PosixStat> {
    let mut mask: u32 = 0;
    for field in fields {
        mask |= *field as u32;
    }
    statx_impl(Fd::from_native(posix::AT_FDCWD), Some(path), 0, mask)
}

#[cfg(target_os = "linux")]
pub fn lstatx(path: *const c_char, fields: &[StatxField]) -> Result<PosixStat> {
    let mut mask: u32 = 0;
    for field in fields {
        mask |= *field as u32;
    }
    statx_impl(Fd::from_native(posix::AT_FDCWD), Some(path), syscall::AT_SYMLINK_NOFOLLOW, mask)
}

pub fn lutimes(path: &ZStr, atime: node::TimeLike, mtime: node::TimeLike) -> Result<()> {
    #[cfg(windows)]
    {
        return sys_uv::lutimes(path, atime, mtime);
    }

    #[cfg(not(windows))]
    utimens_with_flags(path, atime, mtime, posix::AT_SYMLINK_NOFOLLOW)
}

#[cfg(windows)]
pub fn mkdirat_a(dir_fd: Fd, file_path: &[u8]) -> Result<()> {
    let buf = bun_paths::w_path_buffer_pool().get();
    mkdirat_w(dir_fd, strings::to_w_path_normalized(&mut *buf, file_path), 0)
}

#[cfg(unix)]
pub fn mkdirat_z(dir_fd: Fd, file_path: *const c_char, mode: Mode) -> Result<()> {
    Result::<()>::errno_sys_p(
        // SAFETY: FFI call with valid dirfd and NUL-terminated path.
        unsafe { syscall::mkdirat(dir_fd.cast().try_into().unwrap(), file_path, mode) },
        Tag::mkdir,
        file_path,
    )
    .unwrap_or(Result::Ok(()))
}

#[cfg(unix)]
fn mkdirat_posix(dir_fd: Fd, file_path: &[u8], mode: Mode) -> Result<()> {
    let p = match posix::to_posix_path(file_path) {
        Ok(p) => p,
        Err(_) => return Result::Err(Error::from_code(E::NAMETOOLONG, Tag::mkdir)),
    };
    mkdirat_z(dir_fd, p.as_ptr(), mode)
}

#[cfg(windows)]
pub use mkdirat_w as mkdirat;
#[cfg(not(windows))]
pub use mkdirat_posix as mkdirat;

#[cfg(windows)]
pub fn mkdirat_w(dir_fd: Fd, file_path: &WStr, _mode: i32) -> Result<()> {
    let dir_to_make = open_dir_at_windows_nt_path(
        dir_fd,
        file_path,
        WindowsOpenDirOptions { iterable: false, can_rename_or_delete: true, op: WindowsOpenDirOp::OnlyCreate, ..Default::default() },
    );
    match dir_to_make {
        Result::Err(err) => Result::Err(err),
        Result::Ok(fd) => {
            fd.close();
            Result::Ok(())
        }
    }
}

pub fn fstatat(fd: Fd, path: &ZStr) -> Result<bun_core::Stat> {
    #[cfg(windows)]
    {
        return match openat_windows_a(fd, path.as_bytes(), 0, 0) {
            Result::Ok(file) => {
                let r = fstat(file);
                file.close();
                r
            }
            Result::Err(err) => Result::Err(err),
        };
    }
    #[cfg(not(windows))]
    {
        let fd_valid = if fd == Fd::invalid() { posix::AT_FDCWD } else { fd.native() };
        loop {
            // SAFETY: all-zero is a valid Stat.
            let mut stat_buf = unsafe { mem::zeroed::<bun_core::Stat>() };
            if let Some(err) = Result::<bun_core::Stat>::errno_sys_fp(
                // SAFETY: FFI call; arguments are valid for the duration of the call.
                unsafe { syscall::fstatat(fd_valid, path.as_ptr(), &mut stat_buf, 0) },
                Tag::fstatat,
                fd,
                path,
            ) {
                if err.get_errno() == E::INTR { continue; }
                log!("fstatat({}, {}) = {}", fd, bstr::BStr::new(path.as_bytes()), <&str>::from(err.get_errno()));
                return err;
            }
            log!("fstatat({}, {}) = 0", fd, bstr::BStr::new(path.as_bytes()));
            return Result::Ok(stat_buf);
        }
    }
}

/// Like fstatat but does not follow symlinks (uses AT.SYMLINK_NOFOLLOW).
/// This is the "at" equivalent of lstat.
pub fn lstatat(fd: Fd, path: &ZStr) -> Result<bun_core::Stat> {
    #[cfg(windows)]
    {
        // Use O.NOFOLLOW to not follow symlinks (FILE_OPEN_REPARSE_POINT on Windows)
        return match openat_windows_a(fd, path.as_bytes(), O::NOFOLLOW, 0) {
            Result::Ok(file) => {
                let r = fstat(file);
                file.close();
                r
            }
            Result::Err(err) => Result::Err(err),
        };
    }
    #[cfg(not(windows))]
    {
        let fd_valid = if fd == Fd::invalid() { posix::AT_FDCWD } else { fd.native() };
        loop {
            // SAFETY: all-zero is a valid Stat.
            let mut stat_buf = unsafe { mem::zeroed::<bun_core::Stat>() };
            if let Some(err) = Result::<bun_core::Stat>::errno_sys_fp(
                // SAFETY: FFI call; arguments are valid for the duration of the call.
                unsafe { syscall::fstatat(fd_valid, path.as_ptr(), &mut stat_buf, posix::AT_SYMLINK_NOFOLLOW) },
                Tag::fstatat,
                fd,
                path,
            ) {
                if err.get_errno() == E::INTR { continue; }
                log!("lstatat({}, {}) = {}", fd, bstr::BStr::new(path.as_bytes()), <&str>::from(err.get_errno()));
                return err;
            }
            log!("lstatat({}, {}) = 0", fd, bstr::BStr::new(path.as_bytes()));
            return Result::Ok(stat_buf);
        }
    }
}

pub fn mkdir(file_path: &ZStr, flags: Mode) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "freebsd", target_os = "linux"))]
    {
        Result::<()>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::mkdir(file_path.as_ptr(), flags) },
            Tag::mkdir,
            file_path,
        )
        .unwrap_or(Result::Ok(()))
    }

    #[cfg(windows)]
    {
        let wbuf = bun_paths::w_path_buffer_pool().get();
        Result::<()>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { windows::CreateDirectoryW(strings::to_kernel32_path(&mut *wbuf, file_path.as_bytes()).as_ptr(), core::ptr::null()) },
            Tag::mkdir,
            file_path,
        )
        .unwrap_or(Result::Ok(()))
    }
}

pub fn mkdir_a(file_path: &[u8], flags: Mode) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "freebsd", target_os = "linux"))]
    {
        let p = match posix::to_posix_path(file_path) {
            Ok(p) => p,
            Err(_) => return Result::Err(Error { errno: E::NOMEM as _, syscall: Tag::open, ..Default::default() }),
        };
        return Result::<()>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::mkdir(p.as_ptr(), flags) },
            Tag::mkdir,
            file_path,
        )
        .unwrap_or(Result::Ok(()));
    }

    #[cfg(windows)]
    {
        let wbuf = bun_paths::w_path_buffer_pool().get();
        let wpath = strings::to_kernel32_path(&mut *wbuf, file_path);
        return Result::<()>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { kernel32::CreateDirectoryW(wpath.as_ptr(), core::ptr::null()) },
            Tag::mkdir,
            file_path,
        )
        .unwrap_or(Result::Ok(()));
    }
}

pub fn mkdir_os_path(file_path: bun_paths::OSPathSliceZ<'_>, flags: Mode) -> Result<()> {
    #[cfg(not(windows))]
    {
        mkdir(file_path, flags)
    }
    #[cfg(windows)]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { c::CreateDirectoryW(file_path.as_ptr(), core::ptr::null()) };
        if let Some(err) = Result::<()>::errno_sys(rc, Tag::mkdir) {
            log!("CreateDirectoryW({}) = {}", bun_core::fmt::fmt_os_path(file_path), err.err().name());
            return err;
        }
        log!("CreateDirectoryW({}) = 0", bun_core::fmt::fmt_os_path(file_path));
        Result::Ok(())
    }
}

#[cfg(target_os = "linux")]
type FnctlInt = usize;
#[cfg(not(target_os = "linux"))]
type FnctlInt = c_int;

// TODO(port): Zig `fcntl(fd, cmd, arg: anytype)` dispatches on @TypeOf(arg).
// Rust `libc::fcntl` is variadic; we expose a single fn taking `usize` and let
// callers cast. The i64 / *anyopaque arms collapse to usize on 64-bit.
pub fn fcntl(fd: Fd, cmd: i32, arg: usize) -> Result<FnctlInt> {
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let result = unsafe { syscall::fcntl(fd.native(), cmd, arg) };
        if let Some(err) = Result::<FnctlInt>::errno_sys_fd(result, Tag::fcntl, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(result as FnctlInt);
    }
}

/// Normalizes for ntdll.dll APIs. Replaces long-path prefixes with nt object
/// prefixes, which may not function properly in kernel32 APIs.
// TODO: Rename to normalizePathWindowsForNtdll
#[cfg(windows)]
pub fn normalize_path_windows<T: WinPathChar>(
    dir_fd: Fd,
    path_: &[T],
    buf: &mut WPathBuffer,
    add_nt_prefix: bool,
) -> Result<&WStr> {
    // TODO(port): T is constrained to u8 or u16 via WinPathChar trait (Phase B).

    let name_too_long: Result<&WStr> = Result::Err(Error {
        errno: E::NAMETOOLONG as _,
        syscall: Tag::open,
        ..Default::default()
    });
    // normalizeStringGenericTZ writes into `buf` with .add_nt_prefix = true and
    // .zero_terminate = true but performs no bounds checking of its own. The NT
    // prefix adds up to 6 u16 ("\\" -> "\??\UNC\") plus a NUL. Reserve enough
    // headroom wherever we feed it a path that could approach `buf.len`.
    const NT_PREFIX_HEADROOM: usize = 8;

    // TODO(port): conditional WPathBuffer pool guard when T != u16.
    let wbuf_guard = if !T::IS_U16 { Some(bun_paths::w_path_buffer_pool().get()) } else { None };
    // convertUTF8toUTF16InBuffer forwards only `output.ptr` to simdutf, which
    // performs no output bounds checking. UTF-16 output length is always <=
    // UTF-8 input byte length, so `path_.len` is a cheap upper bound; when it
    // exceeds `wbuf.len`, compute the exact post-conversion length to avoid
    // over-rejecting multi-byte inputs whose UTF-16 representation fits.
    if !T::IS_U16 {
        let wbuf = wbuf_guard.as_mut().unwrap();
        if path_.len() > wbuf.len() && bun_simdutf::length::utf16_from_utf8(T::as_u8_slice(path_)) > wbuf.len() {
            return name_too_long;
        }
    }
    let mut path: &[u16] = if T::IS_U16 {
        T::as_u16_slice(path_)
    } else {
        strings::convert_utf8_to_utf16_in_buffer(wbuf_guard.as_mut().unwrap(), T::as_u8_slice(path_))
    };

    if bun_paths::is_absolute_windows_wtf16(path) {
        // `path_.len` guards the `path_[path_.len - 4 ..]` slice below; `path.len`
        // guards `path[1]`/`path[3]`. For T == u8 these can differ when the input
        // contains multi-byte UTF-8 (e.g. "\\\\é" is 4 bytes but 3 u16).
        if path_.len() >= 4 && path.len() >= 4 {
            if strings::eql_t::<T>(&path_[path_.len() - 4..], b"\\nul")
                || strings::eql_t::<T>(&path_[path_.len() - 4..], b"\\NUL")
            {
                let nul = bun_str::w!("\\??\\NUL");
                buf[0..nul.len()].copy_from_slice(nul);
                buf[nul.len()] = 0;
                // SAFETY: we just wrote NUL at buf[nul.len()].
                return Result::Ok(unsafe { WStr::from_raw(buf.as_ptr(), nul.len()) });
            }
            if (path[1] == b'/' as u16 || path[1] == b'\\' as u16)
                && (path[3] == b'/' as u16 || path[3] == b'\\' as u16)
            {
                // Preserve the device path, instead of resolving '.' as a relative
                // path. This prevents simplifying the path '\\.\pipe' into '\pipe'
                if path[2] == b'.' as u16 {
                    if path.len() >= buf.len() {
                        return name_too_long;
                    }
                    buf[0..4].copy_from_slice(&[b'\\' as u16, b'\\' as u16, b'.' as u16, b'\\' as u16]);
                    let rest = &path[4..];
                    buf[4..4 + rest.len()].copy_from_slice(rest);
                    buf[path.len()] = 0;
                    // SAFETY: NUL written at buf[path.len()].
                    return Result::Ok(unsafe { WStr::from_raw(buf.as_ptr(), path.len()) });
                }
                // For long paths and nt object paths, conver the prefix into an nt object, then resolve.
                // TODO: NT object paths technically mean they are already resolved. Will that break?
                if path[2] == b'?' as u16
                    && (path[1] == b'?' as u16 || path[1] == b'/' as u16 || path[1] == b'\\' as u16)
                {
                    path = &path[4..];
                }
            }
        }

        // With .add_nt_prefix = false, normalizeStringGenericTZ can still grow
        // the input by one u16 (it appends a trailing '\' after a bare UNC
        // volume name) plus the NUL terminator.
        if path.len() > buf.len().saturating_sub(if add_nt_prefix { NT_PREFIX_HEADROOM } else { 2 }) {
            return name_too_long;
        }
        let norm = bun_paths::normalize_string_generic_tz::<u16>(path, buf, add_nt_prefix, true);
        return Result::Ok(norm);
    }

    if strings::index_of_any_t::<T>(path_, &[b'\\', b'/', b'.']).is_none() {
        if path.len() >= buf.len() {
            return name_too_long;
        }

        // Skip the system call to get the final path name if it doesn't have any of the above characters.
        buf[0..path.len()].copy_from_slice(path);
        buf[path.len()] = 0;
        // SAFETY: NUL written at buf[path.len()].
        return Result::Ok(unsafe { WStr::from_raw(buf.as_ptr(), path.len()) });
    }

    let base_fd = if dir_fd == Fd::invalid() {
        posix::cwd_fd()
    } else {
        dir_fd.cast()
    };

    let base_path = match windows::get_final_path_name_by_handle(base_fd, w::GetFinalPathNameByHandleFormat::default(), buf) {
        Ok(p) => p,
        Err(_) => {
            return Result::Err(Error { errno: E::BADFD as _, syscall: Tag::open, ..Default::default() });
        }
    };

    if path.len() >= 2 && bun_paths::is_drive_letter_t::<u16>(path[0]) && path[1] == b':' as u16 {
        path = &path[2..];
    }

    let buf1 = bun_paths::w_path_buffer_pool().get();
    let joined_len = base_path.len() + 1 + path.len();
    if joined_len > buf1.len().saturating_sub(NT_PREFIX_HEADROOM) {
        return name_too_long;
    }
    buf1[0..base_path.len()].copy_from_slice(base_path);
    buf1[base_path.len()] = b'\\' as u16;
    buf1[base_path.len() + 1..joined_len].copy_from_slice(path);
    let norm = bun_paths::normalize_string_generic_tz::<u16>(&buf1[0..joined_len], buf, true, true);
    Result::Ok(norm)
}

#[cfg(windows)]
fn open_dir_at_windows_nt_path(
    dir_fd: Fd,
    path: &WStr,
    options: WindowsOpenDirOptions,
) -> Result<Fd> {
    let iterable = options.iterable;
    let no_follow = options.no_follow;
    let can_rename_or_delete = options.can_rename_or_delete;
    let read_only = options.read_only;

    let base_flags = w::STANDARD_RIGHTS_READ | w::FILE_READ_ATTRIBUTES | w::FILE_READ_EA
        | w::SYNCHRONIZE | w::FILE_TRAVERSE;
    let iterable_flag: u32 = if iterable { w::FILE_LIST_DIRECTORY } else { 0 };
    let rename_flag: u32 = if can_rename_or_delete { w::DELETE } else { 0 };
    let read_only_flag: u32 = if read_only { 0 } else { w::FILE_ADD_FILE | w::FILE_ADD_SUBDIRECTORY };
    let flags: u32 = iterable_flag | base_flags | rename_flag | read_only_flag;
    let open_reparse_point: w::DWORD = if no_follow { w::FILE_OPEN_REPARSE_POINT } else { 0x0 };

    // NtCreateFile seems to not function on device paths.
    // Since it is absolute, it can just use CreateFileW
    if strings::has_prefix_utf16(path.as_slice(), bun_str::w!("\\\\.\\")) {
        return open_windows_device_path(
            path,
            flags,
            if options.op != WindowsOpenDirOp::OnlyOpen { w::FILE_OPEN_IF } else { w::FILE_OPEN },
            w::FILE_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT | w::FILE_OPEN_FOR_BACKUP_INTENT | open_reparse_point,
        );
    }

    let path_len_bytes: u16 = (path.len() * 2) as u16;
    let mut nt_name = w::UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        Buffer: path.as_ptr() as *mut u16,
    };
    let mut attr = w::OBJECT_ATTRIBUTES {
        Length: mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: if bun_paths::is_absolute_windows_wtf16(path.as_slice()) {
            core::ptr::null_mut()
        } else if dir_fd == Fd::invalid() {
            posix::cwd_fd()
        } else {
            dir_fd.cast()
        },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        ObjectName: &mut nt_name,
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    let mut fd: w::HANDLE = w::INVALID_HANDLE_VALUE;
    // SAFETY: all-zero is a valid value for this repr(C) POD type.
    let mut io: w::IO_STATUS_BLOCK = unsafe { mem::zeroed() };

    // SAFETY: FFI call; arguments are valid for the duration of the call.
    let rc = unsafe {
        w::ntdll::NtCreateFile(
            &mut fd,
            flags,
            &mut attr,
            &mut io,
            core::ptr::null_mut(),
            0,
            FILE_SHARE,
            match options.op {
                WindowsOpenDirOp::OnlyOpen => w::FILE_OPEN,
                WindowsOpenDirOp::OnlyCreate => w::FILE_CREATE,
                WindowsOpenDirOp::OpenOrCreate => w::FILE_OPEN_IF,
            },
            w::FILE_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT | w::FILE_OPEN_FOR_BACKUP_INTENT | open_reparse_point,
            core::ptr::null_mut(),
            0,
        )
    };

    if cfg!(debug_assertions) {
        if rc == w::NTSTATUS::INVALID_PARAMETER {
            // Double check what flags you are passing to this
            //
            // - access_mask probably needs w.SYNCHRONIZE,
            // - options probably needs w.FILE_SYNCHRONOUS_IO_NONALERT
            // - disposition probably needs w.FILE_OPEN
            bun_core::Output::debug_warn!("NtCreateFile({}, {}) = {} (dir) = {}\nYou are calling this function with the wrong flags!!!", dir_fd, bun_core::fmt::utf16(path.as_slice()), <&str>::from(rc), fd as usize);
        } else if rc == w::NTSTATUS::OBJECT_PATH_SYNTAX_BAD || rc == w::NTSTATUS::OBJECT_NAME_INVALID {
            bun_core::Output::debug_warn!("NtCreateFile({}, {}) = {} (dir) = {}\nYou are calling this function without normalizing the path correctly!!!", dir_fd, bun_core::fmt::utf16(path.as_slice()), <&str>::from(rc), fd as usize);
        } else {
            // NtCreateFile may return NTSTATUS codes that are not named in Zig's
            // non-exhaustive NTSTATUS enum (e.g. STATUS_UNTRUSTED_MOUNT_POINT = 0xC00004BC
            // on newer Windows 11 builds). `@tagName` on an unnamed tag panics with
            // "invalid enum value", so use the default formatter which handles them.
            log!("NtCreateFile({}, {}) = {:?} (dir) = {}", dir_fd, bun_core::fmt::utf16(path.as_slice()), rc, fd as usize);
        }
    }

    match windows::Win32Error::from_nt_status(rc) {
        windows::Win32Error::SUCCESS => Result::Ok(Fd::from_native(fd)),
        code => {
            if let Some(sys_err) = code.to_system_errno() {
                return Result::Err(Error { errno: sys_err as _, syscall: Tag::open, ..Default::default() });
            }
            Result::Err(Error { errno: E::UNKNOWN as _, syscall: Tag::open, ..Default::default() })
        }
    }
}

#[cfg(windows)]
fn open_windows_device_path(
    path: &WStr,
    dw_desired_access: u32,
    dw_creation_disposition: u32,
    dw_flags_and_attributes: u32,
) -> Result<Fd> {
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    let rc = unsafe {
        kernel32::CreateFileW(
            path.as_ptr(),
            dw_desired_access,
            FILE_SHARE,
            core::ptr::null_mut(),
            dw_creation_disposition,
            dw_flags_and_attributes,
            core::ptr::null_mut(),
        )
    };
    if rc == w::INVALID_HANDLE_VALUE {
        return Result::Err(Error {
            errno: windows::Win32Error::get()
                .to_system_errno()
                .map(|e| e as _)
                .unwrap_or(E::UNKNOWN as _),
            syscall: Tag::open,
            ..Default::default()
        });
    }
    Result::Ok(Fd::from_native(rc))
}

#[cfg(windows)]
#[derive(Clone, Copy, Default)]
pub struct WindowsOpenDirOptions {
    pub iterable: bool,
    pub no_follow: bool,
    pub can_rename_or_delete: bool,
    pub op: WindowsOpenDirOp,
    pub read_only: bool,
}

#[cfg(windows)]
#[derive(Clone, Copy, Default, Eq, PartialEq)]
pub enum WindowsOpenDirOp {
    #[default]
    OnlyOpen,
    OnlyCreate,
    OpenOrCreate,
}

#[cfg(windows)]
fn open_dir_at_windows_t<T: WinPathChar>(
    dir_fd: Fd,
    path: &[T],
    options: WindowsOpenDirOptions,
) -> Result<Fd> {
    let wbuf = bun_paths::w_path_buffer_pool().get();

    let norm = match normalize_path_windows::<T>(dir_fd, path, &mut *wbuf, true) {
        Result::Err(err) => return Result::Err(err),
        Result::Ok(norm) => norm,
    };

    if T::IS_U8 {
        log!("openDirAtWindows({}) = {}", bstr::BStr::new(T::as_u8_slice(path)), bun_core::fmt::utf16(norm.as_slice()));
    } else {
        log!("openDirAtWindowsT({}) = {}", bun_core::fmt::utf16(T::as_u16_slice(path)), bun_core::fmt::utf16(norm.as_slice()));
    }
    open_dir_at_windows_nt_path(dir_fd, norm, options)
}

#[cfg(windows)]
pub fn open_dir_at_windows(dir_fd: Fd, path: &[u16], options: WindowsOpenDirOptions) -> Result<Fd> {
    open_dir_at_windows_t::<u16>(dir_fd, path, options)
}

#[cfg(windows)]
#[inline(never)]
pub fn open_dir_at_windows_a(dir_fd: Fd, path: &[u8], options: WindowsOpenDirOptions) -> Result<Fd> {
    open_dir_at_windows_t::<u8>(dir_fd, path, options)
}

#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct NtCreateFileOptions {
    pub access_mask: w::ULONG,
    pub disposition: w::ULONG,
    pub options: w::ULONG,
    pub attributes: w::ULONG,
    pub sharing_mode: w::ULONG,
}

#[cfg(windows)]
impl Default for NtCreateFileOptions {
    fn default() -> Self {
        Self {
            access_mask: 0,
            disposition: 0,
            options: 0,
            attributes: w::FILE_ATTRIBUTE_NORMAL,
            sharing_mode: FILE_SHARE,
        }
    }
}

/// For this function to open an absolute path, it must start with "\??\". Otherwise
/// you need a reference file descriptor the "invalid_fd" file descriptor is used
/// to signify that the current working directory should be used.
///
/// When using this function I highly recommend reading this first:
/// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
///
/// It is very very very easy to mess up flags here. Please review existing
/// examples to this call and the above function that maps unix flags to
/// the windows ones.
///
/// It is very easy to waste HOURS on the subtle semantics of this function.
///
/// In the zig standard library, messing up the input to their equivalent
/// will trigger `unreachable`. Here there will be a debug log with the path.
#[cfg(windows)]
pub fn open_file_at_windows_nt_path(
    dir: Fd,
    path: &[u16],
    options: NtCreateFileOptions,
) -> Result<Fd> {
    // Another problem re: normalization is that you can use relative paths, but no leading '.\' or './''
    // this path is probably already backslash normalized so we're only going to check for '.\'

    let mut result: windows::HANDLE = core::ptr::null_mut();

    let path_len_bytes = match u16::try_from(path.len() * 2) {
        Ok(v) => v,
        Err(_) => return Result::Err(Error { errno: E::NOMEM as _, syscall: Tag::open, ..Default::default() }),
    };
    let mut nt_name = windows::UNICODE_STRING {
        Length: path_len_bytes,
        MaximumLength: path_len_bytes,
        Buffer: path.as_ptr() as *mut u16,
    };
    let mut attr = windows::OBJECT_ATTRIBUTES {
        Length: mem::size_of::<windows::OBJECT_ATTRIBUTES>() as u32,
        // From the Windows Documentation:
        //
        // [ObjectName] must be a fully qualified file specification or the name of a device object,
        // unless it is the name of a file relative to the directory specified by RootDirectory.
        // For example, \Device\Floppy1\myfile.dat or \??\B:\myfile.dat could be the fully qualified
        // file specification, provided that the floppy driver and overlying file system are already
        // loaded. For more information, see File Names, Paths, and Namespaces.
        ObjectName: &mut nt_name,
        RootDirectory: if strings::has_prefix_type::<u16>(path, &windows::NT_OBJECT_PREFIX) {
            core::ptr::null_mut()
        } else if dir == Fd::invalid() {
            posix::cwd_fd()
        } else {
            dir.cast()
        },
        Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        SecurityDescriptor: core::ptr::null_mut(),
        SecurityQualityOfService: core::ptr::null_mut(),
    };
    // SAFETY: all-zero is a valid value for this repr(C) POD type.
    let mut io: windows::IO_STATUS_BLOCK = unsafe { mem::zeroed() };

    let mut attributes = options.attributes;
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            windows::ntdll::NtCreateFile(
                &mut result,
                options.access_mask,
                &mut attr,
                &mut io,
                core::ptr::null_mut(),
                attributes,
                options.sharing_mode,
                options.disposition,
                options.options,
                core::ptr::null_mut(),
                0,
            )
        };

        if cfg!(debug_assertions) {
            if rc == w::NTSTATUS::INVALID_PARAMETER {
                bun_core::Output::debug_warn!("NtCreateFile({}, {}) = {} (file) = {}\nYou are calling this function with the wrong flags!!!", dir, bun_core::fmt::utf16(path), <&str>::from(rc), result as usize);
            } else if rc == w::NTSTATUS::OBJECT_PATH_SYNTAX_BAD || rc == w::NTSTATUS::OBJECT_NAME_INVALID {
                bun_core::Output::debug_warn!("NtCreateFile({}, {}) = {} (file) = {}\nYou are calling this function without normalizing the path correctly!!!", dir, bun_core::fmt::utf16(path), <&str>::from(rc), result as usize);
            } else if rc == w::NTSTATUS::SUCCESS {
                log!("NtCreateFile({}, {}) = {} (file) = {}", dir, bun_core::fmt::utf16(path), <&str>::from(rc), Fd::from_native(result));
            } else {
                // Use the default formatter instead of `@tagName` here: `rc` may
                // be an NTSTATUS not named in Zig's non-exhaustive enum, and
                // `@tagName` on an unnamed tag panics with "invalid enum value".
                log!("NtCreateFile({}, {}) = {:?} (file)", dir, bun_core::fmt::utf16(path), rc);
            }
        }

        if rc == w::NTSTATUS::ACCESS_DENIED
            && attributes == w::FILE_ATTRIBUTE_NORMAL
            && (options.access_mask & (w::GENERIC_READ | w::GENERIC_WRITE)) == w::GENERIC_WRITE
        {
            // > If CREATE_ALWAYS and FILE_ATTRIBUTE_NORMAL are specified,
            // > CreateFile fails and sets the last error to ERROR_ACCESS_DENIED
            // > if the file exists and has the FILE_ATTRIBUTE_HIDDEN or
            // > FILE_ATTRIBUTE_SYSTEM attribute. To avoid the error, specify the
            // > same attributes as the existing file.
            //
            // The above also applies to NtCreateFile. In order for this to work,
            // we retry but only in the case that the file was opened for writing.
            //
            // See https://github.com/oven-sh/bun/issues/6820
            //     https://github.com/libuv/libuv/pull/3380
            attributes = w::FILE_ATTRIBUTE_HIDDEN;
            continue;
        }

        match windows::Win32Error::from_nt_status(rc) {
            windows::Win32Error::SUCCESS => {
                if options.access_mask & w::FILE_APPEND_DATA != 0 {
                    // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilepointerex
                    const FILE_END: u32 = 2;
                    // SAFETY: FFI call; arguments are valid for the duration of the call.
                    if unsafe { kernel32::SetFilePointerEx(result, 0, core::ptr::null_mut(), FILE_END) } == 0 {
                        return Result::Err(Error { errno: E::UNKNOWN as _, syscall: Tag::SetFilePointerEx, ..Default::default() });
                    }
                }
                return Result::Ok(Fd::from_native(result));
            }
            code => {
                if let Some(sys_err) = code.to_system_errno() {
                    return Result::Err(Error { errno: sys_err as _, syscall: Tag::open, ..Default::default() });
                }
                return Result::Err(Error { errno: E::UNKNOWN as _, syscall: Tag::open, ..Default::default() });
            }
        }
    }
}

// Delete: this doesnt apply to NtCreateFile :(
// (Zig had a large commented-out `WindowsOpenFlags` block here — omitted in port.)

#[cfg(windows)]
pub fn open_file_at_windows_t<T: WinPathChar>(
    dir_fd: Fd,
    path: &[T],
    options: NtCreateFileOptions,
) -> Result<Fd> {
    let wbuf = bun_paths::w_path_buffer_pool().get();

    let norm = match normalize_path_windows::<T>(dir_fd, path, &mut *wbuf, true) {
        Result::Err(err) => return Result::Err(err),
        Result::Ok(norm) => norm,
    };

    open_file_at_windows_nt_path(dir_fd, norm.as_slice(), options)
}

#[cfg(windows)]
pub fn open_file_at_windows(dir_fd: Fd, path: &[u16], opts: NtCreateFileOptions) -> Result<Fd> {
    open_file_at_windows_t::<u16>(dir_fd, path, opts)
}

#[cfg(windows)]
#[inline(never)]
pub fn open_file_at_windows_a(dir_fd: Fd, path: &[u8], opts: NtCreateFileOptions) -> Result<Fd> {
    open_file_at_windows_t::<u8>(dir_fd, path, opts)
}

#[cfg(windows)]
pub fn openat_windows_t<T: WinPathChar>(dir: Fd, path: &[T], flags: i32, perm: Mode) -> Result<Fd> {
    openat_windows_t_maybe_normalize::<T, true>(dir, path, flags, perm)
}

#[cfg(windows)]
pub fn openat_windows_t_maybe_normalize<T: WinPathChar, const NORMALIZE: bool>(
    dir: Fd,
    path: &[T],
    flags: i32,
    perm: Mode,
) -> Result<Fd> {
    if flags & O::DIRECTORY != 0 {
        let windows_options = WindowsOpenDirOptions {
            iterable: flags & O::PATH == 0,
            no_follow: flags & O::NOFOLLOW != 0,
            can_rename_or_delete: false,
            ..Default::default()
        };
        if !NORMALIZE && T::IS_U16 {
            // SAFETY: when T == u16 and !NORMALIZE, path is already an NT path WStr.
            return open_dir_at_windows_nt_path(dir, unsafe { WStr::from_slice_unchecked(T::as_u16_slice(path)) }, windows_options);
        }

        // we interpret O_PATH as meaning that we don't want iteration
        return open_dir_at_windows_t::<T>(dir, path, windows_options);
    }

    let nonblock = flags & O::NONBLOCK != 0;
    let overwrite = flags & O::WRONLY != 0 && flags & O::APPEND == 0;

    let mut access_mask: w::ULONG = w::READ_CONTROL | w::FILE_WRITE_ATTRIBUTES | w::SYNCHRONIZE;
    if flags & O::RDWR != 0 {
        access_mask |= w::GENERIC_READ | w::GENERIC_WRITE;
    } else if flags & O::APPEND != 0 {
        access_mask |= w::GENERIC_WRITE | w::FILE_APPEND_DATA;
    } else if flags & O::WRONLY != 0 {
        access_mask |= w::GENERIC_WRITE;
    } else {
        access_mask |= w::GENERIC_READ;
    }

    let disposition: w::ULONG = 'blk: {
        if flags & O::CREAT != 0 {
            if flags & O::EXCL != 0 {
                break 'blk w::FILE_CREATE;
            }
            break 'blk if overwrite { w::FILE_OVERWRITE_IF } else { w::FILE_OPEN_IF };
        }
        if overwrite { w::FILE_OVERWRITE } else { w::FILE_OPEN }
    };

    let blocking_flag: windows::ULONG = if !nonblock { windows::FILE_SYNCHRONOUS_IO_NONALERT } else { 0 };
    let file_or_dir_flag: windows::ULONG = if flags & O::DIRECTORY != 0 {
        windows::FILE_DIRECTORY_FILE
    } else {
        0
    };
    let follow_symlinks = flags & O::NOFOLLOW == 0;

    let options: windows::ULONG = if follow_symlinks {
        file_or_dir_flag | blocking_flag
    } else {
        file_or_dir_flag | windows::FILE_OPEN_REPARSE_POINT
    };

    let mut attributes: w::DWORD = windows::FILE_ATTRIBUTE_NORMAL;
    if flags & O::CREAT != 0 && perm & 0x80 == 0 && perm != 0 {
        attributes |= windows::FILE_ATTRIBUTE_READONLY;
    }

    let open_options = NtCreateFileOptions {
        access_mask,
        disposition,
        options,
        attributes,
        ..Default::default()
    };

    if !NORMALIZE && T::IS_U16 {
        return open_file_at_windows_nt_path(dir, T::as_u16_slice(path), open_options);
    }

    open_file_at_windows_t::<T>(dir, path, open_options)
}

#[cfg(windows)]
pub fn openat_windows(dir: Fd, path: &[u16], flags: i32, perm: Mode) -> Result<Fd> {
    openat_windows_t::<u16>(dir, path, flags, perm)
}

#[cfg(windows)]
pub fn openat_windows_a(dir: Fd, path: &[u8], flags: i32, perm: Mode) -> Result<Fd> {
    openat_windows_t::<u8>(dir, path, flags, perm)
}

pub fn openat_os_path(dirfd: Fd, file_path: bun_paths::OSPathSliceZ<'_>, flags: i32, perm: Mode) -> Result<Fd> {
    #[cfg(target_os = "macos")]
    {
        // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
        // SAFETY: FFI call with valid dirfd and NUL-terminated path.
        let rc = unsafe { darwin_nocancel::openat_nocancel(dirfd.cast(), file_path.as_ptr(), O::to_packed(flags as u32), perm) };
        if cfg!(debug_assertions) {
            log!("openat({}, {}, {}) = {}", dirfd, bstr::BStr::new(file_path.as_bytes()), flags, rc);
        }
        return Result::<Fd>::errno_sys_fp(rc, Tag::open, dirfd, file_path).unwrap_or(Result::Ok(Fd::from_native(rc)));
    }
    #[cfg(windows)]
    {
        return openat_windows_t::<bun_paths::OSPathChar>(dirfd, file_path.as_slice(), flags, perm);
    }
    #[cfg(target_os = "freebsd")]
    {
        loop {
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let rc = unsafe { libc::openat(dirfd.cast(), file_path.as_ptr(), O::to_packed(flags as u32), perm) };
            if cfg!(debug_assertions) {
                log!("openat({}, {}, {}) = {}", dirfd, bstr::BStr::new(file_path.as_bytes()), flags, rc);
            }
            return match get_errno(rc) {
                E::SUCCESS => Result::Ok(Fd::from_native(rc.try_into().unwrap())),
                E::INTR => continue,
                err => Result::Err(Error { errno: err as _, syscall: Tag::open, ..Default::default() }),
            };
        }
    }

    #[cfg(target_os = "linux")]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::openat(dirfd.cast(), file_path.as_ptr(), O::to_packed(flags as u32), perm) };
        if cfg!(debug_assertions) {
            log!("openat({}, {}, {}) = {}", dirfd, bstr::BStr::new(file_path.as_bytes()), flags, rc);
        }

        return match get_errno(rc) {
            E::SUCCESS => Result::Ok(Fd::from_native(rc.try_into().unwrap())),
            E::INTR => continue,
            err => Result::Err(Error { errno: err as _, syscall: Tag::open, ..Default::default() }),
        };
    }
}

pub fn access(path: bun_paths::OSPathSliceZ<'_>, mode: i32) -> Result<()> {
    #[cfg(windows)]
    {
        let attrs = match get_file_attributes(path) {
            Some(a) => a,
            None => {
                return Result::Err(Error {
                    errno: windows::get_last_errno() as _,
                    syscall: Tag::access,
                    ..Default::default()
                });
            }
        };

        if !((mode & W_OK) > 0) || !attrs.is_readonly() || attrs.is_directory() {
            return Result::Ok(());
        } else {
            return Result::Err(Error { errno: E::PERM as _, syscall: Tag::access, ..Default::default() });
        }
    }
    #[cfg(not(windows))]
    // TODO: fix that bun's std library fork has a different parameter type.
    Result::<()>::errno_sys_p(
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        unsafe { syscall::access(path.as_ptr(), mode as _) },
        Tag::access,
        path,
    )
    .unwrap_or(Result::Ok(()))
}

pub fn openat(dirfd: Fd, file_path: &ZStr, flags: i32, perm: Mode) -> Result<Fd> {
    #[cfg(windows)]
    {
        openat_windows_t::<u8>(dirfd, file_path.as_bytes(), flags, perm)
    }
    #[cfg(not(windows))]
    {
        openat_os_path(dirfd, file_path, flags, perm)
    }
}

pub fn openat_file_with_libuv_flags(dirfd: Fd, file_path: &ZStr, flags: node::FileSystemFlags, perm: Mode) -> Result<Fd> {
    #[cfg(windows)]
    {
        let f = match flags.to_windows() {
            Ok(f) => f,
            Err(_) => {
                return Result::Err(Error {
                    errno: E::INVAL as _,
                    syscall: Tag::open,
                    path: Some(file_path.as_bytes().into()),
                    ..Default::default()
                });
            }
        };
        // TODO: pass f.share
        // TODO(port): Zig calls openFileAtWindowsT with (access, disposition, attributes) — signature mismatch in source; Phase B.
        return open_file_at_windows_t::<u8>(dirfd, file_path.as_bytes(), NtCreateFileOptions {
            access_mask: f.access,
            disposition: f.disposition,
            attributes: f.attributes,
            options: 0,
            ..Default::default()
        });
    }
    #[cfg(not(windows))]
    {
        openat_os_path(dirfd, file_path, flags.as_posix(), perm)
    }
}

pub fn openat_a(dirfd: Fd, file_path: &[u8], flags: i32, perm: Mode) -> Result<Fd> {
    #[cfg(windows)]
    {
        return openat_windows_t::<u8>(dirfd, file_path, flags, perm);
    }

    #[cfg(not(windows))]
    {
        let path_z = match posix::to_posix_path(file_path) {
            Ok(p) => p,
            Err(_) => return Result::Err(Error { errno: E::NAMETOOLONG as _, syscall: Tag::open, ..Default::default() }),
        };
        openat_os_path(dirfd, &path_z, flags, perm)
    }
}

pub fn open_a(file_path: &[u8], flags: i32, perm: Mode) -> Result<Fd> {
    // this is what open() does anyway.
    openat_a(Fd::cwd(), file_path, flags, perm)
}

pub fn open(file_path: &ZStr, flags: i32, perm: Mode) -> Result<Fd> {
    // TODO(@paperclover): this should not use libuv; when the libuv path is
    // removed here, the call sites in node_fs.zig should make sure they parse
    // the libuv specific file flags using the WindowsOpenFlags structure.
    #[cfg(windows)]
    {
        return sys_uv::open(file_path, flags, perm);
    }

    #[cfg(not(windows))]
    // this is what open() does anyway.
    openat(Fd::cwd(), file_path, flags, perm)
}

#[cfg(target_os = "linux")]
pub const MAX_COUNT: usize = 0x7ffff000;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "watchos", target_os = "tvos"))]
pub const MAX_COUNT: usize = i32::MAX as usize;
#[cfg(windows)]
pub const MAX_COUNT: usize = u32::MAX as usize;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "ios", target_os = "watchos", target_os = "tvos", windows)))]
pub const MAX_COUNT: usize = isize::MAX as usize;

pub fn write(fd: Fd, bytes: &[u8]) -> Result<usize> {
    let adjusted_len = MAX_COUNT.min(bytes.len());
    let debug_timer = bun_core::Output::DebugTimer::start();

    // TODO(port): defer block checking debug_timer > 1ms — moved to scopeguard.
    let _guard = scopeguard::guard((), |_| {
        if cfg!(debug_assertions) {
            if debug_timer.read_ns() > 1_000_000 {
                log!("write({}, {}) blocked for {}", fd, bytes.len(), debug_timer);
            }
        }
    });

    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { darwin_nocancel::write_nocancel(fd.cast(), bytes.as_ptr(), adjusted_len) };
        log!("write({}, {}) = {} ({})", fd, adjusted_len, rc, debug_timer);

        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::write, fd) {
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        loop {
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let rc = unsafe { syscall::write(fd.cast(), bytes.as_ptr(), adjusted_len) };
            log!("write({}, {}) = {} {}", fd, adjusted_len, rc, debug_timer);

            if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::write, fd) {
                if err.get_errno() == E::INTR { continue; }
                return err;
            }
            return Result::Ok(usize::try_from(rc).unwrap());
        }
    }
    #[cfg(windows)]
    {
        // "WriteFile sets this value to zero before doing any work or error checking."
        let mut bytes_written: u32 = 0;
        debug_assert!(bytes.len() > 0);
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            kernel32::WriteFile(
                fd.cast(),
                bytes.as_ptr(),
                adjusted_len as u32,
                &mut bytes_written,
                core::ptr::null_mut(),
            )
        };
        if rc == 0 {
            log!("WriteFile({}, {}) = {}", fd, adjusted_len, <&str>::from(windows::get_last_errno()));
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let er = unsafe { kernel32::GetLastError() };
            if er == windows::Win32Error::ACCESS_DENIED {
                // file is not writable
                return Result::Err(Error {
                    errno: SystemErrno::EBADF as _,
                    syscall: Tag::write,
                    fd: Some(fd),
                    ..Default::default()
                });
            }
            let errno = SystemErrno::init(unsafe { kernel32::GetLastError() })
                .unwrap_or(SystemErrno::EUNKNOWN)
                .to_e();
            return Result::Err(Error {
                errno: errno as _,
                syscall: Tag::write,
                fd: Some(fd),
                ..Default::default()
            });
        }

        log!("WriteFile({}, {}) = {}", fd, adjusted_len, bytes_written);
        return Result::Ok(bytes_written as usize);
    }
}

fn veclen<T: IoVecLike>(buffers: &[T]) -> usize {
    let mut len: usize = 0;
    for buffer in buffers {
        len += buffer.len();
    }
    len
}
// TODO(port): IoVecLike trait wraps iovec/iovec_const/.len — Phase B.

pub fn writev(fd: Fd, buffers: &mut [posix::iovec]) -> Result<usize> {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call with valid fd and iovec array of `buffers.len()` entries.
        let rc = unsafe { writev_sym(fd.cast(), buffers.as_ptr() as *const posix::iovec_const, i32::try_from(buffers.len()).unwrap()) };
        if cfg!(debug_assertions) {
            log!("writev({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::writev, fd) {
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(not(target_os = "macos"))]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { writev_sym(fd.cast(), buffers.as_ptr() as *const posix::iovec_const, buffers.len() as _) };
        if cfg!(debug_assertions) {
            log!("writev({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::writev, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn pwritev(fd: Fd, buffers: &[bun_core::PlatformIOVecConst], position: isize) -> Result<usize> {
    #[cfg(windows)]
    {
        return sys_uv::pwritev(fd, buffers, position);
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call with valid fd and iovec array of `buffers.len()` entries.
        let rc = unsafe { pwritev_sym(fd.cast(), buffers.as_ptr(), i32::try_from(buffers.len()).unwrap(), position) };
        if cfg!(debug_assertions) {
            log!("pwritev({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::pwritev, fd) {
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { pwritev_sym(fd.cast(), buffers.as_ptr(), buffers.len() as _, position) };
        if cfg!(debug_assertions) {
            log!("pwritev({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::pwritev, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn readv(fd: Fd, buffers: &mut [posix::iovec]) -> Result<usize> {
    if cfg!(debug_assertions) && buffers.is_empty() {
        bun_core::Output::debug_warn!("readv() called with 0 length buffer");
    }

    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call with valid fd and iovec array of `buffers.len()` entries.
        let rc = unsafe { readv_sym(fd.cast(), buffers.as_ptr(), i32::try_from(buffers.len()).unwrap()) };
        if cfg!(debug_assertions) {
            log!("readv({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::readv, fd) {
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(not(target_os = "macos"))]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { readv_sym(fd.cast(), buffers.as_ptr(), buffers.len() as _) };
        if cfg!(debug_assertions) {
            log!("readv({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::readv, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn preadv(fd: Fd, buffers: &mut [posix::iovec], position: isize) -> Result<usize> {
    if cfg!(debug_assertions) && buffers.is_empty() {
        bun_core::Output::debug_warn!("preadv() called with 0 length buffer");
    }

    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call with valid fd and iovec array of `buffers.len()` entries.
        let rc = unsafe { preadv_sym(fd.cast(), buffers.as_ptr(), i32::try_from(buffers.len()).unwrap(), position) };
        if cfg!(debug_assertions) {
            log!("preadv({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::preadv, fd) {
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(not(target_os = "macos"))]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { preadv_sym(fd.cast(), buffers.as_ptr(), buffers.len() as _, position) };
        if cfg!(debug_assertions) {
            log!("preadv({}, {}) = {}", fd, veclen(buffers), rc);
        }
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::preadv, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

// TODO(port): preadv_sym/readv_sym/pwritev_sym/writev_sym/pread_sym/fcntl_symbol —
// these are platform-selected fn pointers in Zig. In Rust, route through
// `crate::raw::{preadv, readv, pwritev, writev, pread}` which already cfg-select
// the correct symbol (linux direct syscall vs darwin $NOCANCEL vs libc).
use crate::raw::{preadv as preadv_sym, readv as readv_sym, pwritev as pwritev_sym, writev as writev_sym, pread as pread_sym};

pub fn pread(fd: Fd, buf: &mut [u8], offset: i64) -> Result<usize> {
    let adjusted_len = buf.len().min(MAX_COUNT);

    if cfg!(debug_assertions) && adjusted_len == 0 {
        bun_core::Output::debug_warn!("pread() called with 0 length buffer");
    }

    let ioffset = offset; // the OS treats this as unsigned
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { pread_sym(fd.cast(), buf.as_mut_ptr(), adjusted_len, ioffset) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::pread, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

// TODO(port): pwrite_sym selects libc.pwrite64 on glibc Linux. Route via crate::raw::pwrite.
use crate::raw::pwrite as pwrite_sym;

pub fn pwrite(fd: Fd, bytes: &[u8], offset: i64) -> Result<usize> {
    if cfg!(debug_assertions) && bytes.is_empty() {
        bun_core::Output::debug_warn!("pwrite() called with 0 length buffer");
    }

    let adjusted_len = bytes.len().min(MAX_COUNT);
    let ioffset = offset; // the OS treats this as unsigned
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { pwrite_sym(fd.cast(), bytes.as_ptr(), adjusted_len, ioffset) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::pwrite, fd) {
            match err.get_errno() {
                E::INTR => continue,
                _ => return err,
            }
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn read(fd: Fd, buf: &mut [u8]) -> Result<usize> {
    if cfg!(debug_assertions) && buf.is_empty() {
        bun_core::Output::debug_warn!("read() called with 0 length buffer");
    }
    let debug_timer = bun_core::Output::DebugTimer::start();
    let adjusted_len = buf.len().min(MAX_COUNT);

    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { darwin_nocancel::read_nocancel(fd.cast(), buf.as_mut_ptr(), adjusted_len) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::read, fd) {
            log!("read({}, {}) = {} ({})", fd, adjusted_len, err.err().name(), debug_timer);
            return err;
        }
        log!("read({}, {}) = {} ({})", fd, adjusted_len, rc, debug_timer);
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        loop {
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let rc = unsafe { syscall::read(fd.cast(), buf.as_mut_ptr(), adjusted_len) };
            log!("read({}, {}) = {} ({})", fd, adjusted_len, rc, debug_timer);

            if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::read, fd) {
                if err.get_errno() == E::INTR { continue; }
                return err;
            }
            return Result::Ok(usize::try_from(rc).unwrap());
        }
    }
    #[cfg(windows)]
    {
        if fd.kind() == FdKind::Uv {
            return sys_uv::read(fd, buf);
        }
        let mut amount_read: u32 = 0;
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { kernel32::ReadFile(fd.native(), buf.as_mut_ptr(), adjusted_len as u32, &mut amount_read, core::ptr::null_mut()) };
        if rc == windows::FALSE {
            let ret = Result::<usize>::Err(Error {
                errno: windows::get_last_errno() as _,
                syscall: Tag::read,
                fd: Some(fd),
                ..Default::default()
            });
            if cfg!(debug_assertions) {
                log!("ReadFile({}, {}) = {} ({})", fd, adjusted_len, ret.err().name(), debug_timer);
            }
            return ret;
        }
        log!("ReadFile({}, {}) = {} ({})", fd, adjusted_len, amount_read, debug_timer);
        return Result::Ok(amount_read as usize);
    }
}

pub fn read_all(fd: Fd, buf: &mut [u8]) -> Result<usize> {
    let mut rest = buf;
    let mut total_read: usize = 0;
    while !rest.is_empty() {
        match read(fd, rest) {
            Result::Ok(len) => {
                if len == 0 { break; }
                rest = &mut rest[len..];
                total_read += len;
            }
            Result::Err(err) => return Result::Err(err),
        }
    }
    Result::Ok(total_read)
}

#[cfg(unix)]
const SEND_FLAGS_NONBLOCK: u32 = c::MSG_DONTWAIT | c::MSG_NOSIGNAL;
#[cfg(unix)]
const RECV_FLAGS_NONBLOCK: u32 = c::MSG_DONTWAIT;

pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Result<usize> {
    recv(fd, buf, RECV_FLAGS_NONBLOCK)
}

#[cfg(unix)]
pub fn poll(fds: &mut [posix::pollfd], timeout: i32) -> Result<usize> {
    loop {
        let rc = {
            #[cfg(target_os = "macos")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { darwin_nocancel::poll_nocancel(fds.as_mut_ptr(), fds.len(), timeout) } }
            #[cfg(target_os = "linux")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { syscall::poll(fds.as_mut_ptr(), fds.len(), timeout) } }
            #[cfg(target_os = "freebsd")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, timeout) } }
        };
        if let Some(err) = Result::<usize>::errno_sys(rc, Tag::poll) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

#[cfg(unix)]
pub fn ppoll(fds: &mut [posix::pollfd], timeout: Option<&mut posix::timespec>, sigmask: Option<&posix::sigset_t>) -> Result<usize> {
    loop {
        let rc = {
            #[cfg(target_os = "macos")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { darwin_nocancel::ppoll_nocancel(fds.as_mut_ptr(), fds.len(), timeout.as_deref_mut().map_or(core::ptr::null_mut(), |t| t as *mut _), sigmask.map_or(core::ptr::null(), |s| s as *const _)) } }
            #[cfg(target_os = "linux")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { syscall::ppoll(fds.as_mut_ptr(), fds.len(), timeout.as_deref_mut().map_or(core::ptr::null_mut(), |t| t as *mut _), sigmask.map_or(core::ptr::null(), |s| s as *const _)) } }
            #[cfg(target_os = "freebsd")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { libc::ppoll(fds.as_mut_ptr(), fds.len() as _, timeout.as_deref_mut().map_or(core::ptr::null_mut(), |t| t as *mut _), sigmask.map_or(core::ptr::null(), |s| s as *const _)) } }
        };
        if let Some(err) = Result::<usize>::errno_sys(rc, Tag::ppoll) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn recv(fd: Fd, buf: &mut [u8], flag: u32) -> Result<usize> {
    let adjusted_len = buf.len().min(MAX_COUNT);
    let debug_timer = bun_core::Output::DebugTimer::start();
    if cfg!(debug_assertions) && adjusted_len == 0 {
        bun_core::Output::debug_warn!("recv() called with 0 length buffer");
    }

    #[cfg(target_os = "macos")]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { darwin_nocancel::recvfrom_nocancel(fd.cast(), buf.as_mut_ptr(), adjusted_len, flag, core::ptr::null_mut(), core::ptr::null_mut()) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::recv, fd) {
            log!("recv({}, {}) = {} {}", fd, adjusted_len, err.err().name(), debug_timer);
            return err;
        }
        log!("recv({}, {}) = {} {}", fd, adjusted_len, rc, debug_timer);
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(not(target_os = "macos"))]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::recvfrom(fd.cast(), buf.as_mut_ptr(), adjusted_len, flag, core::ptr::null_mut(), core::ptr::null_mut()) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::recv, fd) {
            if err.get_errno() == E::INTR { continue; }
            log!("recv({}, {}) = {} {}", fd, adjusted_len, err.err().name(), debug_timer);
            return err;
        }
        log!("recv({}, {}) = {} {}", fd, adjusted_len, rc, debug_timer);
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn kevent(fd: Fd, changelist: &[libc::kevent], eventlist: &mut [libc::kevent], timeout: Option<&mut posix::timespec>) -> Result<usize> {
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            libc::kevent(
                fd.cast(),
                changelist.as_ptr(),
                changelist.len() as _,
                eventlist.as_mut_ptr(),
                eventlist.len() as _,
                timeout.as_deref().map_or(core::ptr::null(), |t| t as *const _),
            )
        };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::kevent, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn send_non_block(fd: Fd, buf: &[u8]) -> Result<usize> {
    send(fd, buf, SEND_FLAGS_NONBLOCK)
}

pub fn send(fd: Fd, buf: &[u8], flag: u32) -> Result<usize> {
    #[cfg(target_os = "macos")]
    {
        let debug_timer = bun_core::Output::DebugTimer::start();
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { darwin_nocancel::sendto_nocancel(fd.cast(), buf.as_ptr(), buf.len(), flag, core::ptr::null(), 0) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::send, fd) {
            log!("send({}, {}) = {} ({})", fd, buf.len(), err.err().name(), debug_timer);
            return err;
        }
        log!("send({}, {}) = {} ({})", fd, buf.len(), rc, debug_timer);
        return Result::Ok(usize::try_from(rc).unwrap());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let debug_timer = bun_core::Output::DebugTimer::start();
        loop {
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let rc = unsafe { syscall::sendto(fd.cast(), buf.as_ptr(), buf.len(), flag, core::ptr::null(), 0) };
            if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::send, fd) {
                if err.get_errno() == E::INTR { continue; }
                log!("send({}, {}) = {} ({})", fd, buf.len(), err.err().name(), debug_timer);
                return err;
            }
            log!("send({}, {}) = {} ({})", fd, buf.len(), rc, debug_timer);
            return Result::Ok(usize::try_from(rc).unwrap());
        }
    }
}

#[cfg(target_os = "linux")]
pub fn pidfd_open(pid: libc::pid_t, flags: u32) -> Result<i32> {
    loop {
        // SAFETY: direct Linux syscall; pid and flags are plain integers.
        let rc = unsafe { syscall::pidfd_open(pid, flags) };
        if let Some(err) = Result::<i32>::errno_sys(rc, Tag::pidfd_open) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(i32::try_from(rc).unwrap());
    }
}

#[cfg(unix)]
pub fn lseek(fd: Fd, offset: i64, whence: usize) -> Result<usize> {
    loop {
        // SAFETY: FFI call with valid fd; offset/whence are plain integers.
        let rc = unsafe { syscall::lseek(fd.cast(), offset, whence.try_into().unwrap()) };
        if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::lseek, fd) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(usize::try_from(rc).unwrap());
    }
}

pub fn readlink<'a>(in_: &ZStr, buf: &'a mut [u8]) -> Result<&'a mut ZStr> {
    #[cfg(windows)]
    {
        return sys_uv::readlink(in_, buf);
    }

    #[cfg(not(windows))]
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::readlink(in_.as_ptr(), buf.as_mut_ptr(), buf.len()) };
        if let Some(err) = Result::<&mut ZStr>::errno_sys_p(rc, Tag::readlink, in_) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        let len = usize::try_from(rc).unwrap();
        // POSIX readlink does not NUL-terminate and may truncate to buf.len.
        // If the result filled the buffer, there is no room for the sentinel
        // and the target may have been truncated. Treat this as ENAMETOOLONG
        // instead of writing past the end of buf.
        if len >= buf.len() {
            return Result::Err(Error {
                errno: E::NAMETOOLONG as _,
                syscall: Tag::readlink,
                path: Some(in_.as_bytes().into()),
                ..Default::default()
            });
        }
        buf[len] = 0;
        // SAFETY: we just wrote NUL at buf[len].
        return Result::Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) });
    }
}

#[cfg(unix)]
pub fn readlinkat<'a>(fd: Fd, in_: &ZStr, buf: &'a mut [u8]) -> Result<&'a mut ZStr> {
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::readlinkat(fd.cast(), in_.as_ptr(), buf.as_mut_ptr(), buf.len()) };
        if let Some(err) = Result::<&mut ZStr>::errno_sys_fp(rc, Tag::readlink, fd, in_) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        let len = usize::try_from(rc).unwrap();
        // See comment in readlink() above.
        if len >= buf.len() {
            return Result::Err(Error {
                errno: E::NAMETOOLONG as _,
                syscall: Tag::readlink,
                fd: Some(fd),
                path: Some(in_.as_bytes().into()),
                ..Default::default()
            });
        }
        buf[len] = 0;
        // SAFETY: NUL written at buf[len].
        return Result::Ok(unsafe { ZStr::from_raw_mut(buf.as_mut_ptr(), len) });
    }
}

pub fn ftruncate(fd: Fd, size: isize) -> Result<()> {
    #[cfg(windows)]
    {
        // SAFETY: all-zero is a valid value for this repr(C) POD type.
        let mut io_status_block: w::IO_STATUS_BLOCK = unsafe { mem::zeroed() };
        let mut eof_info = w::FILE_END_OF_FILE_INFORMATION { EndOfFile: size as i64 };

        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            windows::ntdll::NtSetInformationFile(
                fd.cast(),
                &mut io_status_block,
                (&mut eof_info) as *mut _ as *mut c_void,
                mem::size_of::<w::FILE_END_OF_FILE_INFORMATION>() as u32,
                w::FILE_INFORMATION_CLASS::FileEndOfFileInformation,
            )
        };
        return Result::<()>::errno_sys_fd(rc, Tag::ftruncate, fd).unwrap_or(Result::Ok(()));
    }

    #[cfg(not(windows))]
    loop {
        if let Some(err) = Result::<()>::errno_sys_fd(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::ftruncate(fd.cast(), size) },
            Tag::ftruncate,
            fd,
        ) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

#[cfg(unix)]
pub fn rename(from: &ZStr, to: &ZStr) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::rename(from.as_ptr(), to.as_ptr()) },
            Tag::rename,
        ) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

#[derive(Clone, Copy, Default)]
pub struct RenameAt2Flags {
    pub exchange: bool,
    pub exclude: bool,
    pub nofollow: bool,
}

impl RenameAt2Flags {
    pub fn int(self) -> u32 {
        let mut flags: u32 = 0;
        #[cfg(target_os = "macos")]
        {
            if self.exchange { flags |= c::RENAME_SWAP; }
            if self.exclude { flags |= c::RENAME_EXCL; }
            if self.nofollow { flags |= c::RENAME_NOFOLLOW_ANY; }
        }
        #[cfg(target_os = "linux")]
        {
            if self.exchange { flags |= c::RENAME_EXCHANGE; }
            if self.exclude { flags |= c::RENAME_NOREPLACE; }
        }
        flags
    }
}

pub fn renameat_concurrently<const MOVE_FALLBACK: bool>(
    from_dir_fd: Fd,
    from: &ZStr,
    to_dir_fd: Fd,
    to: &ZStr,
) -> Result<()> {
    match renameat_concurrently_without_fallback(from_dir_fd, from, to_dir_fd, to) {
        Result::Ok(()) => Result::Ok(()),
        Result::Err(e) => {
            if MOVE_FALLBACK && e.get_errno() == E::XDEV {
                bun_core::Output::debug_warn!("renameatConcurrently() failed with E.XDEV, falling back to moveFileZSlowMaybe()");
                return move_file_z_slow_maybe(from_dir_fd, from, to_dir_fd, to);
            }
            Result::Err(e)
        }
    }
}

pub fn renameat_concurrently_without_fallback(
    from_dir_fd: Fd,
    from: &ZStr,
    to_dir_fd: Fd,
    to: &ZStr,
) -> Result<()> {
    let mut did_atomically_replace = false;
    let _ = did_atomically_replace; // tracked for parity with Zig

    'attempt: {
        {
            // Happy path: the folder doesn't exist in the cache dir, so we can
            // just rename it. We don't need to delete anything.
            let err = match renameat2(from_dir_fd, from, to_dir_fd, to, RenameAt2Flags { exclude: true, ..Default::default() }) {
                // if ENOENT don't retry
                Result::Err(err) => {
                    if err.get_errno() == E::NOENT {
                        return Result::Err(err);
                    }
                    err
                }
                Result::Ok(()) => break 'attempt,
            };

            // Windows doesn't have any equivalent with renameat with swap
            #[cfg(not(windows))]
            {
                // Fallback path: the folder exists in the cache dir, it might be in a strange state
                // let's attempt to atomically replace it with the temporary folder's version
                if matches!(err.get_errno(), E::EXIST | E::NOTEMPTY | E::OPNOTSUPP) {
                    did_atomically_replace = true;
                    match renameat2(from_dir_fd, from, to_dir_fd, to, RenameAt2Flags { exchange: true, ..Default::default() }) {
                        Result::Err(_) => {}
                        Result::Ok(()) => break 'attempt,
                    }
                    did_atomically_replace = false;
                }
            }
            let _ = err;
        }

        //  sad path: let's try to delete the folder and then rename it
        if to_dir_fd.is_valid() {
            // TODO(port): std.fs.Dir.deleteTree → bun_sys equivalent.
            let _ = crate::dir::delete_tree(to_dir_fd, to.as_bytes());
        } else {
            // TODO(port): std.fs.deleteTreeAbsolute
            let _ = crate::dir::delete_tree_absolute(to.as_bytes());
        }
        match renameat(from_dir_fd, from, to_dir_fd, to) {
            Result::Err(err) => return Result::Err(err),
            Result::Ok(()) => {}
        }
    }

    Result::Ok(())
}

pub fn renameat2(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr, flags: RenameAt2Flags) -> Result<()> {
    #[cfg(windows)]
    {
        return renameat(from_dir, from, to_dir, to);
    }

    #[cfg(target_os = "freebsd")]
    {
        // FreeBSD has no renameat2/renameatx_np. exchange/exclude callers fall
        // back to a non-atomic path elsewhere; here we just do a plain rename.
        if flags.int() != 0 {
            return Result::Err(Error::from_code(E::NOSYS, Tag::rename));
        }
        return renameat(from_dir, from, to_dir, to);
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    loop {
        let rc = {
            #[cfg(target_os = "linux")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { syscall::renameat2(from_dir.cast() as _, from.as_ptr(), to_dir.cast() as _, to.as_ptr(), flags.int()) } }
            #[cfg(target_os = "macos")]
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            { unsafe { c::renameatx_np(from_dir.cast() as _, from.as_ptr(), to_dir.cast() as _, to.as_ptr(), flags.int()) } }
        };

        if let Some(err) = Result::<()>::errno_sys(rc, Tag::rename) {
            if err.get_errno() == E::INTR { continue; }
            if cfg!(debug_assertions) {
                log!("renameat2({}, {}, {}, {}) = {}", from_dir, bstr::BStr::new(from.as_bytes()), to_dir, bstr::BStr::new(to.as_bytes()), err.get_errno() as i32);
            }
            return err;
        }
        if cfg!(debug_assertions) {
            log!("renameat2({}, {}, {}, {}) = 0", from_dir, bstr::BStr::new(from.as_bytes()), to_dir, bstr::BStr::new(to.as_bytes()));
        }
        return Result::Ok(());
    }
}

pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Result<()> {
    #[cfg(windows)]
    {
        let w_buf_from = bun_paths::w_path_buffer_pool().get();
        let w_buf_to = bun_paths::w_path_buffer_pool().get();

        return windows::rename_at_w(
            from_dir,
            strings::to_nt_path(&mut *w_buf_from, from.as_bytes()),
            to_dir,
            strings::to_nt_path(&mut *w_buf_to, to.as_bytes()),
            true,
        );
    }
    #[cfg(not(windows))]
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::renameat(from_dir.cast(), from.as_ptr(), to_dir.cast(), to.as_ptr()) },
            Tag::rename,
        ) {
            if err.get_errno() == E::INTR { continue; }
            if cfg!(debug_assertions) {
                log!("renameat({}, {}, {}, {}) = {}", from_dir, bstr::BStr::new(from.as_bytes()), to_dir, bstr::BStr::new(to.as_bytes()), err.get_errno() as i32);
            }
            return err;
        }
        if cfg!(debug_assertions) {
            log!("renameat({}, {}, {}, {}) = 0", from_dir, bstr::BStr::new(from.as_bytes()), to_dir, bstr::BStr::new(to.as_bytes()));
        }
        return Result::Ok(());
    }
}

#[cfg(unix)]
pub fn chown(path: &ZStr, uid: posix::uid_t, gid: posix::gid_t) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { c::chown(path.as_ptr(), uid, gid) },
            Tag::chown,
            path,
        ) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

/// Same as symlink, except it handles ETXTBUSY by unlinking and retrying.
pub fn symlink_running_executable(target: &ZStr, dest: &ZStr) -> Result<()> {
    match symlink(target, dest) {
        Result::Err(err) => match err.get_errno() {
            // If we get ETXTBUSY or BUSY, try deleting it and then symlinking.
            E::BUSY | E::TXTBSY => {
                let _ = unlink(dest);
                symlink(target, dest)
            }
            _ => Result::Err(err),
        },
        Result::Ok(()) => Result::Ok(()),
    }
}

#[cfg(unix)]
pub fn symlink(target: &ZStr, dest: &ZStr) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::symlink(target.as_ptr(), dest.as_ptr()) },
            Tag::symlink,
        ) {
            if err.get_errno() == E::INTR { continue; }
            log!("symlink({}, {}) = {}", bstr::BStr::new(target.as_bytes()), bstr::BStr::new(dest.as_bytes()), <&str>::from(err.get_errno()));
            return err;
        }
        log!("symlink({}, {}) = 0", bstr::BStr::new(target.as_bytes()), bstr::BStr::new(dest.as_bytes()));
        return Result::Ok(());
    }
}

#[cfg(unix)]
pub fn symlinkat(target: &ZStr, dirfd: Fd, dest: &ZStr) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::symlinkat(target.as_ptr(), dirfd.cast(), dest.as_ptr()) },
            Tag::symlinkat,
        ) {
            if err.get_errno() == E::INTR { continue; }
            log!("symlinkat({}, {}, {}) = {}", bstr::BStr::new(target.as_bytes()), dirfd, bstr::BStr::new(dest.as_bytes()), <&str>::from(err.get_errno()));
            return err;
        }
        log!("symlinkat({}, {}, {}) = 0", bstr::BStr::new(target.as_bytes()), dirfd, bstr::BStr::new(dest.as_bytes()));
        return Result::Ok(());
    }
}

#[cfg(windows)]
#[derive(Clone, Copy, Default)]
pub struct WindowsSymlinkOptions {
    pub directory: bool,
}

#[cfg(windows)]
impl WindowsSymlinkOptions {
    // TODO(port): Zig used a `var` (mutable static) for symlink_flags. We mirror with AtomicU32.
    static SYMLINK_FLAGS: AtomicU32 = AtomicU32::new(w::SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE);

    pub fn flags(self) -> u32 {
        // PORT NOTE: Zig mutates the module-level `var symlink_flags` here and
        // returns it (state persists across calls). Mirror that exactly.
        if self.directory {
            Self::SYMLINK_FLAGS.fetch_or(w::SYMBOLIC_LINK_FLAG_DIRECTORY, Ordering::Relaxed);
        }
        Self::SYMLINK_FLAGS.load(Ordering::Relaxed)
    }

    pub fn denied() {
        Self::SYMLINK_FLAGS.store(0, Ordering::Relaxed);
    }

    pub static HAS_FAILED_TO_CREATE_SYMLINK: AtomicBool = AtomicBool::new(false);
}

/// Symlinks on Windows can be relative or absolute, and junctions can
/// only be absolute. Passing `null` for `abs_fallback_junction_target`
/// is saying `target` is already absolute.
#[cfg(windows)]
pub fn symlink_or_junction(dest: &ZStr, target: &ZStr, abs_fallback_junction_target: Option<&ZStr>) -> Result<()> {
    if !WindowsSymlinkOptions::HAS_FAILED_TO_CREATE_SYMLINK.load(Ordering::Relaxed) {
        let sym16 = bun_paths::w_path_buffer_pool().get();
        let target16 = bun_paths::w_path_buffer_pool().get();
        let sym_path = strings::to_w_path_normalize_auto_extend(&mut *sym16, dest.as_bytes());
        let target_path = strings::to_w_path_normalize_auto_extend(&mut *target16, target.as_bytes());
        match symlink_w(sym_path, target_path, WindowsSymlinkOptions { directory: true }) {
            Result::Ok(()) => return Result::Ok(()),
            Result::Err(err) => match err.get_errno() {
                E::EXIST | E::NOENT => {
                    // if the destination already exists, or a component
                    // of the destination doesn't exist, return the error
                    // without trying junctions.
                    return Result::Err(err);
                }
                _ => {
                    // fallthrough to junction
                }
            },
        }
    }

    sys_uv::symlink_uv(
        abs_fallback_junction_target.unwrap_or(target),
        dest,
        windows::libuv::UV_FS_SYMLINK_JUNCTION,
    )
}

#[cfg(windows)]
pub fn symlink_w(dest: &WStr, target: &WStr, options: WindowsSymlinkOptions) -> Result<()> {
    loop {
        let flags = options.flags();

        // SAFETY: FFI call; arguments are valid for the duration of the call.
        if unsafe { windows::CreateSymbolicLinkW(dest.as_ptr(), target.as_ptr(), flags) } == 0 {
            let errno = windows::Win32Error::get();
            log!("CreateSymbolicLinkW({}, {}, {}) = {}",
                bun_core::fmt::fmt_path_u16(dest.as_slice()),
                bun_core::fmt::fmt_path_u16(target.as_slice()),
                flags,
                <&str>::from(errno),
            );
            match errno {
                windows::Win32Error::INVALID_PARAMETER => {
                    if (flags & w::SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0 {
                        WindowsSymlinkOptions::denied();
                        continue;
                    }
                }
                _ => {}
            }

            if let Some(err) = errno.to_system_errno() {
                match err {
                    SystemErrno::ENOENT | SystemErrno::EEXIST => {
                        return Result::Err(Error { errno: err as _, syscall: Tag::symlink, ..Default::default() });
                    }
                    _ => {}
                }
                WindowsSymlinkOptions::HAS_FAILED_TO_CREATE_SYMLINK.store(true, Ordering::Relaxed);
                return Result::Err(Error { errno: err as _, syscall: Tag::symlink, ..Default::default() });
            }
        }

        log!("CreateSymbolicLinkW({}, {}, {}) = 0",
            bun_core::fmt::fmt_path_u16(dest.as_slice()),
            bun_core::fmt::fmt_path_u16(target.as_slice()),
            flags,
        );
        return Result::Ok(());
    }
}

#[cfg(target_os = "macos")]
pub fn clonefile(from: &ZStr, to: &ZStr) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { c::clonefile(from.as_ptr(), to.as_ptr(), 0) },
            Tag::clonefile,
        ) {
            if err.get_errno() == E::INTR { continue; }
            log!("clonefile({}, {}) = {}", bstr::BStr::new(from.as_bytes()), bstr::BStr::new(to.as_bytes()), <&str>::from(err.get_errno()));
            return err;
        }
        log!("clonefile({}, {}) = 0", bstr::BStr::new(from.as_bytes()), bstr::BStr::new(to.as_bytes()));
        return Result::Ok(());
    }
}

#[cfg(target_os = "macos")]
pub fn clonefileat(from: Fd, from_path: &ZStr, to: Fd, to_path: &ZStr) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { c::clonefileat(from.cast(), from_path.as_ptr(), to.cast(), to_path.as_ptr(), 0) },
            Tag::clonefileat,
        ) {
            if err.get_errno() == E::INTR { continue; }
            log!("clonefileat(\n  {},\n  {},\n  {},\n  {},\n) = {}\n", from, bstr::BStr::new(from_path.as_bytes()), to, bstr::BStr::new(to_path.as_bytes()), <&str>::from(err.get_errno()));
            return err;
        }
        log!("clonefileat(\n  {},\n  {},\n  {},\n  {},\n) = 0\n", from, bstr::BStr::new(from_path.as_bytes()), to, bstr::BStr::new(to_path.as_bytes()));
        return Result::Ok(());
    }
}

#[cfg(target_os = "macos")]
pub fn copyfile(from: &ZStr, to: &ZStr, flags: posix::COPYFILE) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { c::copyfile(from.as_ptr(), to.as_ptr(), core::ptr::null_mut(), flags) },
            Tag::copyfile,
        ) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

#[cfg(target_os = "macos")]
pub fn fcopyfile(fd_in: Fd, fd_out: Fd, flags: posix::COPYFILE) -> Result<()> {
    loop {
        if let Some(err) = Result::<()>::errno_sys(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::fcopyfile(fd_in.cast(), fd_out.cast(), core::ptr::null_mut(), flags) },
            Tag::fcopyfile,
        ) {
            if err.get_errno() == E::INTR { continue; }
            return err;
        }
        return Result::Ok(());
    }
}

#[cfg(windows)]
pub fn unlink_w(from: &WStr) -> Result<()> {
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    let ret = unsafe { windows::DeleteFileW(from.as_ptr()) };
    if let Some(err) = Result::<()>::errno_sys(ret, Tag::unlink) {
        log!("DeleteFileW({}) = {}", bun_core::fmt::fmt_path_u16(from.as_slice()), <&str>::from(err.get_errno()));
        return err;
    }
    log!("DeleteFileW({}) = 0", bun_core::fmt::fmt_path_u16(from.as_slice()));
    Result::Ok(())
}

pub fn unlink(from: &ZStr) -> Result<()> {
    #[cfg(windows)]
    {
        let w_buf = bun_paths::w_path_buffer_pool().get();
        return unlink_w(strings::to_w_path_normalize_auto_extend(&mut *w_buf, from.as_bytes()));
    }

    #[cfg(not(windows))]
    loop {
        if let Some(err) = Result::<()>::errno_sys_p(
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { syscall::unlink(from.as_ptr()) },
            Tag::unlink,
            from,
        ) {
            if err.get_errno() == E::INTR { continue; }
            log!("unlink({}) = {}", bstr::BStr::new(from.as_bytes()), <&str>::from(err.get_errno()));
            return err;
        }
        log!("unlink({}) = 0", bstr::BStr::new(from.as_bytes()));
        return Result::Ok(());
    }
}

pub fn rmdir(to: impl AsRef<[u8]>) -> Result<()> {
    rmdirat(Fd::cwd(), to)
}

pub fn rmdirat(dirfd: Fd, to: impl AsRef<[u8]>) -> Result<()> {
    unlinkat_with_flags(dirfd, to, posix::AT_REMOVEDIR)
}

// TODO(port): `to: anytype` accepts both u8 and u16 slices. We use a generic with
// runtime dispatch on element width via OsPathLike trait in Phase B.
pub fn unlinkat_with_flags(dirfd: Fd, to: impl AsRef<[u8]>, flags: c_uint) -> Result<()> {
    #[cfg(windows)]
    {
        // TODO(port): Zig dispatches on element type (u8 vs u16) via @TypeOf.
        let w_buf = bun_paths::w_path_buffer_pool().get();
        let to_nt = strings::to_nt_path(&mut *w_buf, to.as_ref());
        return windows::delete_file_bun(to_nt, windows::DeleteFileOptions {
            dir: if dirfd != Fd::invalid() { Some(dirfd.cast()) } else { None },
            remove_dir: flags & posix::AT_REMOVEDIR != 0,
        });
    }

    #[cfg(not(windows))]
    {
        let to = to.as_ref();
        // TODO(port): expects `to` to be NUL-terminated when posix; in Zig anytype
        // could be [:0]const u8 or [*:0]const u8. Phase B: tighten to &ZStr.
        loop {
            if let Some(err) = Result::<()>::errno_sys_fp(
                // SAFETY: FFI call; arguments are valid for the duration of the call.
                unsafe { syscall::unlinkat(dirfd.cast(), to.as_ptr() as *const c_char, flags) },
                Tag::unlink,
                dirfd,
                to,
            ) {
                if err.get_errno() == E::INTR { continue; }
                if cfg!(debug_assertions) {
                    log!("unlinkat({}, {}) = {}", dirfd, bstr::BStr::new(to), <&str>::from(err.get_errno()));
                }
                return err;
            }
            if cfg!(debug_assertions) {
                log!("unlinkat({}, {}) = 0", dirfd, bstr::BStr::new(to));
            }
            return Result::Ok(());
        }
    }
}

pub fn unlinkat(dirfd: Fd, to: impl AsRef<[u8]>) -> Result<()> {
    #[cfg(windows)]
    {
        return unlinkat_with_flags(dirfd, to, 0);
    }
    #[cfg(not(windows))]
    {
        let to = to.as_ref();
        loop {
            if let Some(err) = Result::<()>::errno_sys_fp(
                // SAFETY: FFI call; arguments are valid for the duration of the call.
                unsafe { syscall::unlinkat(dirfd.cast(), to.as_ptr() as *const c_char, 0) },
                Tag::unlink,
                dirfd,
                to,
            ) {
                if err.get_errno() == E::INTR { continue; }
                if cfg!(debug_assertions) {
                    log!("unlinkat({}, {}) = {}", dirfd, bstr::BStr::new(to), <&str>::from(err.get_errno()));
                }
                return err;
            }
            if cfg!(debug_assertions) {
                log!("unlinkat({}, {}) = 0", dirfd, bstr::BStr::new(to));
            }
            return Result::Ok(());
        }
    }
}

/// FreeBSD Linuxulator: linprocfs's /proc/<pid>/fd escapes emul_path and lands
/// on host devfs, so readlink fails. Use fdescfs at /dev/fd instead.
#[cfg(target_os = "linux")]
fn get_fd_path_freebsd_linuxulator<'a>(fd: Fd, out_buffer: &'a mut PathBuffer) -> Result<&'a mut [u8]> {
    let mut buf = [0u8; "/dev/fd/-2147483648".len() + 1];
    let path = {
        use std::io::Write;
        let mut cursor = &mut buf[..];
        write!(cursor, "/dev/fd/{}\0", fd.cast()).expect("unreachable");
        let len = buf.len() - cursor.len() - 1;
        // SAFETY: NUL written by format string.
        unsafe { ZStr::from_raw(buf.as_ptr(), len) }
    };
    match readlink(path, &mut out_buffer[..]) {
        Result::Ok(r) => Result::Ok(r.as_bytes_mut()),
        Result::Err(err) => Result::Err(err),
    }
}

pub fn get_fd_path<'a>(fd: Fd, out_buffer: &'a mut PathBuffer) -> Result<&'a mut [u8]> {
    #[cfg(windows)]
    {
        let mut wide_buf = [0u16; windows::PATH_MAX_WIDE];
        let wide_slice = match windows::get_final_path_name_by_handle(fd.cast(), Default::default(), &mut wide_buf[..]) {
            Ok(s) => s,
            Err(_) => return Result::Err(Error { errno: SystemErrno::EBADF as _, syscall: Tag::GetFinalPathNameByHandle, ..Default::default() }),
        };
        // Trust that Windows gives us valid UTF-16LE.
        // TODO(port): from_w_path returns a borrowed slice into out_buffer; cast away const for parity.
        return Result::Ok(strings::from_w_path_mut(out_buffer, wide_slice));
    }
    #[cfg(target_os = "macos")]
    {
        // On macOS, we can use F.GETPATH fcntl command to query the OS for
        // the path to the file descriptor.
        out_buffer.fill(0);
        if let Result::Err(err) = fcntl(fd, posix::F_GETPATH, out_buffer.as_mut_ptr() as usize) {
            return Result::Err(err);
        }
        let len = out_buffer.iter().position(|&b| b == 0).unwrap_or(out_buffer.len());
        return Result::Ok(&mut out_buffer[0..len]);
    }
    #[cfg(target_os = "linux")]
    {
        // Fast path: a previous call already proved this is FreeBSD's Linuxulator.
        if LinuxKernel::cached().load(Ordering::Acquire) == LinuxKernel::FreeBSD as u8 {
            return get_fd_path_freebsd_linuxulator(fd, out_buffer);
        }
        let mut buf = [0u8; "/proc/self/fd/-2147483648".len() + 1];
        let path = {
            use std::io::Write;
            let mut cursor = &mut buf[..];
            write!(cursor, "/proc/self/fd/{}\0", fd.cast()).expect("unreachable");
            let len = buf.len() - cursor.len() - 1;
            // SAFETY: buffer is NUL-terminated at the given length (written above).
            unsafe { ZStr::from_raw(buf.as_ptr(), len) }
        };
        return match readlink(path, &mut out_buffer[..]) {
            Result::Ok(r) => Result::Ok(r.as_bytes_mut()),
            Result::Err(err) => {
                // readlink on /proc/self/fd/N basically never fails on real
                // Linux. We don't want to guess based on errno -- ENOENT etc.
                // could mean any number of things. Instead, pay one syscall
                // (memoized) to read /proc/version and only take the /dev/fd
                // path when we've positively identified FreeBSD's Linuxulator.
                // Otherwise, surface the original error unchanged.
                if LinuxKernel::get() == LinuxKernel::FreeBSD {
                    return get_fd_path_freebsd_linuxulator(fd, out_buffer);
                }
                Result::Err(err)
            }
        };
    }
    #[cfg(target_os = "freebsd")]
    {
        // FreeBSD: F_KINFO returns a struct kinfo_file with kf_path. The
        // /dev/fd readlink trick used for the Linuxulator path doesn't
        // resolve to an absolute path on native FreeBSD, so go via fcntl.
        // SAFETY: all-zero is a valid value for this repr(C) POD type.
        let mut info: c::struct_kinfo_file = unsafe { mem::zeroed() };
        info.kf_structsize = mem::size_of::<c::struct_kinfo_file>() as _;
        if let Result::Err(err) = fcntl(fd, c::F_KINFO, (&mut info) as *mut _ as usize) {
            return Result::Err(err);
        }
        let path = bun_str::slice_to_nul(&info.kf_path);
        out_buffer[0..path.len()].copy_from_slice(path);
        return Result::Ok(&mut out_buffer[0..path.len()]);
    }
}

/// Use of a mapped region can result in these signals:
/// * SIGSEGV - Attempted write into a region mapped as read-only.
/// * SIGBUS - Attempted  access to a portion of the buffer that does not correspond to the file
#[cfg(unix)]
pub fn mmap(
    ptr: Option<*mut u8>,
    length: usize,
    prot: u32,
    flags: posix::MapFlags,
    fd: Fd,
    offset: u64,
) -> Result<&'static mut [u8]> {
    let ioffset = offset as i64; // the OS treats this as unsigned
    // SAFETY: FFI call; ptr is either null or a hint address, fd is a valid live fd.
    let rc = unsafe { libc::mmap(ptr.unwrap_or(core::ptr::null_mut()) as *mut c_void, length, prot as _, flags, fd.cast(), ioffset) };
    let fail = libc::MAP_FAILED;
    if rc == fail {
        return Result::Err(Error {
            errno: get_errno((fail as i64) as isize) as _,
            syscall: Tag::mmap,
            ..Default::default()
        });
    }
    // SAFETY: mmap returned a valid mapping of `length` bytes.
    Result::Ok(unsafe { core::slice::from_raw_parts_mut(rc as *mut u8, length) })
}

#[cfg(unix)]
pub fn mmap_file(path: &ZStr, flags: libc::c_int, wanted_size: Option<usize>, offset: usize) -> Result<&'static mut [u8]> {
    let fd = match open(path, O::RDWR, 0) {
        Result::Ok(fd) => fd,
        Result::Err(err) => return Result::Err(err),
    };
    let _close = scopeguard::guard((), |_| fd.close());

    let stat_size = match fstat(fd) {
        Result::Ok(result) => usize::try_from(result.size).unwrap(),
        Result::Err(err) => return Result::Err(err),
    };
    let mut size = stat_size.checked_sub(offset).unwrap_or(0);

    if let Some(size_) = wanted_size {
        size = size.min(size_);
    }

    match mmap(None, size, posix::PROT_READ | posix::PROT_WRITE, flags, fd, offset as u64) {
        Result::Ok(map) => Result::Ok(map),
        Result::Err(err) => Result::Err(err),
    }
}

#[cfg(unix)]
pub fn set_close_on_exec(fd: Fd) -> Result<()> {
    match fcntl(fd, posix::F_GETFD, 0) {
        Result::Ok(fl) => match fcntl(fd, posix::F_SETFD, (fl as usize) | posix::FD_CLOEXEC as usize) {
            Result::Ok(_) => {}
            Result::Err(err) => return Result::Err(err),
        },
        Result::Err(err) => return Result::Err(err),
    }
    Result::Ok(())
}

#[cfg(unix)]
pub fn setsockopt(fd: Fd, level: c_int, optname: u32, value: i32) -> Result<i32> {
    loop {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            syscall::setsockopt(
                fd.cast(),
                level,
                optname,
                (&value) as *const i32 as *const c_void,
                mem::size_of::<i32>() as _,
            )
        };
        if let Some(err) = Result::<i32>::errno_sys_fd(rc, Tag::setsockopt, fd) {
            if err.get_errno() == E::INTR { continue; }
            log!("setsockopt() = {} {}", err.err().errno, err.err().name());
            return err;
        }
        log!("setsockopt({}, {}, {}) = {}", fd.cast(), level, optname, rc);
        return Result::Ok(i32::try_from(rc).unwrap());
    }
}

pub fn set_no_sigpipe(fd: Fd) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        log!("setNoSigpipe({})", fd);
        return match setsockopt(fd, posix::SOL_SOCKET, posix::SO_NOSIGPIPE, 1) {
            Result::Ok(_) => Result::Ok(()),
            Result::Err(err) => Result::Err(err),
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = fd;
        Result::Ok(())
    }
}

#[cfg(target_os = "linux")]
type SocketpairT = i32;
#[cfg(all(unix, not(target_os = "linux")))]
type SocketpairT = c_uint;

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum NonblockingStatus { Blocking, Nonblocking }

/// libc socketpair() except it defaults to:
/// - SOCK_CLOEXEC on Linux
/// - SO_NOSIGPIPE on macOS
///
/// On POSIX it otherwise makes it do O_CLOEXEC.
#[cfg(unix)]
pub fn socketpair(domain: SocketpairT, socktype: SocketpairT, protocol: SocketpairT, nonblocking_status: NonblockingStatus) -> Result<[Fd; 2]> {
    socketpair_impl(domain, socktype, protocol, nonblocking_status, false)
}

/// We can't actually use SO_NOSIGPIPE for the stdout of a
/// subprocess we don't control because they have different
/// semantics.
///
/// For example, when running the shell script:
/// `grep hi src/js_parser/zig | echo hi`,
///
/// The `echo hi` command will terminate first and close its
/// end of the socketpair.
///
/// With SO_NOSIGPIPE, when `grep` continues and tries to write to
/// stdout, `ESIGPIPE` is returned and then `grep` handles this
/// and prints `grep: stdout: Broken pipe`
///
/// So the solution is to NOT set SO_NOGSIGPIPE in that scenario.
///
/// I think this only applies to stdout/stderr, not stdin. `read(...)`
/// and `recv(...)` do not return EPIPE as error codes.
#[cfg(unix)]
pub fn socketpair_for_shell(domain: SocketpairT, socktype: SocketpairT, protocol: SocketpairT, nonblocking_status: NonblockingStatus) -> Result<[Fd; 2]> {
    socketpair_impl(domain, socktype, protocol, nonblocking_status, true)
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ShellSigpipeConfig {
    /// Only SO_NOSIGPIPE for the socket in the pair
    /// that *we're* going to use, don't touch the one
    /// we hand off to the subprocess
    Spawn,
    /// off completely
    Pipeline,
}

#[cfg(unix)]
pub fn socketpair_impl(domain: SocketpairT, socktype: SocketpairT, protocol: SocketpairT, nonblocking_status: NonblockingStatus, for_shell: bool) -> Result<[Fd; 2]> {
    let mut fds_i: [c_int; 2] = [0, 0];

    #[cfg(target_os = "linux")]
    {
        loop {
            let nonblock_flag: i32 = if nonblocking_status == NonblockingStatus::Nonblocking { syscall::SOCK_NONBLOCK } else { 0 };
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let rc = unsafe { syscall::socketpair(domain, socktype | syscall::SOCK_CLOEXEC | nonblock_flag, protocol, &mut fds_i) };
            if let Some(err) = Result::<[Fd; 2]>::errno_sys(rc, Tag::socketpair) {
                if err.get_errno() == E::INTR { continue; }
                log!("socketpair() = {} {}", err.err().errno, err.err().name());
                return err;
            }
            break;
        }
        let _ = for_shell;
    }
    #[cfg(not(target_os = "linux"))]
    {
        loop {
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let err = unsafe { libc::socketpair(domain as _, socktype as _, protocol as _, fds_i.as_mut_ptr()) };
            if let Some(err2) = Result::<[Fd; 2]>::errno_sys(err, Tag::socketpair) {
                if err2.get_errno() == E::INTR { continue; }
                log!("socketpair() = {} {}", err2.err().errno, err2.err().name());
                return err2;
            }
            break;
        }

        let err: Option<Error> = 'err: {
            // Set O_CLOEXEC first.
            for i in 0..2 {
                match set_close_on_exec(Fd::from_native(fds_i[i])) {
                    Result::Err(err) => break 'err Some(err),
                    Result::Ok(()) => {}
                }
            }

            #[cfg(target_os = "macos")]
            {
                if for_shell {
                    // see the comment on `socketpairForShell` for why we don't
                    // set SO_NOSIGPIPE here.

                    // macOS seems to default to around 8
                    // KB for the buffer size this is comically small. for
                    // processes normally, we do about 512 KB. for this we do
                    // 128 KB since you might have a lot of them at once.
                    let so_recvbuf: c_int = 1024 * 128;
                    let so_sendbuf: c_int = 1024 * 128;
                    // SAFETY: FFI call; arguments are valid for the duration of the call.
                    unsafe {
                        let _ = libc::setsockopt(fds_i[1], posix::SOL_SOCKET, posix::SO_RCVBUF, (&so_recvbuf) as *const c_int as *const c_void, mem::size_of::<c_int>() as _);
                        let _ = libc::setsockopt(fds_i[0], posix::SOL_SOCKET, posix::SO_SNDBUF, (&so_sendbuf) as *const c_int as *const c_void, mem::size_of::<c_int>() as _);
                    }
                } else {
                    for i in 0..2 {
                        match set_no_sigpipe(Fd::from_native(fds_i[i])) {
                            Result::Err(err) => break 'err Some(err),
                            _ => {}
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            { let _ = for_shell; }

            if nonblocking_status == NonblockingStatus::Nonblocking {
                for i in 0..2 {
                    match set_nonblocking(Fd::from_native(fds_i[i])) {
                        Result::Err(err) => break 'err Some(err),
                        Result::Ok(()) => {}
                    }
                }
            }

            None
        };

        // On any error after socketpair(), we need to close it.
        if let Some(errr) = err {
            for i in 0..2 {
                Fd::from_native(fds_i[i]).close();
            }
            log!("socketpair() = {} {}", errr.errno, errr.name());
            return Result::Err(errr);
        }
    }

    log!("socketpair() = [{} {}]", fds_i[0], fds_i[1]);

    Result::Ok([Fd::from_native(fds_i[0]), Fd::from_native(fds_i[1])])
}

#[cfg(unix)]
pub fn munmap(memory: &[u8]) -> Result<()> {
    if let Some(err) = Result::<()>::errno_sys(
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        unsafe { syscall::munmap(memory.as_ptr() as *mut c_void, memory.len()) },
        Tag::munmap,
    ) {
        return err;
    }
    Result::Ok(())
}

#[cfg(target_os = "linux")]
#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum MemfdFlags {
    // Recent Linux kernel versions require MFD_EXEC.
    Executable = Self::MFD_EXEC | Self::MFD_ALLOW_SEALING | Self::MFD_CLOEXEC,
    NonExecutable = Self::MFD_NOEXEC_SEAL | Self::MFD_ALLOW_SEALING | Self::MFD_CLOEXEC,
    CrossProcess = Self::MFD_NOEXEC_SEAL,
}

#[cfg(target_os = "linux")]
impl MemfdFlags {
    pub fn older_kernel_flag(self) -> u32 {
        match self {
            MemfdFlags::NonExecutable | MemfdFlags::Executable => Self::MFD_CLOEXEC,
            MemfdFlags::CrossProcess => 0,
        }
    }

    const MFD_NOEXEC_SEAL: u32 = 0x0008;
    const MFD_EXEC: u32 = 0x0010;
    const MFD_CLOEXEC: u32 = syscall::MFD_CLOEXEC;
    const MFD_ALLOW_SEALING: u32 = syscall::MFD_ALLOW_SEALING;
}

/// memfd_create requires kernel >= 3.17. Latched true on first ENOSYS so
/// callers can take their existing fallback (heap buffer / pipe / socketpair)
/// without retrying the syscall on every Blob/spawn.
static MEMFD_ENOSYS: AtomicBool = AtomicBool::new(false);

pub fn can_use_memfd() -> bool {
    #[cfg(not(target_os = "linux"))]
    { return false; }
    #[cfg(target_os = "linux")]
    {
        if bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_MEMFD.get() { return false; }
        !MEMFD_ENOSYS.load(Ordering::Relaxed)
    }
}

#[cfg(target_os = "linux")]
pub fn memfd_create(name: &ZStr, flags_: MemfdFlags) -> Result<Fd> {
    let mut flags: u32 = flags_ as u32;
    loop {
        // SAFETY: FFI call with valid NUL-terminated name; flags are plain bits.
        let rc = unsafe { syscall::memfd_create(name.as_ptr(), flags) };
        log!("memfd_create({}, {}) = {}", bstr::BStr::new(name.as_bytes()), <&str>::from(flags_), rc);

        if let Some(err) = Result::<Fd>::errno_sys(rc, Tag::memfd_create) {
            match err.get_errno() {
                E::INTR => continue,
                E::INVAL => {
                    // MFD_EXEC / MFD_NOEXEC_SEAL require Linux 6.3.
                    if (flags_ as u32) == flags {
                        flags = flags_.older_kernel_flag();
                        log!("memfd_create retrying without exec/noexec flag, using {}", flags);
                        continue;
                    }
                }
                E::NOSYS | E::PERM | E::ACCES => MEMFD_ENOSYS.store(true, Ordering::Relaxed),
                _ => {}
            }
            return err;
        }

        return Result::Ok(Fd::from_native(rc as _));
    }
}

#[cfg(target_os = "linux")]
pub fn set_pipe_capacity_on_linux(fd: Fd, capacity: usize) -> Result<usize> {
    debug_assert!(capacity > 0);

    // In  Linux  versions  before 2.6.11, the capacity of a
    // pipe was the same as the system page size (e.g., 4096
    // bytes on i386).  Since Linux 2.6.11, the pipe
    // capacity is 16 pages (i.e., 65,536 bytes in a system
    // with a page size of 4096 bytes).  Since Linux 2.6.35,
    // the default pipe capacity is 16 pages, but the
    // capacity can be queried  and  set  using  the
    // fcntl(2) F_GETPIPE_SZ and F_SETPIPE_SZ operations.
    // See fcntl(2) for more information.
    //:# define F_SETPIPE_SZ    1031    /* Set pipe page size array.
    const F_SETPIPE_SZ: i32 = 1031;
    const F_GETPIPE_SZ: i32 = 1032;

    // We don't use glibc here
    // It didn't work. Always returned 0.
    let pipe_len = match fcntl(fd, F_GETPIPE_SZ, 0) {
        Result::Ok(result) => result,
        Result::Err(err) => return Result::Err(err),
    };
    if pipe_len == 0 { return Result::Ok(0); }
    if pipe_len as usize >= capacity { return Result::Ok(pipe_len as usize); }

    let new_pipe_len = match fcntl(fd, F_SETPIPE_SZ, capacity) {
        Result::Ok(result) => result,
        Result::Err(err) => return Result::Err(err),
    };
    Result::Ok(new_pipe_len as usize)
}

#[cfg(target_os = "linux")]
pub fn get_max_pipe_size_on_linux() -> usize {
    // TODO(port): bun.once(fn) wrapper -> using std::sync::OnceLock.
    static ONCE: std::sync::OnceLock<c_int> = std::sync::OnceLock::new();
    *ONCE.get_or_init(|| {
        let default_out_size: c_int = 512 * 1024;
        let pipe_max_size_fd = match open(ZStr::from_bytes(b"/proc/sys/fs/pipe-max-size"), O::RDONLY, 0) {
            Result::Ok(fd2) => fd2,
            Result::Err(err) => {
                log!("Failed to open /proc/sys/fs/pipe-max-size: {}\n", err.errno);
                return default_out_size;
            }
        };
        let _close = scopeguard::guard((), |_| pipe_max_size_fd.close());
        let mut max_pipe_size_buf = [0u8; 128];
        let max_pipe_size = match read(pipe_max_size_fd, &mut max_pipe_size_buf[..]) {
            Result::Ok(bytes_read) => {
                let trimmed = strings::trim(&max_pipe_size_buf[0..bytes_read], b"\n");
                // TODO(port): Zig used `std.fmt.parseInt(i64, bytes, 10)` directly on []const u8.
                // Avoid UTF-8 validation on syscall bytes; use a byte-level parser.
                match bun_str::strings::parse_int::<i64>(trimmed, 10) {
                    Some(v) => v,
                    None => {
                        log!("Failed to parse /proc/sys/fs/pipe-max-size\n");
                        return default_out_size;
                    }
                }
            }
            Result::Err(err) => {
                log!("Failed to read /proc/sys/fs/pipe-max-size: {}\n", err.errno);
                return default_out_size;
            }
        };

        // we set the absolute max to 8 MB because honestly that's a huge pipe
        // my current linux machine only goes up to 1 MB, so that's very unlikely to be hit
        c_int::try_from(max_pipe_size.saturating_sub(32)).unwrap().min(1024 * 1024 * 8)
    }) as usize
}

#[cfg(windows)]
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct WindowsFileAttributes(windows::DWORD);

#[cfg(windows)]
impl WindowsFileAttributes {
    // packed struct(u32) -- manual shift accessors per PORTING.md
    //1 0x00000001 FILE_ATTRIBUTE_READONLY
    pub fn is_readonly(self) -> bool { self.0 & 0x00000001 != 0 }
    //2 0x00000002 FILE_ATTRIBUTE_HIDDEN
    pub fn is_hidden(self) -> bool { self.0 & 0x00000002 != 0 }
    //4 0x00000004 FILE_ATTRIBUTE_SYSTEM
    pub fn is_system(self) -> bool { self.0 & 0x00000004 != 0 }
    //1 0x00000010 FILE_ATTRIBUTE_DIRECTORY
    pub fn is_directory(self) -> bool { self.0 & 0x00000010 != 0 }
    //2 0x00000020 FILE_ATTRIBUTE_ARCHIVE
    pub fn is_archive(self) -> bool { self.0 & 0x00000020 != 0 }
    //4 0x00000040 FILE_ATTRIBUTE_DEVICE
    pub fn is_device(self) -> bool { self.0 & 0x00000040 != 0 }
    //8 0x00000080 FILE_ATTRIBUTE_NORMAL
    pub fn is_normal(self) -> bool { self.0 & 0x00000080 != 0 }
    //1 0x00000100 FILE_ATTRIBUTE_TEMPORARY
    pub fn is_temporary(self) -> bool { self.0 & 0x00000100 != 0 }
    //2 0x00000200 FILE_ATTRIBUTE_SPARSE_FILE
    pub fn is_sparse_file(self) -> bool { self.0 & 0x00000200 != 0 }
    //4 0x00000400 FILE_ATTRIBUTE_REPARSE_POINT
    pub fn is_reparse_point(self) -> bool { self.0 & 0x00000400 != 0 }
    //8 0x00000800 FILE_ATTRIBUTE_COMPRESSED
    pub fn is_compressed(self) -> bool { self.0 & 0x00000800 != 0 }
    //1 0x00001000 FILE_ATTRIBUTE_OFFLINE
    pub fn is_offline(self) -> bool { self.0 & 0x00001000 != 0 }
    //2 0x00002000 FILE_ATTRIBUTE_NOT_CONTENT_INDEXED
    pub fn is_not_content_indexed(self) -> bool { self.0 & 0x00002000 != 0 }
    //4 0x00004000 FILE_ATTRIBUTE_ENCRYPTED
    pub fn is_encrypted(self) -> bool { self.0 & 0x00004000 != 0 }
    //8 0x00008000 FILE_ATTRIBUTE_INTEGRITY_STREAM
    pub fn is_integrity_stream(self) -> bool { self.0 & 0x00008000 != 0 }
    //1 0x00010000 FILE_ATTRIBUTE_VIRTUAL
    pub fn is_virtual(self) -> bool { self.0 & 0x00010000 != 0 }
    //2 0x00020000 FILE_ATTRIBUTE_NO_SCRUB_DATA
    pub fn is_no_scrub_data(self) -> bool { self.0 & 0x00020000 != 0 }
    //4 0x00040000 FILE_ATTRIBUTE_EA
    pub fn is_ea(self) -> bool { self.0 & 0x00040000 != 0 }
    //8 0x00080000 FILE_ATTRIBUTE_PINNED
    pub fn is_pinned(self) -> bool { self.0 & 0x00080000 != 0 }
    //1 0x00100000 FILE_ATTRIBUTE_UNPINNED
    pub fn is_unpinned(self) -> bool { self.0 & 0x00100000 != 0 }
    //4 0x00040000 FILE_ATTRIBUTE_RECALL_ON_OPEN
    pub fn is_recall_on_open(self) -> bool { self.0 & 0x00400000 != 0 }
    //4 0x00400000 FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
    pub fn is_recall_on_data_access(self) -> bool { self.0 & 0x04000000 != 0 }
}

#[cfg(windows)]
pub fn get_file_attributes(path: impl WinPathLike) -> Option<WindowsFileAttributes> {
    // TODO(port): Zig dispatches on element type via @TypeOf. WinPathLike trait
    // provides .as_u16_slice_z() converting via to_kernel32_path if u8.
    if path.is_u16() {
        // Win32 API does file path normalization, so we do not need the valid path assertion here.
        // SAFETY: FFI call with valid NUL-terminated wide path.
        let dword = unsafe { kernel32::GetFileAttributesW(path.as_ptr_u16()) };
        if cfg!(debug_assertions) {
            log!("GetFileAttributesW({}) = {}", bun_core::fmt::utf16(path.as_u16_slice()), dword);
        }
        if dword == windows::INVALID_FILE_ATTRIBUTES {
            return None;
        }
        Some(WindowsFileAttributes(dword))
    } else {
        let wbuf = bun_paths::w_path_buffer_pool().get();
        let path_to_use = strings::to_kernel32_path(&mut *wbuf, path.as_u8_slice());
        get_file_attributes(path_to_use)
    }
}

pub fn exists_os_path(path: bun_paths::OSPathSliceZ<'_>, file_only: bool) -> bool {
    #[cfg(unix)]
    {
        let _ = file_only;
        // access() may not work correctly on NFS file systems with UID
        // mapping enabled, because UID mapping is done on the server and
        // hidden from the client, which checks permissions. Similar
        // problems can occur to FUSE mounts.
        // SAFETY: FFI call with valid NUL-terminated path.
        return unsafe { syscall::access(path.as_ptr(), 0) } == 0;
    }

    #[cfg(windows)]
    {
        let Some(attributes) = get_file_attributes(path) else { return false; };
        if file_only && attributes.is_directory() {
            return false;
        }
        if attributes.is_reparse_point() {
            // Check if the underlying file exists by opening it.
            // SAFETY: FFI call with valid NUL-terminated wide path; null security/template handles.
            let rc = unsafe {
                kernel32::CreateFileW(
                    path.as_ptr(),
                    0,
                    0,
                    core::ptr::null_mut(),
                    w::OPEN_EXISTING,
                    w::FILE_FLAG_BACKUP_SEMANTICS,
                    core::ptr::null_mut(),
                )
            };
            if rc == w::INVALID_HANDLE_VALUE { return false; }
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe { let _ = windows::CloseHandle(rc); }
            return true;
        }
        return true;
    }
}

pub fn exists(path: &[u8]) -> bool {
    #[cfg(unix)]
    {
        let Ok(p) = posix::to_posix_path(path) else { return false; };
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        return unsafe { syscall::access(p.as_ptr(), 0) } == 0;
    }
    #[cfg(windows)]
    {
        return get_file_attributes(path).is_some();
    }
}

pub fn exists_z(path: &ZStr) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        return unsafe { syscall::access(path.as_ptr(), 0) } == 0;
    }
    #[cfg(windows)]
    {
        return get_file_attributes(path.as_bytes()).is_some();
    }
}

#[cfg(unix)]
pub fn faccessat(dir_fd: Fd, subpath: impl AsRef<[u8]>) -> Result<bool> {
    // TODO(port): Zig checks std.meta.sentinel; Rust callers always provide a slice.
    let subpath = subpath.as_ref();
    let path = match posix::to_posix_path(subpath) {
        Ok(p) => p,
        Err(_) => return Result::Err(Error::from_code(E::NAMETOOLONG, Tag::access)),
    };

    #[cfg(target_os = "linux")]
    {
        // avoid loading the libc symbol for this to reduce chances of GLIBC minimum version requirements
        // SAFETY: FFI call with valid dirfd and NUL-terminated path.
        let rc = unsafe { syscall::faccessat(dir_fd.cast(), path.as_ptr(), syscall::F_OK, 0) };
        log!("faccessat({}, {}, O_RDONLY, 0) = {}", dir_fd, bstr::BStr::new(subpath), if rc == 0 { 0 } else { get_errno(rc) as i32 });
        return Result::Ok(rc == 0);
    }

    #[cfg(not(target_os = "linux"))]
    {
        // on other platforms use faccessat from libc
        // SAFETY: FFI call with valid dirfd and NUL-terminated path.
        let rc = unsafe { libc::faccessat(dir_fd.cast(), path.as_ptr(), posix::F_OK, 0) };
        log!("faccessat({}, {}, O_RDONLY, 0) = {}", dir_fd, bstr::BStr::new(subpath), if rc == 0 { 0 } else { get_errno(rc) as i32 });
        Result::Ok(rc == 0)
    }
}

pub fn directory_exists_at(dir: Fd, subpath: impl AsRef<[u8]>) -> Result<bool> {
    match exists_at_type(dir, subpath) {
        Result::Err(err) => {
            if err.get_errno() == E::NOENT {
                Result::Ok(false)
            } else {
                Result::Err(err)
            }
        }
        Result::Ok(result) => Result::Ok(result == ExistsAtType::Directory),
    }
}

#[cfg(unix)]
pub fn futimens(fd: Fd, atime: node::TimeLike, mtime: node::TimeLike) -> Result<()> {
    loop {
        let times: [libc::timespec; 2] = [
            libc::timespec { tv_sec: atime.sec as _, tv_nsec: atime.nsec as _ },
            libc::timespec { tv_sec: mtime.sec as _, tv_nsec: mtime.nsec as _ },
        ];
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::futimens(fd.cast(), times.as_ptr()) };

        log!("futimens({}, accessed=({}, {}), modified=({}, {})) = {}", fd, atime.sec, atime.nsec, mtime.sec, mtime.nsec, rc);

        if rc == 0 {
            return Result::Ok(());
        }

        match get_errno(rc) {
            E::INTR => continue,
            _ => return Result::<()>::errno_sys_fd(rc, Tag::futimens, fd).unwrap(),
        }
    }
}

#[cfg(unix)]
fn utimens_with_flags(path: bun_paths::OSPathSliceZ<'_>, atime: node::TimeLike, mtime: node::TimeLike, flags: u32) -> Result<()> {
    loop {
        let times: [libc::timespec; 2] = [
            libc::timespec { tv_sec: atime.sec as _, tv_nsec: atime.nsec as _ },
            libc::timespec { tv_sec: mtime.sec as _, tv_nsec: mtime.nsec as _ },
        ];
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            syscall::utimensat(
                posix::cwd_fd(),
                path.as_ptr(),
                // this var should be a const, the zig type definition is wrong.
                times.as_ptr(),
                flags,
            )
        };

        log!("utimensat({}, atime=({}, {}), mtime=({}, {})) = {}", posix::cwd_fd(), atime.sec, atime.nsec, mtime.sec, mtime.nsec, rc);

        if rc == 0 {
            return Result::Ok(());
        }

        match get_errno(rc) {
            E::INTR => continue,
            _ => return Result::<()>::errno_sys_p(rc, Tag::utimensat, path).unwrap(),
        }
    }
}

#[cfg(unix)]
pub fn get_fcntl_flags(fd: Fd) -> Result<FnctlInt> {
    fcntl(fd, posix::F_GETFL, 0)
}

#[cfg(unix)]
pub fn utimens(path: bun_paths::OSPathSliceZ<'_>, atime: node::TimeLike, mtime: node::TimeLike) -> Result<()> {
    utimens_with_flags(path, atime, mtime, 0)
}

#[cfg(unix)]
pub fn set_nonblocking(fd: Fd) -> Result<()> {
    update_nonblocking(fd, true)
}

#[cfg(unix)]
pub fn update_nonblocking(fd: Fd, nonblocking: bool) -> Result<()> {
    let current_flags: i32 = match get_fcntl_flags(fd) {
        Result::Ok(f) => f as i32,
        Result::Err(err) => return Result::Err(err),
    };

    let new_flags: i32 = if nonblocking {
        current_flags | O::NONBLOCK
    } else {
        current_flags & !O::NONBLOCK
    };

    if new_flags != current_flags {
        if let Result::Err(err) = fcntl(fd, posix::F_SETFL, new_flags as usize) {
            return Result::Err(err);
        }
    }

    Result::Ok(())
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ExistsAtType {
    File,
    Directory,
}

pub fn exists_at_type(fd: Fd, subpath: impl AsRef<[u8]>) -> Result<ExistsAtType> {
    #[cfg(windows)]
    {
        let wbuf = bun_paths::w_path_buffer_pool().get();
        // TODO(port): Zig dispatches on element type (u8/u16). Phase B: WinPathLike.
        let mut path = strings::to_nt_path(&mut *wbuf, subpath.as_ref());

        // trim leading .\
        // NtQueryAttributesFile expects relative paths to not start with .\
        if path.len() > 2 && path[0] == b'.' as u16 && path[1] == b'\\' as u16 {
            path = &path[2..];
        }

        let path_len_bytes: u16 = (path.len() * 2) as u16;
        let mut nt_name = w::UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: path.as_ptr() as *mut u16,
        };
        let attr = w::OBJECT_ATTRIBUTES {
            Length: mem::size_of::<w::OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: if bun_paths::is_absolute_windows_wtf16(path) {
                core::ptr::null_mut()
            } else if fd == Fd::invalid() {
                posix::cwd_fd()
            } else {
                fd.cast()
            },
            Attributes: 0,
            ObjectName: &mut nt_name,
            SecurityDescriptor: core::ptr::null_mut(),
            SecurityQualityOfService: core::ptr::null_mut(),
        };
        // SAFETY: all-zero is a valid value for this repr(C) POD type.
        let mut basic_info: w::FILE_BASIC_INFORMATION = unsafe { mem::zeroed() };
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { ntdll::NtQueryAttributesFile(&attr, &mut basic_info) };
        if let Some(err) = Result::<bool>::errno_sys(rc, Tag::access) {
            log!("NtQueryAttributesFile({}, O_RDONLY, 0) = {}", bun_core::fmt::fmt_os_path(path), err);
            return Result::Err(err.err());
        }

        let is_regular_file = basic_info.FileAttributes != c::INVALID_FILE_ATTRIBUTES
            // from libuv: directories cannot be read-only
            // https://github.com/libuv/libuv/blob/eb5af8e3c0ea19a6b0196d5db3212dae1785739b/src/win/fs.c#L2144-L2146
            && (basic_info.FileAttributes & c::FILE_ATTRIBUTE_DIRECTORY == 0
                || basic_info.FileAttributes & c::FILE_ATTRIBUTE_READONLY == 0);

        let is_dir = basic_info.FileAttributes != c::INVALID_FILE_ATTRIBUTES
            && basic_info.FileAttributes & c::FILE_ATTRIBUTE_DIRECTORY != 0
            && basic_info.FileAttributes & c::FILE_ATTRIBUTE_READONLY == 0;

        return if is_dir {
            log!("NtQueryAttributesFile({}, O_RDONLY, 0) = directory", bun_core::fmt::fmt_os_path(path));
            Result::Ok(ExistsAtType::Directory)
        } else if is_regular_file {
            log!("NtQueryAttributesFile({}, O_RDONLY, 0) = file", bun_core::fmt::fmt_os_path(path));
            Result::Ok(ExistsAtType::File)
        } else {
            log!("NtQueryAttributesFile({}, O_RDONLY, 0) = {}", bun_core::fmt::fmt_os_path(path), basic_info.FileAttributes);
            Result::Err(Error::from_code(E::UNKNOWN, Tag::access))
        };
    }

    #[cfg(not(windows))]
    {
        let subpath = subpath.as_ref();
        // TODO(port): Zig recurses with NUL-terminated copy when sentinel is missing.
        let path_buf = bun_paths::path_buffer_pool().get();
        path_buf[0..subpath.len()].copy_from_slice(subpath);
        path_buf[subpath.len()] = 0;
        // SAFETY: NUL written above.
        let slice = unsafe { ZStr::from_raw(path_buf.as_ptr(), subpath.len()) };

        match fstatat(fd, slice) {
            Result::Err(err) => Result::Err(err),
            Result::Ok(result) => {
                if S::ISDIR(result.mode) {
                    Result::Ok(ExistsAtType::Directory)
                } else {
                    Result::Ok(ExistsAtType::File)
                }
            }
        }
    }
}

pub fn exists_at(fd: Fd, subpath: &ZStr) -> bool {
    #[cfg(unix)]
    {
        return match faccessat(fd, subpath.as_bytes()) {
            Result::Err(_) => false,
            Result::Ok(r) => r,
        };
    }

    #[cfg(windows)]
    {
        if let Some(exists_at_type) = exists_at_type(fd, subpath.as_bytes()).as_value() {
            return exists_at_type == ExistsAtType::File;
        }
        return false;
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn is_executable_file(path: *const c_char) -> bool;
}

pub fn is_executable_file_os_path(path: bun_paths::OSPathSliceZ<'_>) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        return unsafe { is_executable_file(path.as_ptr() as *const c_char) };
    }

    #[cfg(windows)]
    {
        // Rationale: `GetBinaryTypeW` does not work on .cmd files.
        // SaferiIsExecutableFileType works on .cmd files.
        // we pass false to include .exe files (see https://learn.microsoft.com/en-us/windows/win32/api/winsafer/nf-winsafer-saferiisexecutablefiletype)
        // SAFETY: FFI call with valid NUL-terminated wide path.
        return unsafe { windows::SaferiIsExecutableFileType(path.as_ptr(), w::FALSE) } != w::FALSE;
    }
}

pub fn is_executable_file_path(path: impl AsRef<[u8]>) -> bool {
    #[cfg(unix)]
    {
        let p = path.as_ref();
        // TODO(port): Zig dispatches on pointer/slice type via @TypeOf. We always
        // copy into a posix path here.
        let Ok(pz) = posix::to_posix_path(p) else { return false; };
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        return unsafe { is_executable_file(pz.as_ptr()) };
    }

    #[cfg(windows)]
    {
        let mut buf = [0u16; (MAX_PATH_BYTES / 2) + 1];
        return is_executable_file_os_path(strings::to_w_path(&mut buf, path.as_ref()));
    }
}

pub fn set_file_offset(fd: Fd, offset: usize) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        return Result::<()>::errno_sys_fd(
            // SAFETY: FFI call with valid fd.
            unsafe { syscall::lseek(fd.cast(), i64::try_from(offset).unwrap(), posix::SEEK_SET) },
            Tag::lseek,
            fd,
        )
        .unwrap_or(Result::Ok(()));
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        return Result::<()>::errno_sys_fd(
            // SAFETY: FFI call with valid fd.
            unsafe { libc::lseek(fd.cast(), i64::try_from(offset).unwrap(), posix::SEEK_SET) },
            Tag::lseek,
            fd,
        )
        .unwrap_or(Result::Ok(()));
    }

    #[cfg(windows)]
    {
        let offset_high: u64 = (offset >> 32) as u32 as u64;
        let offset_low: u64 = (offset & 0xFFFFFFFF) as u32 as u64;
        let mut plarge_integer: i64 = offset_high as i64;
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe {
            kernel32::SetFilePointerEx(
                fd.cast(),
                offset_low as windows::LARGE_INTEGER,
                &mut plarge_integer,
                windows::FILE_BEGIN,
            )
        };
        if rc == windows::FALSE {
            return Result::<()>::errno_sys_fd(0, Tag::lseek, fd).unwrap_or(Result::Ok(()));
        }
        return Result::Ok(());
    }
}

#[cfg(windows)]
pub fn set_file_offset_to_end_windows(fd: Fd) -> Result<usize> {
    let mut new_ptr: w::LARGE_INTEGER = 0;
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    let rc = unsafe { kernel32::SetFilePointerEx(fd.cast(), 0, &mut new_ptr, windows::FILE_END) };
    if rc == windows::FALSE {
        return Result::<usize>::errno_sys_fd(0, Tag::lseek, fd).unwrap_or(Result::Ok(0));
    }
    Result::Ok(new_ptr as usize)
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    #[cfg(windows)]
    fn Bun__disableSOLinger(fd: windows::HANDLE);
    #[cfg(not(windows))]
    fn Bun__disableSOLinger(fd: i32);
}
pub fn disable_linger(fd: Fd) {
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    unsafe { Bun__disableSOLinger(fd.cast()) };
}

pub fn pipe() -> Result<[Fd; 2]> {
    #[cfg(windows)]
    {
        let uv = windows::libuv;
        let mut fds: [uv::uv_file; 2] = [0; 2];
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        if let Some(e) = unsafe { uv::uv_pipe(fds.as_mut_ptr(), 0, 0) }.err_enum() {
            let err = Error::from_code(e, Tag::pipe);
            log!("pipe() = {}", err);
            return Result::Err(err);
        }
        let out = [Fd::from_uv(fds[0]), Fd::from_uv(fds[1])];
        log!("pipe() = [{}, {}]", out[0], out[1]);
        return Result::Ok(out);
    }

    #[cfg(not(windows))]
    {
        let mut fds: [i32; 2] = [0; 2];
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let rc = unsafe { syscall::pipe(fds.as_mut_ptr()) };
        if let Some(err) = Result::<[Fd; 2]>::errno_sys(rc, Tag::pipe) {
            log!("pipe() = {}", err);
            return err;
        }
        log!("pipe() = [{}, {}]", fds[0], fds[1]);
        Result::Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }
}

pub fn open_null_device() -> Result<Fd> {
    #[cfg(windows)]
    {
        return sys_uv::open(ZStr::from_bytes(b"nul"), 0, 0);
    }
    #[cfg(not(windows))]
    open(ZStr::from_bytes(b"/dev/null"), O::RDWR, 0)
}

pub fn dup_with_flags(fd: Fd, _flags: i32) -> Result<Fd> {
    #[cfg(windows)]
    {
        let mut target: windows::HANDLE = core::ptr::null_mut();
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let process = unsafe { kernel32::GetCurrentProcess() };
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let out = unsafe {
            kernel32::DuplicateHandle(
                process,
                fd.cast(),
                process,
                &mut target,
                0,
                w::TRUE,
                w::DUPLICATE_SAME_ACCESS,
            )
        };
        if out == 0 {
            if let Some(err) = Result::<Fd>::errno_sys_fd(0, Tag::dup, fd) {
                log!("dup({}) = {}", fd, err);
                return err;
            }
        }
        let duplicated_fd = Fd::from_native(target);
        log!("dup({}) = {}", fd, duplicated_fd);
        return Result::Ok(duplicated_fd);
    }

    #[cfg(not(windows))]
    {
        let out = match fcntl(fd, c::F_DUPFD_CLOEXEC, 0) {
            Result::Ok(result) => result,
            Result::Err(err) => {
                log!("dup({}) = {}", fd, err);
                return Result::Err(err);
            }
        };
        log!("dup({}) = {}", fd, Fd::from_native(out as _));
        Result::Ok(Fd::from_native(out as _))
    }
}

pub fn dup(fd: Fd) -> Result<Fd> {
    dup_with_flags(fd, 0)
}

// TODO(port): `link<T>(src, dest)` is generic over u8/u16; we expose two fns.
pub fn link(src: &ZStr, dest: &ZStr) -> Result<()> {
    #[cfg(windows)]
    {
        return sys_uv::link(src, dest);
    }

    #[cfg(not(windows))]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let ret = unsafe { libc::link(src.as_ptr() as *const c_char, dest.as_ptr() as *const c_char) };
        if let Some(err) = Result::<()>::errno_sys_pd(ret, Tag::link, src, dest) {
            log!("link({}, {}) = {}", bstr::BStr::new(src.as_bytes()), bstr::BStr::new(dest.as_bytes()), <&str>::from(err.get_errno()));
            return err;
        }
        log!("link({}, {}) = 0", bstr::BStr::new(src.as_bytes()), bstr::BStr::new(dest.as_bytes()));
        Result::Ok(())
    }
}

#[cfg(windows)]
pub fn link_w(src: &WStr, dest: &WStr) -> Result<()> {
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    if unsafe { windows::CreateHardLinkW(dest.as_ptr(), src.as_ptr(), core::ptr::null_mut()) } == 0 {
        return Result::<()>::errno(windows::get_last_errno(), Tag::link);
    }
    log!("CreateHardLinkW({}, {}) = 0", bun_core::fmt::fmt_path_u16(dest.as_slice()), bun_core::fmt::fmt_path_u16(src.as_slice()));
    Result::Ok(())
}

#[cfg(unix)]
pub fn linkat(src: Fd, src_path: &[u8], dest: Fd, dest_path: &[u8]) -> Result<()> {
    let sp = match posix::to_posix_path(src_path) {
        Ok(p) => p,
        Err(_) => return Result::Err(Error { errno: E::NOMEM as _, syscall: Tag::link, ..Default::default() }),
    };
    let dp = match posix::to_posix_path(dest_path) {
        Ok(p) => p,
        Err(_) => return Result::Err(Error { errno: E::NOMEM as _, syscall: Tag::link, ..Default::default() }),
    };
    linkat_z(src, &sp, dest, &dp)
}

#[cfg(unix)]
pub fn linkat_z(src: Fd, src_path: &ZStr, dest: Fd, dest_path: &ZStr) -> Result<()> {
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    let ret = unsafe { libc::linkat(src.cast(), src_path.as_ptr() as *const c_char, dest.cast(), dest_path.as_ptr() as *const c_char, 0) };
    if let Some(err) = Result::<()>::errno_sys_p(ret, Tag::link, src_path) {
        log!("linkat({}, {}, {}, {}) = {}", src, bstr::BStr::new(src_path.as_bytes()), dest, bstr::BStr::new(dest_path.as_bytes()), <&str>::from(err.get_errno()));
        return err;
    }
    log!("linkat({}, {}, {}, {}) = 0", src, bstr::BStr::new(src_path.as_bytes()), dest, bstr::BStr::new(dest_path.as_bytes()));
    Result::Ok(())
}

#[cfg(target_os = "linux")]
pub fn linkat_tmpfile(tmpfd: Fd, dirfd: Fd, name: &ZStr) -> Result<()> {
    static CAP_DAC_READ_SEARCH_STATUS: AtomicI32 = AtomicI32::new(0);

    loop {
        // This is racy but it's fine if we call linkat() with an empty path multiple times.
        let current_status = CAP_DAC_READ_SEARCH_STATUS.load(Ordering::Relaxed);

        let rc = if current_status != -1 {
            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe {
                syscall::linkat(
                    tmpfd.cast(),
                    b"\0".as_ptr() as *const c_char,
                    dirfd.cast(),
                    name.as_ptr() as *const c_char,
                    posix::AT_EMPTY_PATH,
                )
            }
        } else {
            //
            // snprintf(path, PATH_MAX,  "/proc/self/fd/%d", fd);
            // linkat(AT_FDCWD, path, AT_FDCWD, "/path/for/file",
            //        AT_SYMLINK_FOLLOW);
            //
            let mut procfs_buf = [0u8; "/proc/self/fd/-2147483648".len() + 1];
            use std::io::Write;
            let mut cursor = &mut procfs_buf[..];
            write!(cursor, "/proc/self/fd/{}\0", tmpfd.cast()).expect("unreachable");
            let path = procfs_buf.as_ptr() as *const c_char;

            // SAFETY: FFI call; arguments are valid for the duration of the call.
            unsafe {
                syscall::linkat(
                    posix::AT_FDCWD,
                    path,
                    dirfd.cast(),
                    name.as_ptr() as *const c_char,
                    posix::AT_SYMLINK_FOLLOW,
                )
            }
        };

        if let Some(err) = Result::<()>::errno_sys_fd(rc, Tag::link, tmpfd) {
            match err.get_errno() {
                E::INTR => continue,
                E::ISDIR | E::NOENT | E::OPNOTSUPP | E::PERM | E::INVAL => {
                    // CAP_DAC_READ_SEARCH is required to linkat with an empty path.
                    if current_status == 0 {
                        CAP_DAC_READ_SEARCH_STATUS.store(-1, Ordering::Relaxed);
                        continue;
                    }
                }
                _ => {}
            }
            return err;
        }

        if current_status == 0 {
            CAP_DAC_READ_SEARCH_STATUS.store(1, Ordering::Relaxed);
        }

        return Result::Ok(());
    }
}

/// c-bindings.cpp
// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn sys_preadv2(
        fd: c_int,
        iov: *const posix::iovec,
        iovcnt: c_int,
        offset: posix::off_t,
        flags: c_uint,
    ) -> isize;
}

/// On Linux, this `preadv2(2)` to attempt to read a blocking file descriptor without blocking.
///
/// On other platforms, this is just a wrapper around `read(2)`.
pub fn read_nonblocking(fd: Fd, buf: &mut [u8]) -> Result<usize> {
    #[cfg(target_os = "linux")]
    {
        while bun_sys::linux::RWFFlagSupport::is_maybe_supported() {
            let iovec = [posix::iovec { base: buf.as_mut_ptr(), len: buf.len() }];
            let debug_timer = bun_core::Output::DebugTimer::start();

            // Note that there is a bug on Linux Kernel 5
            // SAFETY: FFI call with valid fd and single-element iovec on the stack.
            let rc = unsafe { sys_preadv2(fd.native(), iovec.as_ptr(), 1, -1, syscall::RWF_NOWAIT) };

            if cfg!(debug_assertions) {
                log!("preadv2({}, {}) = {} ({})", fd, buf.len(), rc, debug_timer);
                if debug_timer.read_ns() > 1_000_000 {
                    bun_core::Output::debug_warn!("preadv2({}, {}) blocked for {}", fd, buf.len(), debug_timer);
                }
            }

            if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::read, fd) {
                match err.get_errno() {
                    E::OPNOTSUPP | E::NOSYS | E::PERM | E::ACCES => {
                        bun_sys::linux::RWFFlagSupport::disable();
                        match bun_core::is_readable(fd) {
                            bun_core::Pollable::Hup | bun_core::Pollable::Ready => return read(fd, buf),
                            _ => return Result::Err(Error::retry()),
                        }
                    }
                    E::INTR => continue,
                    _ => return err,
                }
            }

            return Result::Ok(usize::try_from(rc).unwrap());
        }
    }

    read(fd, buf)
}

/// c-bindings.cpp
// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn sys_pwritev2(
        fd: c_int,
        iov: *const posix::iovec_const,
        iovcnt: c_int,
        offset: posix::off_t,
        flags: c_uint,
    ) -> isize;
}

/// On Linux, this `pwritev(2)` to attempt to read a blocking file descriptor without blocking.
///
/// On other platforms, this is just a wrapper around `read(2)`.
pub fn write_nonblocking(fd: Fd, buf: &[u8]) -> Result<usize> {
    #[cfg(target_os = "linux")]
    {
        while bun_sys::linux::RWFFlagSupport::is_maybe_supported() {
            let iovec = [posix::iovec_const { base: buf.as_ptr(), len: buf.len() }];
            let debug_timer = bun_core::Output::DebugTimer::start();

            // SAFETY: FFI call; arguments are valid for the duration of the call.
            let rc = unsafe { sys_pwritev2(fd.native(), iovec.as_ptr(), 1, -1, syscall::RWF_NOWAIT) };

            if cfg!(debug_assertions) {
                log!("pwritev2({}, {}) = {} ({})", fd, buf.len(), rc, debug_timer);
                if debug_timer.read_ns() > 1_000_000 {
                    bun_core::Output::debug_warn!("pwritev2({}, {}) blocked for {}", fd, buf.len(), debug_timer);
                }
            }

            if let Some(err) = Result::<usize>::errno_sys_fd(rc, Tag::write, fd) {
                match err.get_errno() {
                    E::OPNOTSUPP | E::NOSYS | E::PERM | E::ACCES => {
                        bun_sys::linux::RWFFlagSupport::disable();
                        match bun_core::is_writable(fd) {
                            bun_core::Pollable::Hup | bun_core::Pollable::Ready => return write(fd, buf),
                            _ => return Result::Err(Error::retry()),
                        }
                    }
                    E::INTR => continue,
                    _ => return err,
                }
            }

            return Result::Ok(usize::try_from(rc).unwrap());
        }
    }

    write(fd, buf)
}

pub fn get_file_size(fd: Fd) -> Result<usize> {
    #[cfg(windows)]
    {
        let mut size: windows::LARGE_INTEGER = 0;
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        if unsafe { kernel32::GetFileSizeEx(fd.cast(), &mut size) } == windows::FALSE {
            let err = Error::from_code(windows::get_last_errno(), Tag::fstat);
            log!("GetFileSizeEx({}) = {}", fd, err.name());
            return Result::Err(err);
        }
        log!("GetFileSizeEx({}) = {}", fd, size);
        return Result::Ok(size.max(0) as usize);
    }

    #[cfg(not(windows))]
    match fstat(fd) {
        Result::Ok(stat_) => Result::Ok(stat_.size.max(0) as usize),
        Result::Err(err) => Result::Err(err),
    }
}

pub fn is_pollable(mode: Mode) -> bool {
    #[cfg(windows)]
    { let _ = mode; return false; }
    #[cfg(not(windows))]
    { posix::S_ISFIFO(mode) || posix::S_ISSOCK(mode) }
}

pub use crate::dir as Dir;
#[cfg(windows)]
const FILE_SHARE: u32 = w::FILE_SHARE_WRITE | w::FILE_SHARE_READ | w::FILE_SHARE_DELETE;

pub use crate::libuv_error_map::libuv_error_map;
pub use crate::coreutils_error_map::coreutils_error_map;

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn getRSS(rss: *mut usize) -> c_int;
}
pub fn self_process_memory_usage() -> Option<usize> {
    let mut rss: usize = 0;
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    if unsafe { getRSS(&mut rss) } != 0 {
        return None;
    }
    Some(rss)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__errnoName(err: c_int) -> *const c_char {
    match SystemErrno::init(err) {
        Some(e) => <&'static str>::from(e).as_ptr() as *const c_char,
        None => core::ptr::null(),
    }
}

/// Small "fire and forget" wrapper around unlink for c usage that handles EINTR, windows path conversion, etc.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__unlink(ptr: *const u8, len: usize) {
    // SAFETY: caller guarantees ptr[0..len] is valid and NUL-terminated at ptr[len].
    let _ = unlink(unsafe { ZStr::from_raw(ptr, len) });
}

// TODO: this is wrong on Windows

#[cfg(unix)]
pub fn lstat_absolute(path: &ZStr) -> core::result::Result<FileStat, bun_core::Error> {
    // TODO(port): narrow error set
    // SAFETY: all-zero is a valid Stat.
    let mut st = unsafe { mem::zeroed::<bun_core::Stat>() };
    // SAFETY: FFI call; arguments are valid for the duration of the call.
    match unsafe { posix::errno(workaround_symbols::lstat(path.as_ptr(), &mut st)) } {
        E::SUCCESS => {}
        E::NOENT => return Err(bun_core::err!("FileNotFound")),
        E::BADF => unreachable!(), // Always a race condition.
        E::NOMEM => return Err(bun_core::err!("SystemResources")),
        E::ACCES => return Err(bun_core::err!("AccessDenied")),
        err => return Err(posix::unexpected_errno(err)),
    }

    let atime = st.atime();
    let mtime = st.mtime();
    let ctime = st.ctime();
    Ok(FileStat {
        inode: st.ino,
        size: st.size as u64,
        mode: st.mode,
        kind: match st.mode & posix::S_IFMT {
            posix::S_IFBLK => FileKind::BlockDevice,
            posix::S_IFCHR => FileKind::CharacterDevice,
            posix::S_IFDIR => FileKind::Directory,
            posix::S_IFIFO => FileKind::NamedPipe,
            posix::S_IFLNK => FileKind::SymLink,
            posix::S_IFREG => FileKind::File,
            posix::S_IFSOCK => FileKind::UnixDomainSocket,
            _ => FileKind::Unknown,
        },
        atime: (atime.sec as i128) * 1_000_000_000 + atime.nsec as i128,
        mtime: (mtime.sec as i128) * 1_000_000_000 + mtime.nsec as i128,
        ctime: (ctime.sec as i128) * 1_000_000_000 + ctime.nsec as i128,
    })
}

// renameatZ fails when renaming across mount points
// we assume that this is relatively uncommon
pub fn move_file_z(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> core::result::Result<(), bun_core::Error> {
    match renameat_concurrently_without_fallback(from_dir, filename, to_dir, destination) {
        Result::Err(err) => {
            // allow over-writing an empty directory
            if err.get_errno() == E::ISDIR {
                let _ = rmdirat(to_dir, destination.as_bytes());
                renameat(from_dir, filename, to_dir, destination).unwrap()?;
                return Ok(());
            }

            if err.get_errno() == E::XDEV {
                move_file_z_slow(from_dir, filename, to_dir, destination)?;
            } else {
                return Err(bun_core::errno_to_zig_err(err.errno));
            }
        }
        Result::Ok(()) => {}
    }
    Ok(())
}

pub fn move_file_z_with_handle(from_handle: Fd, from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> core::result::Result<(), bun_core::Error> {
    match renameat(from_dir, filename, to_dir, destination) {
        Result::Err(err) => {
            // allow over-writing an empty directory
            if err.get_errno() == E::ISDIR {
                let _ = rmdirat(to_dir, destination.as_bytes());
                renameat(from_dir, filename, to_dir, destination).unwrap()?;
                return Ok(());
            }

            if err.get_errno() == E::XDEV {
                copy_file_z_slow_with_handle(from_handle, to_dir, destination).unwrap()?;
                let _ = unlinkat(from_dir, filename.as_bytes());
                return Ok(());
            }

            return Err(bun_core::errno_to_zig_err(err.errno));
        }
        Result::Ok(()) => {}
    }
    Ok(())
}

// On Linux, this will be fast because sendfile() supports copying between two file descriptors on disk
// macOS & BSDs will be slow because
pub fn move_file_z_slow(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> core::result::Result<(), bun_core::Error> {
    move_file_z_slow_maybe(from_dir, filename, to_dir, destination).unwrap()
}

pub fn move_file_z_slow_maybe(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> Result<()> {
    let in_handle = match openat(from_dir, filename, O::RDONLY | O::CLOEXEC, if cfg!(windows) { 0 } else { 0o644 }) {
        Result::Ok(f) => f,
        Result::Err(e) => return Result::Err(e),
    };
    let _close = scopeguard::guard((), |_| in_handle.close());
    let _ = from_dir.unlinkat(filename);
    copy_file_z_slow_with_handle(in_handle, to_dir, destination)
}

pub fn copy_file_z_slow_with_handle(in_handle: Fd, to_dir: Fd, destination: &ZStr) -> Result<()> {
    #[cfg(windows)]
    {
        let mut buf0 = WPathBuffer::uninit();
        let mut buf1 = WPathBuffer::uninit();

        let dest = match normalize_path_windows::<u8>(to_dir, destination.as_bytes(), &mut buf0, true) {
            Result::Ok(x) => x,
            Result::Err(e) => return Result::Err(e),
        };
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let src_len = unsafe { windows::GetFinalPathNameByHandleW(in_handle.cast(), buf1.as_mut_ptr(), buf1.len() as u32, 0) };
        if src_len == 0 {
            return Result::<()>::errno(E::BUSY, Tag::GetFinalPathNameByHandle);
        } else if src_len as usize >= buf1.len() {
            return Result::<()>::errno(E::NAMETOOLONG, Tag::GetFinalPathNameByHandle);
        }
        // SAFETY: GetFinalPathNameByHandleW NUL-terminates.
        let src = unsafe { WStr::from_raw(buf1.as_ptr(), src_len as usize) };
        return bun_core::copy_file(src, dest);
    }
    #[cfg(not(windows))]
    {
        let stat_ = match fstat(in_handle) {
            Result::Ok(s) => s,
            Result::Err(e) => return Result::Err(e),
        };

        // Attempt to delete incase it already existed.
        // This fixes ETXTBUSY on Linux
        let _ = unlinkat(to_dir, destination.as_bytes());

        let out_handle = match openat(
            to_dir,
            destination,
            O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC,
            0o644,
        ) {
            Result::Ok(fd) => fd,
            Result::Err(e) => return Result::Err(e),
        };
        let _close = scopeguard::guard((), |_| out_handle.close());

        #[cfg(target_os = "linux")]
        {
            // SAFETY: FFI call with valid fd; mode/offset/len are plain integers.
            let _ = unsafe { syscall::fallocate(out_handle.cast(), 0, 0, i64::try_from(stat_.size).unwrap()) };
        }

        // Seek input to beginning -- the caller may have written to this fd,
        // leaving the file offset at EOF. copy_file_range / sendfile / read
        // all use the current offset when called with null offsets.
        // Ignore errors: the fd may be non-seekable (e.g. a pipe).
        let _ = set_file_offset(in_handle, 0);

        if let Result::Err(e) = bun_core::copy_file(in_handle, out_handle) {
            return Result::Err(e);
        }

        // SAFETY: FFI calls with valid live fd; mode/uid/gid copied from a successful fstat.
        unsafe {
            let _ = c::fchmod(out_handle.cast(), stat_.mode);
            let _ = c::fchown(out_handle.cast(), stat_.uid, stat_.gid);
        }

        Result::Ok(())
    }
}

pub fn kind_from_mode(mode: Mode) -> FileKind {
    match mode & S::IFMT {
        S::IFBLK => FileKind::BlockDevice,
        S::IFCHR => FileKind::CharacterDevice,
        S::IFDIR => FileKind::Directory,
        S::IFIFO => FileKind::NamedPipe,
        S::IFLNK => FileKind::SymLink,
        S::IFREG => FileKind::File,
        S::IFSOCK => FileKind::UnixDomainSocket,
        _ => FileKind::Unknown,
    }
}

pub fn get_self_exe_shared_lib_paths() -> core::result::Result<Vec<Box<ZStr>>, bun_alloc::AllocError> {
    // TODO(port): allocator param dropped (global mimalloc).
    // Zig returns `[][:0]u8` (NUL-terminated owned slices via `allocator.dupeZ`).
    #[cfg(any(target_os = "linux", target_os = "freebsd", target_os = "netbsd", target_os = "dragonfly", target_os = "openbsd", target_os = "solaris"))]
    {
        let mut paths: Vec<Box<ZStr>> = Vec::new();
        // TODO(port): posix.dl_iterate_phdr callback -> use libc::dl_iterate_phdr with closure trampoline.
        // SAFETY: callback is only invoked from dl_iterate_phdr below with `data` pointing
        // at our local `paths` Vec; `info` is a valid dl_phdr_info for the duration of the call.
        unsafe extern "C" fn callback(info: *mut posix::dl_phdr_info, _size: usize, data: *mut c_void) -> c_int {
            let list = &mut *(data as *mut Vec<Box<ZStr>>);
            let name = (*info).dlpi_name;
            if name.is_null() { return 0; }
            if *name == b'/' as c_char {
                let s = core::ffi::CStr::from_ptr(name).to_bytes();
                list.push(ZStr::from_bytes(s));
            }
            0
        }
        // SAFETY: callback signature matches dl_iterate_phdr's contract; `data` outlives the call.
        unsafe { posix::dl_iterate_phdr(Some(callback), (&mut paths) as *mut _ as *mut c_void) };
        return Ok(paths);
    }
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "watchos", target_os = "tvos"))]
    {
        let mut paths: Vec<Box<ZStr>> = Vec::new();
        // SAFETY: libc FFI call with no arguments.
        let img_count = unsafe { libc::_dyld_image_count() };
        for i in 0..img_count {
            // SAFETY: i < img_count; returns a valid NUL-terminated C string.
            let name = unsafe { libc::_dyld_get_image_name(i) };
            // SAFETY: _dyld_get_image_name returns a valid NUL-terminated C string.
            let s = unsafe { core::ffi::CStr::from_ptr(name) }.to_bytes();
            paths.push(ZStr::from_bytes(s));
        }
        return Ok(paths);
    }
    #[cfg(not(any(unix, target_os = "haiku")))]
    compile_error!("getSelfExeSharedLibPaths unimplemented for this target");
}

#[cfg(target_os = "linux")]
pub const PREALLOCATE_LENGTH: usize = 2048 * 1024;
#[cfg(target_os = "linux")]
pub const PREALLOCATE_SUPPORTED: bool = true;
#[cfg(not(target_os = "linux"))]
pub const PREALLOCATE_SUPPORTED: bool = false;

// (Benchmarks for fallocate from the Zig source omitted; see git history.)

pub fn preallocate_file(fd: posix::fd_t, offset: posix::off_t, len: posix::off_t) -> core::result::Result<(), bun_core::Error> {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let _ = unsafe { syscall::fallocate(fd, 0, offset as i64, len) };
    }
    #[cfg(target_os = "macos")]
    {
        // benchmarking this did nothing on macOS
        // i verified it wasn't returning -1
        let _ = (fd, offset, len);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (fd, offset, len);
    }
    Ok(())
}

pub fn dlopen(filename: &ZStr, flags: c_int) -> Option<*mut c_void> {
    #[cfg(windows)]
    {
        let _ = flags;
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        return Option::from(unsafe { windows::LoadLibraryA(filename.as_ptr() as *const c_char) });
    }
    #[cfg(not(windows))]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let p = unsafe { libc::dlopen(filename.as_ptr() as *const c_char, flags) };
        if p.is_null() { None } else { Some(p) }
    }
}

pub fn dlsym_impl(handle: Option<*mut c_void>, name: &ZStr) -> Option<*mut c_void> {
    #[cfg(windows)]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        return Option::from(unsafe { windows::GetProcAddressA(handle.unwrap_or(core::ptr::null_mut()), name.as_ptr() as *const c_char) });
    }
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "freebsd"))]
    {
        // SAFETY: FFI call; arguments are valid for the duration of the call.
        let p = unsafe { libc::dlsym(handle.unwrap_or(core::ptr::null_mut()), name.as_ptr() as *const c_char) };
        if p.is_null() { None } else { Some(p) }
    }
}

// TODO(port): dlsymWithHandle<T, name, handle_getter> uses a per-monomorphization
// `static once` + `static function: T` cache. Rust cannot have a generic `static`.
// Phase B: implement as a macro `dlsym_with_handle!(Type, "name", handle_getter)`
// that expands to a OnceLock<Option<Type>> per call site.
#[macro_export]
macro_rules! dlsym_with_handle {
    ($ty:ty, $name:literal, $handle_getter:expr) => {{
        static ONCE: ::std::sync::OnceLock<Option<$ty>> = ::std::sync::OnceLock::new();
        *ONCE.get_or_init(|| {
            let h = ($handle_getter)();
            $crate::dlsym_impl(h, $crate::bun_str::ZStr::from_bytes($name.as_bytes()))
                // SAFETY: caller asserts symbol has signature `$ty`.
                .map(|p| unsafe { ::core::mem::transmute::<*mut ::core::ffi::c_void, $ty>(p) })
        })
    }};
}

#[cfg(not(windows))]
pub use c::umask;
// Using the same typedef and define for `mode_t` and `umask` as node on windows.
// https://github.com/nodejs/node/blob/ad5e2dab4c8306183685973387829c2f69e793da/src/node_process_methods.cc#L29
#[cfg(windows)]
unsafe extern "C" {
    #[link_name = "_umask"]
    pub fn umask(mode: u16) -> u16;
}

// TODO(port): move to *_jsc
// pub use bun_sys_jsc::error_jsc::TestingAPIs;

pub use crate::file as File;

// ══════════════════════════════════════════════════════════════════════════
// MOVE-IN PASS (CYCLEBREAK.md §→sys + /tmp/movein-skipped.txt)
//
// Symbols below were forward-referenced by lower/peer-tier crates after the
// move-out pass rewrote their imports to point at `bun_sys::*`. Ground truth
// is the source `.zig`; JSC-touching surface is stripped (lives in *_jsc).
// ══════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────────────────
// `node` module — MOVE_DOWN bun_runtime::node → sys (TYPE_ONLY subset)
// Consumers: sys::Result<T>, patch, install, bundler.
// ──────────────────────────────────────────────────────────────────────────
pub mod node {
    use super::{Error, Fd, Tag, E};

    /// `bun.api.node.uid_t` — POSIX `uid_t` / libuv `uv_uid_t` on Windows.
    #[cfg(not(windows))]
    pub type uid_t = libc::uid_t;
    #[cfg(windows)]
    pub type uid_t = i32; // bun.windows.libuv.uv_uid_t == c_int

    /// `bun.api.node.gid_t` — POSIX `gid_t` / libuv `uv_gid_t` on Windows.
    #[cfg(not(windows))]
    pub type gid_t = libc::gid_t;
    #[cfg(windows)]
    pub type gid_t = i32; // bun.windows.libuv.uv_gid_t == c_int

    /// `bun.api.node.TimeLike` — `timespec` on POSIX, `f64` seconds on Windows.
    #[cfg(not(windows))]
    pub type TimeLike = libc::timespec;
    #[cfg(windows)]
    pub type TimeLike = f64;

    /// `bun.api.node.Maybe<R, E>` — tagged result mirroring Zig's `union(Tag){err,result}`.
    ///
    /// Kept as a distinct enum (not `core::result::Result`) so the `errno_sys*`
    /// associated helpers and `.err`/`.result` field-style usage port 1:1.
    #[must_use]
    #[derive(Debug)]
    pub enum Maybe<R, E = Error> {
        Err(E),
        Ok(R),
    }

    impl<R, E> Maybe<R, E> {
        #[inline]
        pub fn init_err(e: E) -> Self { Maybe::Err(e) }
        #[inline]
        pub fn init_result(r: R) -> Self { Maybe::Ok(r) }

        #[inline]
        pub fn as_err(&self) -> Option<&E> {
            match self { Maybe::Err(e) => Some(e), Maybe::Ok(_) => None }
        }
        #[inline]
        pub fn as_value(self) -> Option<R> {
            match self { Maybe::Ok(r) => Some(r), Maybe::Err(_) => None }
        }
        #[inline]
        pub fn unwrap_or(self, default_value: R) -> R {
            match self { Maybe::Ok(r) => r, Maybe::Err(_) => default_value }
        }
        #[inline]
        pub fn is_ok(&self) -> bool { matches!(self, Maybe::Ok(_)) }
        #[inline]
        pub fn is_err(&self) -> bool { matches!(self, Maybe::Err(_)) }
    }

    impl<R: Default, E> Maybe<R, E> {
        #[inline]
        pub fn success() -> Self { Maybe::Ok(R::default()) }
    }

    impl<R> Maybe<R, Error> {
        #[inline]
        pub fn retry() -> Self { Maybe::Err(Error::retry()) }

        /// Zig `Maybe(T).aborted` — placeholder err for an aborted `AbortSignal`.
        #[inline]
        pub fn aborted() -> Self {
            Maybe::Err(Error { errno: E::INTR as _, syscall: Tag::access, ..Error::default() })
        }

        /// Zig `Maybe(T).errnoSys(rc, syscall)`: `Some(Err)` if `rc` indicates
        /// failure (errno set), else `None` so the caller proceeds with `rc`.
        #[inline]
        pub fn errno_sys(rc: impl Into<i64>, syscall: Tag) -> Option<Self> {
            let rc: i64 = rc.into();
            if rc != -1 { return None; }
            Some(Maybe::Err(Error {
                errno: super::get_errno() as _,
                syscall,
                ..Error::default()
            }))
        }

        /// `errnoSys` variant that records the fd on the error.
        #[inline]
        pub fn errno_sys_fd(rc: impl Into<i64>, syscall: Tag, fd: Fd) -> Option<Self> {
            let rc: i64 = rc.into();
            if rc != -1 { return None; }
            Some(Maybe::Err(Error {
                errno: super::get_errno() as _,
                syscall,
                fd,
                ..Error::default()
            }))
        }

        /// `errnoSys` variant that records a path slice on the error.
        #[inline]
        pub fn errno_sys_p(rc: impl Into<i64>, syscall: Tag, path: &[u8]) -> Option<Self> {
            let rc: i64 = rc.into();
            if rc != -1 { return None; }
            Some(Maybe::Err(
                Error { errno: super::get_errno() as _, syscall, ..Error::default() }
                    .with_path(path),
            ))
        }

        #[inline]
        pub fn get_errno(&self) -> E {
            match self {
                Maybe::Err(e) => e.get_errno(),
                Maybe::Ok(_) => E::SUCCESS,
            }
        }

        #[inline]
        pub fn unwrap(self) -> R {
            match self {
                Maybe::Ok(r) => r,
                Maybe::Err(e) => panic!("called `Maybe::unwrap()` on an `Err` value: {:?}", e),
            }
        }
    }

    impl<R, E> From<Maybe<R, E>> for core::result::Result<R, E> {
        #[inline]
        fn from(m: Maybe<R, E>) -> Self {
            match m { Maybe::Ok(r) => Ok(r), Maybe::Err(e) => Err(e) }
        }
    }

    /// `bun.api.node.FileSystemFlags` — fopen-style mode strings mapped to `O_*`
    /// bitmasks. The string→flag table (`"r+"`, `"wx"`, …) is preserved for
    /// `from_bytes`; the JSC `fromJS` entrypoint stays in `bun_runtime`.
    #[repr(transparent)]
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct FileSystemFlags(pub core::ffi::c_int);

    impl FileSystemFlags {
        pub const A: Self = Self(super::O::APPEND | super::O::WRONLY | super::O::CREAT);
        pub const R: Self = Self(super::O::RDONLY);
        pub const W: Self = Self(super::O::WRONLY | super::O::CREAT);

        #[inline]
        pub fn as_int(self) -> core::ffi::c_int { self.0 }

        /// Map an ASCII flag string (e.g. `b"rs+"`) to its `O_*` mask.
        pub fn from_bytes(s: &[u8]) -> Option<i32> {
            use super::O;
            // Mirrors the `bun.ComptimeStringMap` table in
            // src/runtime/node/types.zig (case-folded — Zig listed both cases).
            let lower = match s.len() {
                1 | 2 | 3 => {
                    let mut buf = [0u8; 3];
                    for (i, &b) in s.iter().enumerate() { buf[i] = b.to_ascii_lowercase(); }
                    buf
                }
                _ => return None,
            };
            Some(match &lower[..s.len()] {
                b"r" => O::RDONLY,
                b"rs" | b"sr" => O::RDONLY | O::SYNC,
                b"r+" => O::RDWR,
                b"rs+" | b"sr+" => O::RDWR | O::SYNC,
                b"w" => O::TRUNC | O::CREAT | O::WRONLY,
                b"wx" | b"xw" => O::TRUNC | O::CREAT | O::WRONLY | O::EXCL,
                b"w+" => O::TRUNC | O::CREAT | O::RDWR,
                b"wx+" | b"xw+" => O::TRUNC | O::CREAT | O::RDWR | O::EXCL,
                b"a" => O::APPEND | O::CREAT | O::WRONLY,
                b"ax" | b"xa" => O::APPEND | O::CREAT | O::WRONLY | O::EXCL,
                b"as" | b"sa" => O::APPEND | O::CREAT | O::WRONLY | O::SYNC,
                b"a+" => O::APPEND | O::CREAT | O::RDWR,
                b"ax+" | b"xa+" => O::APPEND | O::CREAT | O::RDWR | O::EXCL,
                b"as+" | b"sa+" => O::APPEND | O::CREAT | O::RDWR | O::SYNC,
                _ => return None,
            })
        }
    }

    /// `bun.api.node.PathOrFileDescriptor` — TYPE_ONLY (JSC `fromJS` stays in
    /// `bun_runtime`). The `path` arm stores an owned UTF-8 byte buffer in this
    /// tier; higher tiers wrap it back into `PathLike` where JS ownership matters.
    #[derive(Debug)]
    pub enum PathOrFileDescriptor {
        Fd(Fd),
        Path(Box<[u8]>),
    }

    impl PathOrFileDescriptor {
        /// This will drop the path string if it is `Path`.
        /// Does nothing for file descriptors, **does not** close file descriptors.
        #[inline]
        pub fn deinit(self) { drop(self) }

        #[inline]
        pub fn estimated_size(&self) -> usize {
            match self { Self::Path(p) => p.len(), Self::Fd(_) => 0 }
        }

        pub fn hash(&self) -> u64 {
            match self {
                Self::Path(p) => bun_core::hash(p),
                Self::Fd(fd) => bun_core::hash(bytemuck::bytes_of(fd)),
            }
        }
    }

    impl core::fmt::Display for PathOrFileDescriptor {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            match self {
                Self::Path(p) => f.write_str(&String::from_utf8_lossy(p)),
                Self::Fd(fd) => write!(f, "{}", fd),
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `SystemError` — TYPE_ONLY MOVE_DOWN from `bun_jsc::SystemError`.
// JSC conversion (`toErrorInstance*`) stays in `bun_jsc`; this struct is the
// `extern` payload that `Error::to_system_error()` produces.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone)]
pub struct SystemError {
    pub errno: c_int,
    /// label for errno
    pub code: bun_str::String,
    /// it is illegal to have an empty message
    pub message: bun_str::String,
    pub path: bun_str::String,
    pub syscall: bun_str::String,
    pub hostname: bun_str::String,
    /// `c_int::MIN` = no file descriptor
    pub fd: c_int,
    pub dest: bun_str::String,
}

impl Default for SystemError {
    fn default() -> Self {
        Self {
            errno: 0,
            code: bun_str::String::empty(),
            message: bun_str::String::empty(),
            path: bun_str::String::empty(),
            syscall: bun_str::String::empty(),
            hostname: bun_str::String::empty(),
            fd: c_int::MIN,
            dest: bun_str::String::empty(),
        }
    }
}

impl SystemError {
    /// The inverse in `bun.sys.Error.toSystemError()`.
    #[inline]
    pub fn get_errno(&self) -> E {
        // SAFETY: errno is stored negated; -errno is a valid `E` discriminant.
        unsafe { core::mem::transmute::<i32, E>(self.errno * -1) }
    }

    pub fn deref(&self) {
        self.path.deref();
        self.code.deref();
        self.message.deref();
        self.syscall.deref();
        self.hostname.deref();
        self.dest.deref();
    }

    pub fn ref_(&self) {
        self.path.ref_();
        self.code.ref_();
        self.message.ref_();
        self.syscall.ref_();
        self.hostname.ref_();
        self.dest.ref_();
    }
}

impl core::fmt::Display for SystemError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if !self.code.is_empty() {
            write!(f, "{}: {} ({})", self.code, self.message, self.syscall)
        } else {
            write!(f, "{} ({})", self.message, self.syscall)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `generate_header` — MOVE_DOWN from `bun_analytics::GenerateHeader`.
// Only the `GeneratePlatform` kernel-probe surface is needed here (used by
// `copy_file.rs` for `kernelVersion()` gating and by udp `sendmsg_x` checks).
// The `analytics::Platform` reporting payload stays in `bun_analytics`.
// ──────────────────────────────────────────────────────────────────────────
pub mod generate_header {
    pub use self::generate_platform as GeneratePlatform;

    pub mod generate_platform {
        use std::sync::OnceLock;

        #[cfg(target_os = "linux")]
        pub static LINUX_OS_NAME: OnceLock<libc::utsname> = OnceLock::new();

        static LINUX_KERNEL_VERSION: OnceLock<bun_semver::Version> = OnceLock::new();

        #[cfg(target_os = "linux")]
        fn compute_kernel_version() -> bun_semver::Version {
            let uts = LINUX_OS_NAME.get_or_init(|| {
                // SAFETY: `uname(2)` fills the struct on success; zero-init beforehand
                // so a (theoretical) failure leaves a valid all-zero utsname.
                let mut name: libc::utsname = unsafe { core::mem::zeroed() };
                unsafe { libc::uname(&mut name) };
                name
            });
            // Confusingly, the "release" tends to contain the kernel version much
            // more frequently than the "version" field.
            // SAFETY: utsname.release is a NUL-terminated C buffer.
            let release = unsafe {
                core::ffi::CStr::from_ptr(uts.release.as_ptr())
            }.to_bytes();
            let sliced = bun_semver::SlicedString::init(release, release);
            bun_semver::Version::parse(sliced).version.min()
        }

        /// Linux kernel version (parsed from `uname -r`). Panics on non-Linux to
        /// match the Zig `@compileError` — callers are `cfg(linux)`-guarded.
        pub fn kernel_version() -> bun_semver::Version {
            #[cfg(target_os = "linux")]
            { *LINUX_KERNEL_VERSION.get_or_init(compute_kernel_version) }
            #[cfg(not(target_os = "linux"))]
            { unreachable!("kernel_version() is only implemented on Linux") }
        }

        // On macOS 13, tests that use sendmsg_x or recvmsg_x hang.
        static USE_MSGX_ON_MACOS_14_OR_LATER: OnceLock<bool> = OnceLock::new();

        #[unsafe(no_mangle)]
        pub extern "C" fn Bun__doesMacOSVersionSupportSendRecvMsgX() -> i32 {
            #[cfg(not(target_os = "macos"))]
            { return 0; } // this should not be used on non-mac platforms.
            #[cfg(target_os = "macos")]
            {
                *USE_MSGX_ON_MACOS_14_OR_LATER.get_or_init(|| {
                    let mut buf = [0u8; 32];
                    let mut len = buf.len() - 1;
                    // SAFETY: FFI call; buf/len are valid for the duration.
                    let rc = unsafe {
                        libc::sysctlbyname(
                            c"kern.osproductversion".as_ptr(),
                            buf.as_mut_ptr().cast(),
                            &mut len,
                            core::ptr::null_mut(),
                            0,
                        )
                    };
                    if rc == -1 { return false; }
                    let version = bun_semver::Version::parse_utf8(&buf[..len]);
                    version.valid && version.version.max().major >= 14
                }) as i32
            }
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn Bun__isEpollPwait2SupportedOnLinuxKernel() -> i32 {
            #[cfg(not(target_os = "linux"))]
            { return 0; }
            #[cfg(target_os = "linux")]
            {
                // https://man.archlinux.org/man/epoll_pwait2.2.en#HISTORY
                let min = bun_semver::Version { major: 5, minor: 11, patch: 0, ..Default::default() };
                match kernel_version().order(&min, b"", b"") {
                    core::cmp::Ordering::Greater | core::cmp::Ordering::Equal => 1,
                    core::cmp::Ordering::Less => 0,
                }
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `os` — MOVE_DOWN `bun_runtime::node::os::{totalmem,freemem}` → sys.
// Pure syscall surface; the JSC bindings stay in runtime.
// ──────────────────────────────────────────────────────────────────────────
pub mod os {
    /// Free physical memory in bytes (Node `os.freemem()`).
    /// Backed by `Bun__Os__getFreeMemory` in OsBinding.cpp.
    #[inline]
    pub fn freemem() -> u64 {
        unsafe extern "C" { fn Bun__Os__getFreeMemory() -> u64; }
        // SAFETY: FFI call with no arguments.
        unsafe { Bun__Os__getFreeMemory() }
    }

    /// Total physical memory in bytes (Node `os.totalmem()`).
    pub fn totalmem() -> u64 {
        #[cfg(target_os = "macos")]
        {
            let mut memory: [libc::c_ulonglong; 32] = [0; 32];
            let mut size: usize = core::mem::size_of_val(&memory);
            // SAFETY: FFI call; out-params are valid for the duration.
            let rc = unsafe {
                libc::sysctlbyname(
                    c"hw.memsize".as_ptr(),
                    memory.as_mut_ptr().cast(),
                    &mut size,
                    core::ptr::null_mut(),
                    0,
                )
            };
            if rc != 0 { return 0; }
            memory[0]
        }
        #[cfg(target_os = "linux")]
        {
            // SAFETY: zero-init is a valid `sysinfo` repr; sysinfo(2) overwrites it.
            let mut info: libc::sysinfo = unsafe { core::mem::zeroed() };
            // SAFETY: FFI call; out-param is valid for the duration.
            if unsafe { libc::sysinfo(&mut info) } == 0 {
                return (info.totalram as u64).wrapping_mul(info.mem_unit as u64);
            }
            0
        }
        #[cfg(target_os = "freebsd")]
        {
            let mut physmem: u64 = 0;
            let mut size: usize = core::mem::size_of::<u64>();
            // SAFETY: FFI call; out-params are valid for the duration.
            let rc = unsafe {
                libc::sysctlbyname(
                    c"hw.physmem".as_ptr(),
                    (&mut physmem as *mut u64).cast(),
                    &mut size,
                    core::ptr::null_mut(),
                    0,
                )
            };
            if rc != 0 { return 0; }
            physmem
        }
        #[cfg(windows)]
        {
            unsafe extern "C" { fn uv_get_total_memory() -> u64; }
            // SAFETY: FFI call with no arguments.
            unsafe { uv_get_total_memory() }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `PollFlag` / `is_readable` / `is_writable` — MOVE_DOWN from `bun.zig`.
// Requested by `[io]` move-out as `bun_sys::is_readable` + `bun_sys::Readable`.
// ──────────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PollFlag { Ready, NotReady, Hup }
/// Legacy alias requested by `bun_io` move-out (`bun_sys::Readable`).
pub use PollFlag as Readable;

/// Non-blocking `poll(fd, POLLIN)`; reports readability or hangup.
pub fn is_readable(fd: Fd) -> PollFlag {
    #[cfg(windows)]
    { unimplemented!("TODO on Windows"); }
    #[cfg(not(windows))]
    {
        debug_assert!(fd.is_valid());
        let mut polls = [libc::pollfd {
            fd: fd.native(),
            events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
            revents: 0,
        }];
        // SAFETY: FFI call; `polls` is valid for the duration of the call.
        let n = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
        let result = n > 0;
        let rc = if result && polls[0].revents & (libc::POLLHUP | libc::POLLERR) != 0 {
            PollFlag::Hup
        } else if result {
            PollFlag::Ready
        } else {
            PollFlag::NotReady
        };
        log!(
            "poll({}, .readable): {} ({:?}{})",
            fd, result, rc,
            if polls[0].revents & libc::POLLERR != 0 { " ERR " } else { "" },
        );
        rc
    }
}

/// Non-blocking `poll(fd, POLLOUT)` (or `WSAPoll` on Windows); reports writability.
pub fn is_writable(fd: Fd) -> PollFlag {
    #[cfg(windows)]
    {
        use crate::windows::ws2_32;
        let mut polls = [ws2_32::WSAPOLLFD {
            fd: fd.as_socket_fd(),
            events: ws2_32::POLLWRNORM,
            revents: 0,
        }];
        // SAFETY: FFI call; `polls` is valid for the duration of the call.
        let rc = unsafe { ws2_32::WSAPoll(polls.as_mut_ptr(), 1, 0) };
        let result = rc != ws2_32::SOCKET_ERROR && rc != 0;
        log!("poll({}) writable: {} ({})", fd, result, polls[0].revents);
        return if result && polls[0].revents & ws2_32::POLLWRNORM != 0 {
            PollFlag::Hup
        } else if result {
            PollFlag::Ready
        } else {
            PollFlag::NotReady
        };
    }
    #[cfg(not(windows))]
    {
        debug_assert!(fd.is_valid());
        let mut polls = [libc::pollfd {
            fd: fd.native(),
            events: libc::POLLOUT | libc::POLLERR | libc::POLLHUP,
            revents: 0,
        }];
        // SAFETY: FFI call; `polls` is valid for the duration of the call.
        let n = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
        let result = n > 0;
        let rc = if result && polls[0].revents & (libc::POLLHUP | libc::POLLERR) != 0 {
            PollFlag::Hup
        } else if result {
            PollFlag::Ready
        } else {
            PollFlag::NotReady
        };
        log!(
            "poll({}, .writable): {} ({:?}{})",
            fd, result, rc,
            if polls[0].revents & libc::POLLERR != 0 { " ERR " } else { "" },
        );
        rc
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `mkdir_recursive` — MOVE_DOWN simplified `mkdir -p` (replaces
// `bun_runtime::node::fs::NodeFs::mkdir_recursive` for `bun_patch`).
// Returns `()` (the `Return.Mkdir` first-created-path variant is JS-only).
// ──────────────────────────────────────────────────────────────────────────
pub fn mkdir_recursive(path: &[u8], mode: Mode) -> Result<()> {
    #[inline]
    fn is_sep(c: u8) -> bool {
        if cfg!(windows) { c == b'/' || c == b'\\' } else { c == b'/' }
    }

    let mut buf: PathBuffer = [0; MAX_PATH_BYTES];
    let len = path.len().min(MAX_PATH_BYTES - 1);
    buf[..len].copy_from_slice(&path[..len]);
    buf[len] = 0;

    // First, attempt to create the desired directory.
    // If that fails, then walk back up the path until we have a match.
    match mkdir_os_path(bun_paths::os_path_from_bytes_z(&buf[..=len]), mode) {
        Result::Ok(()) => return Result::Ok(()),
        Result::Err(err) => match err.get_errno() {
            // `mkpath_np` in macOS also checks for `EISDIR`.
            E::ISDIR | E::EXIST => return Result::Ok(()),
            E::NOENT if len > 0 => {} // continue below
            _ => return Result::Err(err.with_path(&path[..len])),
        },
    }

    // Walk backwards to find the first existing ancestor.
    let mut i = len;
    while i > 0 {
        i -= 1;
        while i > 0 && !is_sep(buf[i]) { i -= 1; }
        if i == 0 { break; }
        let saved = buf[i];
        buf[i] = 0;
        let res = mkdir_os_path(bun_paths::os_path_from_bytes_z(&buf[..=i]), mode);
        buf[i] = saved;
        match res {
            Result::Ok(()) => break,
            Result::Err(err) => match err.get_errno() {
                E::ISDIR | E::EXIST => break,
                E::NOENT => continue,
                _ => return Result::Err(err.with_path(&path[..i])),
            },
        }
    }

    // Walk forward creating each remaining component.
    while i < len {
        i += 1;
        while i < len && !is_sep(buf[i]) { i += 1; }
        let saved = buf[i];
        buf[i] = 0;
        let res = mkdir_os_path(bun_paths::os_path_from_bytes_z(&buf[..=i]), mode);
        buf[i] = saved;
        match res {
            Result::Ok(()) => {}
            Result::Err(err) => match err.get_errno() {
                E::ISDIR | E::EXIST => {}
                _ => return Result::Err(err.with_path(&path[..i])),
            },
        }
    }

    Result::Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_core::output::ErrName` impls — orphan rule lets the higher tier (sys)
// implement the lower-tier trait for its own types.
// ──────────────────────────────────────────────────────────────────────────
impl bun_core::output::ErrName for Error {
    fn name(&self) -> &[u8] { self.name() }
    fn as_sys_err_info(&self) -> Option<bun_core::output::SysErrInfo> {
        Some(bun_core::output::SysErrInfo {
            tag_name: self.name(),
            errno: c_int::from(self.errno),
            syscall: self.syscall.as_str(),
        })
    }
}

impl bun_core::output::ErrName for SystemErrno {
    fn name(&self) -> &[u8] {
        bun_core::tag_name(*self).map(str::as_bytes).unwrap_or(b"Unknown")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VTable instances (CYCLEBREAK §Dispatch — cold path). Low-tier crates
// declare the slot structs; sys provides the concrete syscall-backed impls.
// PERF(port): was inline switch over concrete File methods.
// ──────────────────────────────────────────────────────────────────────────

/// Backs `bun_core::Progress::File` — wraps stderr as a terminal handle.
pub static PROGRESS_TERMINAL_VTABLE: bun_core::Progress::ProgressTerminalVTable =
    bun_core::Progress::ProgressTerminalVTable {
        stderr: || bun_core::Progress::File {
            owner: Fd::stderr().native() as usize as *mut (),
            vtable: &PROGRESS_TERMINAL_VTABLE,
        },
        supports_ansi_escape_codes: |_owner| bun_core::output::enable_ansi_colors_stderr(),
        is_tty: |owner| isatty(Fd::from_native(owner as usize as _)),
        handle: |owner| owner,
        write_all: |owner, bytes| {
            let fd = Fd::from_native(owner as usize as _);
            match (crate::file::File { handle: fd }).write_all(bytes) {
                Result::Ok(()) => Ok(()),
                Result::Err(e) => Err(bun_core::Error::from_errno(e.errno as i32)),
            }
        },
    };

/// Backs `bun_core::output::OUTPUT_SINK_VTABLE` — stderr/mkdir/open/QuietWriter.
pub static OUTPUT_SINK_VTABLE: bun_core::output::OutputSinkVTable =
    bun_core::output::OutputSinkVTable {
        stderr: || bun_core::Progress::File {
            owner: Fd::stderr().native() as usize as *mut (),
            vtable: &PROGRESS_TERMINAL_VTABLE,
        },
        make_path: |cwd, dir| {
            // Debug-log file setup only; ignore mode on Windows.
            let _ = cwd;
            match mkdir_recursive(dir, 0o755) {
                Result::Ok(()) => Ok(()),
                Result::Err(e) => Err(bun_core::Error::from_errno(e.errno as i32)),
            }
        },
        create_file: |cwd, path| {
            let mut buf: PathBuffer = [0; MAX_PATH_BYTES];
            let z = bun_paths::z(path, &mut buf);
            match openat(Fd::from_native(cwd.native()), z, O::WRONLY | O::CREAT | O::TRUNC, 0o664) {
                Result::Ok(fd) => Ok(bun_core::Fd::from_native(fd.native())),
                Result::Err(e) => Err(bun_core::Error::from_errno(e.errno as i32)),
            }
        },
        quiet_writer_from_fd: |fd| {
            // bun_core::QuietWriter is an opaque `[*mut (); 4]`; sys's QuietWriter
            // is `{ context: File { handle: Fd } }`. Stash the fd in slot 0.
            let mut out = bun_core::output::QuietWriter::ZEROED;
            // SAFETY: QuietWriter is repr(C) [*mut (); 4]; slot 0 carries the fd.
            unsafe {
                *(&mut out as *mut _ as *mut *mut ()) = fd.native() as usize as *mut ();
            }
            out
        },
    };

/// Backs `libarchive_sys::ArchiveFileSink` — `owner` is the raw native fd.
pub static FD_ARCHIVE_FILE_SINK: libarchive_sys::ArchiveFileSinkVTable =
    libarchive_sys::ArchiveFileSinkVTable {
        write_all: |owner, buf| {
            let fd = Fd::from_native(owner as usize as _);
            matches!((crate::file::File { handle: fd }).write_all(buf), Result::Ok(()))
        },
        pwrite_all: |owner, buf, offset| {
            let fd = Fd::from_native(owner as usize as _);
            matches!((crate::file::File { handle: fd }).pwrite_all(buf, offset), Result::Ok(()))
        },
        set_offset: |owner, offset| {
            let fd = Fd::from_native(owner as usize as _);
            matches!(set_file_offset(fd, offset as usize), Result::Ok(()))
        },
        ftruncate: |owner, len| {
            let fd = Fd::from_native(owner as usize as _);
            let _ = ftruncate(fd, len as isize);
        },
    };

/// Build an [`libarchive_sys::ArchiveFileSink`] backed by an [`Fd`].
/// Callers of `Archive::read_data_into_fd` pass `&archive_file_sink(fd)`
/// instead of the raw `Fd`.
#[inline]
pub fn archive_file_sink(fd: Fd) -> libarchive_sys::ArchiveFileSink {
    libarchive_sys::ArchiveFileSink {
        owner: fd.native() as usize as *mut (),
        vtable: &FD_ARCHIVE_FILE_SINK,
    }
}

/// One-shot vtable/hook registration. `bun_runtime::init()` calls this before
/// any `bun_core::Output` write so `OUTPUT_SINK_VTABLE` is always live.
pub fn install_hooks() {
    bun_core::output::install_output_sink(&OUTPUT_SINK_VTABLE);
    // DUMP_STACK / TOP_LEVEL_DIR_HOOK are written by bun_runtime (higher tier).
}


// ──────────────────────────────────────────────────────────────────────────
// Imports / type aliases (Zig had these at the bottom)
// ──────────────────────────────────────────────────────────────────────────
pub use crate::fd::Fd;
pub use crate::node::{Maybe, PathOrFileDescriptor};
#[cfg(target_os = "macos")]
use bun_sys::darwin::nocancel as darwin_nocancel;
use bun_sys::c; // translated c headers (bun.c)
#[cfg(windows)]
use bun_sys::windows::{self, kernel32, ntdll, w};
use crate::posix;
// TODO(port): FileStat / FileKind = std.fs.File.Stat / .Kind ported equivalents.
use crate::file::{FileStat, FileKind};

pub mod error;
pub mod posix_stat;
pub mod dir;
pub mod file;
pub mod fd;
pub mod libuv_error_map;
pub mod coreutils_error_map;
#[cfg(windows)]
pub mod sys_uv;
mod raw;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/sys.zig (4635 lines)
//   confidence: low
//   todos:      43
//   notes:      Heavy anytype/@TypeOf dispatch needs WinPathChar/WinPathLike traits; Maybe<T> errno_sys* helpers assumed on Result; raw syscall module + posix shim need wiring in Phase B. @intCast sites now use try_from; SAFETY annotated on 166/167 unsafe blocks.
// ──────────────────────────────────────────────────────────────────────────
