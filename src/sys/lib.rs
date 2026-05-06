#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_sys` — B-1 minimal compiling surface.
//! Full Phase-A draft (5500 lines, all syscall wrappers) preserved in
//! `lib_draft_b1.rs`. B-2: un-gate per-syscall, wire libc/kernel32/ntdll.

#[cfg(any())] #[path = "lib_draft_b1.rs"] mod draft;
// RESOLVED (B-2 round 7): `Fd` struct + pure-data accessors hoisted to
// `bun_core::Fd` (canonical T0). `fd.rs` is now `pub trait FdExt` over that.
pub mod fd;
pub use fd::{FdExt, FdOptionalExt, ErrorCase, MakeLibUvOwnedError, HashMapContext, MovableIfWindowsFd, FdT, UvFile, RawFd};
// `File.rs` (Phase-A draft) stays gated: the inline `impl File` below is the
// canonical, downstream-consumed surface (`read_to_end() -> Maybe<Vec<u8>>`,
// `from_fd`, `create`, `read_from(Fd, &ZStr)`) and File.rs's shapes diverge
// (`read_to_end() -> ReadToEndResult`, `read_from(impl Into<File>, &ZStr)`).
// Swapping breaks T2+ callers. File.rs additionally blocked on
// `bun_paths::OsPathZ` (T0, missing) and the `top_level_dir()` resolver hook.
// B-2 follow-up: cherry-pick File.rs-only methods (`make_openat`, `kind`,
// `is_tty`, `read_file_from`, `close_and_move_to`) into the inline impl as
// higher tiers demand them.
#[cfg(any())] #[path = "File.rs"] pub mod file;
#[path = "Error.rs"] mod error;
pub use error::Error;
// `bun_sys::Error` is the rich syscall error (errno+tag+path); `bun_core::Error`
// is the lightweight NonZeroU16 code. They are distinct types (matching Zig:
// `bun.sys.Error` vs `anyerror`). Downstream that just wants "an error" gets the
// code via `From`.
impl From<Error> for bun_core::Error {
    #[inline]
    fn from(e: Error) -> bun_core::Error {
        // Encode as the errno's name (e.g., "ENOENT") in the interned table.
        bun_core::Error::from_errno(e.errno as i32)
    }
}
// Stub: `SystemError` is the JS-facing rich error (path/dest/syscall as bun.String).
// Full def lives in `bun_jsc` (TYPE_ONLY move-in pending per CYCLEBREAK).
#[derive(Default)]
pub struct SystemError {
    // PORT NOTE: full Display lives in src/jsc/SystemError.zig (rich JS-side
    // formatting). For T1 we provide a minimal impl so `bun_sys::Error` can
    // delegate; Display matches `SystemError.format` shell-variant shape.
    pub errno: i32,
    pub code: bun_string::String,
    pub message: bun_string::String,
    pub path: bun_string::String,
    pub dest: bun_string::String,
    pub syscall: bun_string::String,
    pub fd: i32,
    pub hostname: bun_string::String,
}
impl core::fmt::Display for SystemError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // TODO(b2): match SystemError.zig writeFormat exactly (color, syscall, fd).
        // Minimal: "<code>: <message> '<path>'"
        write!(f, "SystemError(errno={})", self.errno)
    }
}
pub mod walker_skippable;
// `copy_file.rs` — full ioctl_ficlone / copy_file_range / sendfile / r-w-loop
// state machine (port of `src/sys/copy_file.zig`). Un-gated B-2: raw kernel
// thunks live in `crate::linux`, errno tags use the prefixed `E::E*` form,
// kernel-version probe goes through `bun_core::linux_kernel_version()`.
#[path = "copy_file.rs"] pub mod copy_file;

// `std.fs.Dir.Entry.Kind` — same set as `bun_core::FileKind`.
pub use bun_core::FileKind as EntryKind;

// TODO(b2-blocked): `bun.DirIterator` lives in `bun_runtime::node::dir_iterator`
// (T6). Per PORTING.md §Dispatch this is the cold-path vtable case: low-tier
// owns the interface, high-tier installs an impl. Until then, stub the surface
// `walker_skippable` (and `bun_glob`) need.
pub mod dir_iterator {
    use super::{EntryKind, Fd};
    use bun_paths::OSPathChar;

    /// Native-encoding directory entry returned by `WrappedIterator::next()`.
    pub struct IteratorResult {
        pub name: Name,
        pub kind: EntryKind,
    }
    /// Length-known, NUL-terminated entry name in OS-native encoding.
    pub struct Name(Vec<OSPathChar>);
    impl Name {
        #[inline] pub fn as_slice(&self) -> &[OSPathChar] { &self.0 }
        #[inline] pub fn as_zstr(&self) -> &bun_core::ZStr {
            // SAFETY: `0` always pushed as terminator on construction (T6 impl).
            // Stub: unreachable until `iterate` is wired.
            unsafe { bun_core::ZStr::from_raw(self.0.as_ptr().cast(), self.0.len()) }
        }
    }

    impl Name {
        /// Zig: `name.slice()` — borrow the name as `&[OSPathChar]` (no NUL).
        #[inline] pub fn slice(&self) -> &[OSPathChar] { &self.0 }
    }

    /// `DirIterator.NewWrappedIterator(if windows .u16 else .u8)`
    pub struct WrappedIterator {
        dir: Fd,
        // Windows: NtQueryDirectoryFile filter (UNICODE_STRING). On POSIX,
        // ignored (kernel readdir has no name filter; callers post-filter).
        name_filter: Option<Vec<u16>>,
        // TODO(b2-blocked): platform-specific readdir state (DIR* / HANDLE+buf).
    }
    impl WrappedIterator {
        #[inline] pub fn dir(&self) -> Fd { self.dir }
        /// Windows-only kernel-side name filter (passed to `NtQueryDirectoryFile`).
        /// On POSIX this is a no-op; callers must filter themselves.
        #[inline]
        pub fn set_name_filter(&mut self, filter: Option<&[u16]>) {
            self.name_filter = filter.map(|f| f.to_vec());
        }
        pub fn next(&mut self) -> super::Result<Option<IteratorResult>> {
            todo!("b2-blocked: bun_runtime::node::dir_iterator (T6) — vtable install pending")
        }
    }

    pub fn iterate(dir: Fd) -> WrappedIterator {
        WrappedIterator { dir, name_filter: None }
    }
}

/// `bun.openDirForIterationOSPath` — `openat(dir, path, O_DIRECTORY|O_RDONLY)`
/// on POSIX; `CreateFileW` with `FILE_FLAG_BACKUP_SEMANTICS` on Windows.
pub fn open_dir_for_iteration_os_path(dir: Fd, path: &bun_paths::OSPathSlice) -> Result<Fd> {
    #[cfg(not(windows))] {
        // PORT NOTE: Zig `openDirForIterationOSPath` uses
        // `O_DIRECTORY | O_RDONLY | O_CLOEXEC` (`| O_NONBLOCK` on Linux).
        let mut buf = bun_paths::PathBuffer::default();
        let len = path.len().min(buf.len() - 1);
        buf[..len].copy_from_slice(&path[..len]);
        buf[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.as_ptr(), len) };
        // bun.zig:883 — exactly `O_DIRECTORY | O_CLOEXEC | O_RDONLY` (no NONBLOCK).
        let flags = libc::O_DIRECTORY | libc::O_RDONLY | libc::O_CLOEXEC;
        openat(dir, z, flags, 0)
    }
    #[cfg(windows)] {
        let _ = (dir, path);
        todo!("b2-blocked: open_dir_for_iteration_os_path windows")
    }
}

pub fn lstatat(fd: Fd, path: &ZStr) -> Result<Stat> {
    #[cfg(not(windows))] {
        let mut st = core::mem::MaybeUninit::<libc::stat>::uninit();
        // sys.zig:874 — `bun.invalid_fd` means cwd-relative.
        let dirfd = if fd.is_valid() { fd.native() } else { libc::AT_FDCWD };
        // SAFETY: path is NUL-terminated; st is written on success.
        let rc = unsafe {
            libc::fstatat(dirfd, path.as_ptr().cast(), st.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW)
        };
        if rc == 0 {
            Ok(unsafe { st.assume_init() })
        } else {
            Err(Error::from_code_int(last_errno(), Tag::lstat).with_path(path.as_bytes()))
        }
    }
    #[cfg(windows)] {
        let _ = (fd, path);
        todo!("b2-blocked: lstatat windows (NtQueryInformationFile)")
    }
}
pub mod coreutils_error_map;
pub mod libuv_error_map;
#[path = "SignalCode.rs"] pub mod signal_code;
pub use signal_code::SignalCode;
pub mod tmp;
pub use tmp::Tmpfile;
// `windows/mod.rs` is `#![cfg(windows)]`-gated internally; on POSIX this
// declares an empty module so `bun_sys::windows::*` paths still resolve under
// `#[cfg(windows)]` arms in dependents.
pub mod windows;

use core::ffi::{c_char, c_int, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from lower-tier crates (PORTING.md crate map).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_core::{Fd, FdNative, FdKind, FdOptional, Stdio, Mode, FileKind, kind_from_mode};
/// `std.posix.socket_t` — `c_int` on POSIX, `SOCKET` (`usize`) on Windows.
#[cfg(not(windows))] pub type SocketT = core::ffi::c_int;
#[cfg(windows)] pub type SocketT = usize;
pub use bun_errno::{E, S, SystemErrno, get_errno, GetErrno};
// `bun_errno::posix` is the small move-down stub (mode_t/E/S/errno). The full
// `std.posix` surface dependents need (`Sigaction`, `getrlimit`, `tcgetattr`,
// raw `read`/`write`/`poll`, …) is widened below in this crate's own `posix`
// module which re-exports the errno stub and layers libc on top.

/// `Maybe(T)` — Zig's `union(enum) { result: T, err: Error }`. In Rust this is
/// just `Result<T, Error>`; keep the alias so Phase-A drafts type-check.
pub type Maybe<T> = core::result::Result<T, Error>;
pub type Result<T> = core::result::Result<T, Error>;

// ──────────────────────────────────────────────────────────────────────────
// Syscall tag — opaque u16 (full enum in B-2).
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Tag(pub u16);
pub mod syscall {
    pub use super::Tag;
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.O` — open flags. cfg-per-platform; values match libc.
// ──────────────────────────────────────────────────────────────────────────
pub mod O {
    pub const RDONLY: i32 = libc::O_RDONLY;
    pub const WRONLY: i32 = libc::O_WRONLY;
    pub const RDWR: i32 = libc::O_RDWR;
    pub const CREAT: i32 = libc::O_CREAT;
    pub const TRUNC: i32 = libc::O_TRUNC;
    pub const APPEND: i32 = libc::O_APPEND;
    pub const EXCL: i32 = libc::O_EXCL;
    pub const NONBLOCK: i32 = libc::O_NONBLOCK;
    pub const CLOEXEC: i32 = libc::O_CLOEXEC;
    #[cfg(unix)] pub const DIRECTORY: i32 = libc::O_DIRECTORY;
    #[cfg(windows)] pub const DIRECTORY: i32 = 0;
    #[cfg(target_os = "linux")] pub const PATH: i32 = libc::O_PATH;
    #[cfg(target_os = "linux")] pub const NOATIME: i32 = libc::O_NOATIME;
    #[cfg(target_os = "linux")] pub const TMPFILE: i32 = libc::O_TMPFILE;
    #[cfg(not(target_os = "linux"))] pub const PATH: i32 = 0;
    #[cfg(not(target_os = "linux"))] pub const NOATIME: i32 = 0;
    #[cfg(not(target_os = "linux"))] pub const TMPFILE: i32 = 0;
}

// ──────────────────────────────────────────────────────────────────────────
// `File` — high-level handle. B-1 stub; B-2 wires read/write/stat.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
pub struct File { pub handle: Fd }
impl File {
    #[inline] pub fn from_fd(fd: Fd) -> Self { Self { handle: fd } }
    #[inline] pub fn handle(&self) -> Fd { self.handle }
}
/// `bun.sys.File` is also reachable as `bun_sys::file::File` (Zig: `sys.File`).
pub mod file { pub use super::File; }

pub type Stat = libc::stat;

// ──────────────────────────────────────────────────────────────────────────
// Syscall surface — real posix libc FFI. Windows path stays gated in
// `lib_draft_b1.rs` (NT/kernel32/libuv triad); these `#[cfg(unix)]` impls
// match `src/sys/sys.zig` posix arms 1:1.
// ──────────────────────────────────────────────────────────────────────────
use bun_core::ZStr;

/// Read thread-local libc errno (set by the failing syscall).
#[cfg(unix)]
#[inline]
pub fn last_errno() -> i32 {
    // SAFETY: __errno_location()/__error() return a valid thread-local int*.
    unsafe { *errno_ptr() }
}
#[cfg(target_os = "linux")]
#[inline] unsafe fn errno_ptr() -> *mut i32 { unsafe { libc::__errno_location() } }
#[cfg(target_os = "macos")]
#[inline] unsafe fn errno_ptr() -> *mut i32 { unsafe { libc::__error() } }
#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
#[inline] unsafe fn errno_ptr() -> *mut i32 { unsafe { libc::__errno_location() } }
#[cfg(windows)]
#[inline] fn last_errno() -> i32 { 0 /* TODO(b2-windows): GetLastError() */ }

#[inline]
fn err_with(tag: Tag) -> Error {
    Error::from_code_int(last_errno(), tag)
}
#[inline]
fn err_with_path(tag: Tag, path: &ZStr) -> Error {
    err_with(tag).with_path(path.as_bytes())
}

// Syscall tags — subset; full enum in `lib_draft_b1.rs`.
impl Tag {
    pub const open: Tag = Tag(1);   pub const close: Tag = Tag(2);
    pub const read: Tag = Tag(3);   pub const write: Tag = Tag(4);
    pub const pread: Tag = Tag(5);  pub const pwrite: Tag = Tag(6);
    pub const stat: Tag = Tag(7);   pub const fstat: Tag = Tag(8);
    pub const lstat: Tag = Tag(9);  pub const mkdir: Tag = Tag(10);
    pub const unlink: Tag = Tag(11);pub const rename: Tag = Tag(12);
    pub const symlink: Tag = Tag(13);pub const readlink: Tag = Tag(14);
    pub const dup: Tag = Tag(15);   pub const getcwd: Tag = Tag(16);
    pub const fchmod: Tag = Tag(17);pub const fchown: Tag = Tag(18);
    pub const ftruncate: Tag = Tag(19); pub const closeHandle: Tag = Tag(20);
    pub const mkdirat: Tag = Tag(21);
    pub const link: Tag = Tag(22);    pub const chmod: Tag = Tag(23);
    pub const chown: Tag = Tag(24);   pub const access: Tag = Tag(25);
    pub const futimens: Tag = Tag(26);pub const utimensat: Tag = Tag(27);
    pub const fcntl: Tag = Tag(28);   pub const dup2: Tag = Tag(29);
    pub const pipe: Tag = Tag(30);    pub const fstatat: Tag = Tag(31);
    pub const ioctl: Tag = Tag(32);   pub const fsync: Tag = Tag(33);
    pub const fdatasync: Tag = Tag(34);pub const chdir: Tag = Tag(35);
    pub const realpath: Tag = Tag(36);pub const recv: Tag = Tag(37);
    pub const send: Tag = Tag(38);    pub const socketpair: Tag = Tag(39);
    pub const lseek: Tag = Tag(40);   pub const lchown: Tag = Tag(41);
    pub const lchmod: Tag = Tag(42);  pub const linkat: Tag = Tag(43);
    pub const fchmodat: Tag = Tag(44);pub const fchownat: Tag = Tag(45);
    pub const symlinkat: Tag = Tag(46);pub const readlinkat: Tag = Tag(47);
    pub const faccessat: Tag = Tag(48);pub const umask: Tag = Tag(49);
    pub const isatty: Tag = Tag(50);  pub const sendfile: Tag = Tag(51);
    pub const clonefile: Tag = Tag(52);pub const copyfile: Tag = Tag(53);
    pub const fcopyfile: Tag = Tag(54);pub const mmap: Tag = Tag(55);
    pub const munmap: Tag = Tag(56);  pub const fchdir: Tag = Tag(57);
    pub const epoll_ctl: Tag = Tag(58); pub const kqueue: Tag = Tag(59);
    pub const kevent: Tag = Tag(60);  pub const inotify: Tag = Tag(61);
    pub const ppoll: Tag = Tag(62);   pub const fallocate: Tag = Tag(63);
    pub const copy_file_range: Tag = Tag(64);
    pub const TODO: Tag = Tag(0);
    /// Full tag enum (~200 variants) lives in `lib_draft_b1.rs`. This subset
    /// covers the un-gated posix surface; B-2 widens as syscalls land.
    pub fn name(self) -> &'static str {
        match self.0 {
            0 => "TODO", 1 => "open", 2 => "close", 3 => "read", 4 => "write",
            5 => "pread", 6 => "pwrite", 7 => "stat", 8 => "fstat", 9 => "lstat",
            10 => "mkdir", 11 => "unlink", 12 => "rename", 13 => "symlink",
            14 => "readlink", 15 => "dup", 16 => "getcwd", 17 => "fchmod",
            18 => "fchown", 19 => "ftruncate", 20 => "closeHandle", 21 => "mkdirat",
            22 => "link", 23 => "chmod", 24 => "chown", 25 => "access",
            26 => "futimens", 27 => "utimensat", 28 => "fcntl", 29 => "dup2",
            30 => "pipe", 31 => "fstatat", 32 => "ioctl", 33 => "fsync",
            34 => "fdatasync", 35 => "chdir", 36 => "realpath", 37 => "recv",
            38 => "send", 39 => "socketpair", 40 => "lseek", 41 => "lchown",
            42 => "lchmod", 43 => "linkat", 44 => "fchmodat", 45 => "fchownat",
            46 => "symlinkat", 47 => "readlinkat", 48 => "faccessat", 49 => "umask",
            50 => "isatty", 51 => "sendfile", 52 => "clonefile", 53 => "copyfile",
            54 => "fcopyfile", 55 => "mmap", 56 => "munmap", 57 => "fchdir",
            58 => "epoll_ctl", 59 => "kqueue", 60 => "kevent", 61 => "inotify",
            62 => "ppoll", 63 => "fallocate",
            _ => "unknown",
        }
    }
}
impl From<Tag> for &'static str {
    #[inline] fn from(t: Tag) -> &'static str { t.name() }
}

/// Max single read/write count (sys.zig:1832): Linux caps at 0x7ffff000;
/// Darwin/BSD use signed 32-bit byte counts.
#[cfg(target_os = "linux")]
pub const MAX_COUNT: usize = 0x7ffff000;
#[cfg(all(unix, not(target_os = "linux")))]
pub const MAX_COUNT: usize = i32::MAX as usize;
#[cfg(windows)]
pub const MAX_COUNT: usize = u32::MAX as usize;

#[cfg(unix)]
mod posix_impl {
    use super::*;
    // EINTR-retry: every syscall in sys.zig is wrapped in
    // `while (true) { ...; if errno == .INTR continue; }`. We do the same in the
    // check macro so every caller below gets it for free.
    macro_rules! check { ($rc:expr, $tag:expr) => {{
        loop {
            let rc = $rc;
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, $tag));
            }
            break rc;
        }
    }}}
    macro_rules! check_p { ($rc:expr, $tag:expr, $path:expr) => {{
        loop {
            let rc = $rc;
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, $tag).with_path($path.as_bytes()));
            }
            break rc;
        }
    }}}

    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        let rc = check_p!(unsafe { libc::open(path.as_ptr(), flags, mode as libc::c_uint) }, Tag::open, path);
        Ok(Fd::from_native(rc))
    }
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
        let rc = check_p!(unsafe { libc::openat(dir.native(), path.as_ptr(), flags, mode as libc::c_uint) }, Tag::open, path);
        Ok(Fd::from_native(rc))
    }
    pub fn close(fd: Fd) -> Maybe<()> {
        // fd.zig:266 — call close ONCE; never retry on EINTR (Linux may have already
        // released the fd, retrying would close someone else's). Only EBADF surfaces.
        // SAFETY: fd is a valid open descriptor owned by caller.
        let rc = unsafe { libc::close(fd.native()) };
        if rc < 0 && last_errno() == libc::EBADF {
            return Err(Error::from_code_int(libc::EBADF, Tag::close).with_fd(fd));
        }
        Ok(())
    }
    pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { libc::read(fd.native(), buf.as_mut_ptr().cast(), len) }, Tag::read);
        Ok(n as usize)
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { libc::write(fd.native(), buf.as_ptr().cast(), len) }, Tag::write);
        Ok(n as usize)
    }
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { libc::pread(fd.native(), buf.as_mut_ptr().cast(), len, off) }, Tag::pread);
        Ok(n as usize)
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { libc::pwrite(fd.native(), buf.as_ptr().cast(), len, off) }, Tag::pwrite);
        Ok(n as usize)
    }
    pub fn stat(path: &ZStr) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        check_p!(unsafe { libc::stat(path.as_ptr(), st.as_mut_ptr()) }, Tag::stat, path);
        Ok(unsafe { st.assume_init() })
    }
    pub fn fstat(fd: Fd) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        check!(unsafe { libc::fstat(fd.native(), st.as_mut_ptr()) }, Tag::fstat);
        Ok(unsafe { st.assume_init() })
    }
    pub fn lstat(path: &ZStr) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        check_p!(unsafe { libc::lstat(path.as_ptr(), st.as_mut_ptr()) }, Tag::lstat, path);
        Ok(unsafe { st.assume_init() })
    }
    pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(unsafe { libc::mkdir(path.as_ptr(), mode) }, Tag::mkdir, path); Ok(())
    }
    pub fn mkdirat(dir: Fd, path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(unsafe { libc::mkdirat(dir.native(), path.as_ptr(), mode) }, Tag::mkdirat, path); Ok(())
    }
    /// `bun.makePath` — `mkdirat` walking up parents on ENOENT, like `mkdir -p`.
    /// Port of std.fs.Dir.makePath (Zig std/fs/Dir.zig).
    pub fn mkdir_recursive_at(dir: Fd, sub_path: &[u8]) -> Maybe<()> {
        // PERF(port): Zig leaves the buffer `undefined`; zero-fill here for
        // simplicity. Stack-local, no heap.
        let mut buf = [0u8; bun_core::MAX_PATH_BYTES];
        if sub_path.len() >= buf.len() {
            return Err(Error::from_code_int(E::ENAMETOOLONG as _, Tag::mkdirat).with_path(sub_path));
        }
        buf[..sub_path.len()].copy_from_slice(sub_path);
        let mut end = sub_path.len();
        while end > 0 && buf[end - 1] == bun_core::SEP { end -= 1; } // trim trailing seps
        buf[end] = 0;
        // Stack of separator positions we NUL'd while peeling back, so each
        // can be restored before re-creating its component on the way up.
        let mut nuls = [0u16; 256];
        let mut nuls_len = 0usize;
        let mut peel = end;
        // Walk down: try mkdirat; on ENOENT, peel one component.
        loop {
            // SAFETY: buf[0..=peel] is NUL-terminated (initial buf[end]=0 or a
            // peeled '/' overwritten below).
            let z = unsafe { ZStr::from_raw(buf.as_ptr(), peel) };
            match mkdirat(dir, z, 0o755) {
                Ok(()) => break,
                Err(e) if e.get_errno() == E::EEXIST => break,
                Err(e) if e.get_errno() == E::ENOENT => {
                    let Some(slash) = buf[..peel].iter().rposition(|&b| b == bun_core::SEP) else {
                        return Err(e);
                    };
                    if slash == 0 { return Err(e); }
                    peel = slash;
                    buf[peel] = 0;
                    nuls[nuls_len] = peel as u16;
                    nuls_len += 1;
                }
                Err(e) => return Err(e),
            }
        }
        // Walk back up, restoring each '/' and creating that prefix.
        while nuls_len > 0 {
            nuls_len -= 1;
            let pos = nuls[nuls_len] as usize;
            buf[pos] = bun_core::SEP;
            // The only remaining NUL above `pos` is the next entry on the
            // stack (or `end`), which is exactly the next component boundary.
            let next_end = if nuls_len > 0 { nuls[nuls_len - 1] as usize } else { end };
            // SAFETY: buf[next_end] == 0 (still un-restored or the original sentinel).
            let z = unsafe { ZStr::from_raw(buf.as_ptr(), next_end) };
            match mkdirat(dir, z, 0o755) {
                Ok(()) => {}
                Err(e) if e.get_errno() == E::EEXIST => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
    pub fn unlink(path: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::unlink(path.as_ptr()) }, Tag::unlink, path); Ok(())
    }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::rename(from.as_ptr(), to.as_ptr()) }, Tag::rename, from); Ok(())
    }
    pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::renameat(from_dir.native(), from.as_ptr(), to_dir.native(), to.as_ptr()) }, Tag::rename, from);
        Ok(())
    }
    pub fn unlinkat(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()> {
        check_p!(unsafe { libc::unlinkat(dir.native(), path.as_ptr(), flags) }, Tag::unlink, path); Ok(())
    }
    pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::symlink(target.as_ptr(), link.as_ptr()) }, Tag::symlink, link); Ok(())
    }
    pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let n = check_p!(unsafe { libc::readlink(path.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) }, Tag::readlink, path);
        let n = n as usize;
        // sys.zig:2368 — truncation guard + NUL-terminate.
        if n >= buf.len() {
            return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::readlink).with_path(path.as_bytes()));
        }
        buf[n] = 0;
        Ok(n)
    }
    /// sys.zig:3897 — `fcntl(F_DUPFD_CLOEXEC, 0)` so the dup'd fd doesn't leak
    /// to children. NOT `dup(2)` (which lacks CLOEXEC).
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        let rc = check!(unsafe { libc::fcntl(fd.native(), libc::F_DUPFD_CLOEXEC, 0) }, Tag::dup);
        Ok(Fd::from_native(rc))
    }
    pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()> {
        check!(unsafe { libc::fchmod(fd.native(), mode) }, Tag::fchmod); Ok(())
    }
    pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Maybe<()> {
        check!(unsafe { libc::fchown(fd.native(), uid, gid) }, Tag::fchown); Ok(())
    }
    pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()> {
        check!(unsafe { libc::ftruncate(fd.native(), len) }, Tag::ftruncate); Ok(())
    }
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize> {
        let p = unsafe { libc::getcwd(buf.as_mut_ptr().cast(), buf.len()) };
        if p.is_null() { return Err(err_with(Tag::getcwd)); }
        Ok(unsafe { libc::strlen(p) })
    }
    pub fn page_size() -> usize {
        unsafe { libc::sysconf(libc::_SC_PAGESIZE) as usize }
    }

    // ── B-2 round 9: link/perm/time/access group (sys.zig:406-3973 posix arms) ──
    pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::link(src.as_ptr(), dest.as_ptr()) }, Tag::link, src); Ok(())
    }
    pub fn linkat(src_dir: Fd, src: &ZStr, dest_dir: Fd, dest: &ZStr) -> Maybe<()> {
        check_p!(
            unsafe { libc::linkat(src_dir.native(), src.as_ptr(), dest_dir.native(), dest.as_ptr(), 0) },
            Tag::linkat, src
        );
        Ok(())
    }
    /// `linkatTmpfile` (sys.zig:3973): materialize an `O_TMPFILE` fd. Fast path
    /// uses `linkat(tmpfd, "", dirfd, name, AT_EMPTY_PATH)` (requires
    /// CAP_DAC_READ_SEARCH); falls back to `/proc/self/fd/N` + AT_SYMLINK_FOLLOW.
    /// Linux-only; on other unix this errors with EOPNOTSUPP (Zig same).
    #[cfg(target_os = "linux")]
    pub fn linkat_tmpfile(tmpfd: Fd, dirfd: Fd, name: &ZStr) -> Maybe<()> {
        // 0=unknown, 1=have CAP_DAC_READ_SEARCH, -1=no cap → use /proc fallback.
        static CAP_STATUS: core::sync::atomic::AtomicI32 = core::sync::atomic::AtomicI32::new(0);
        loop {
            let status = CAP_STATUS.load(core::sync::atomic::Ordering::Relaxed);
            let rc = if status != -1 {
                // SAFETY: tmpfd/dirfd valid; "" with AT_EMPTY_PATH names tmpfd itself.
                unsafe {
                    libc::linkat(tmpfd.native(), c"".as_ptr(), dirfd.native(), name.as_ptr(), libc::AT_EMPTY_PATH)
                }
            } else {
                let mut buf = [0u8; 32];
                let n = {
                    use std::io::Write as _;
                    let mut c = std::io::Cursor::new(&mut buf[..]);
                    let _ = write!(c, "/proc/self/fd/{}\0", tmpfd.native());
                    c.position() as usize - 1
                };
                let _ = n;
                // SAFETY: NUL written by the format string above.
                unsafe {
                    libc::linkat(
                        libc::AT_FDCWD, buf.as_ptr().cast(), dirfd.native(), name.as_ptr(),
                        libc::AT_SYMLINK_FOLLOW,
                    )
                }
            };
            if rc < 0 {
                let e = last_errno();
                match e {
                    libc::EINTR => continue,
                    libc::EISDIR | libc::ENOENT | libc::EOPNOTSUPP | libc::EPERM | libc::EINVAL if status == 0 => {
                        // sys.zig:4013 — first failure on AT_EMPTY_PATH ⇒ no cap; retry via /proc.
                        CAP_STATUS.store(-1, core::sync::atomic::Ordering::Relaxed);
                        continue;
                    }
                    _ => return Err(Error::from_code_int(e, Tag::link).with_fd(tmpfd)),
                }
            }
            if status == 0 {
                CAP_STATUS.store(1, core::sync::atomic::Ordering::Relaxed);
            }
            return Ok(());
        }
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    pub fn linkat_tmpfile(_tmpfd: Fd, _dirfd: Fd, name: &ZStr) -> Maybe<()> {
        Err(Error::from_code_int(libc::EOPNOTSUPP, Tag::linkat).with_path(name.as_bytes()))
    }
    pub fn symlinkat(target: &ZStr, dirfd: Fd, dest: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::symlinkat(target.as_ptr(), dirfd.native(), dest.as_ptr()) }, Tag::symlinkat, dest);
        Ok(())
    }
    pub fn readlinkat(fd: Fd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize> {
        let n = check_p!(
            unsafe { libc::readlinkat(fd.native(), path.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) },
            Tag::readlinkat, path
        );
        let n = n as usize;
        if n >= buf.len() {
            return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::readlinkat).with_path(path.as_bytes()));
        }
        buf[n] = 0;
        Ok(n)
    }
    pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        check_p!(unsafe { libc::chmod(path.as_ptr(), mode) }, Tag::chmod, path); Ok(())
    }
    pub fn fchmodat(dir: Fd, path: &ZStr, mode: Mode, flags: i32) -> Maybe<()> {
        check_p!(unsafe { libc::fchmodat(dir.native(), path.as_ptr(), mode, flags) }, Tag::fchmodat, path); Ok(())
    }
    /// `lchmod` is BSD/Darwin-only; Linux: `fchmodat(.., AT_SYMLINK_NOFOLLOW)` (sys.zig:434).
    pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()> {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        { check_p!(unsafe { libc::lchmod(path.as_ptr(), mode) }, Tag::lchmod, path); Ok(()) }
        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        { fchmodat(Fd::cwd(), path, mode, libc::AT_SYMLINK_NOFOLLOW) }
    }
    pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(unsafe { libc::chown(path.as_ptr(), uid, gid) }, Tag::chown, path); Ok(())
    }
    pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()> {
        check_p!(unsafe { libc::lchown(path.as_ptr(), uid, gid) }, Tag::lchown, path); Ok(())
    }
    pub fn fchownat(dir: Fd, path: &ZStr, uid: u32, gid: u32, flags: i32) -> Maybe<()> {
        check_p!(unsafe { libc::fchownat(dir.native(), path.as_ptr(), uid, gid, flags) }, Tag::fchownat, path); Ok(())
    }
    pub fn fstatat(fd: Fd, path: &ZStr) -> Maybe<Stat> {
        let mut st = core::mem::MaybeUninit::<Stat>::uninit();
        // sys.zig:848 — `bun.invalid_fd` means cwd-relative.
        let dirfd = if fd.is_valid() { fd.native() } else { libc::AT_FDCWD };
        check_p!(unsafe { libc::fstatat(dirfd, path.as_ptr(), st.as_mut_ptr(), 0) }, Tag::fstatat, path);
        Ok(unsafe { st.assume_init() })
    }
    pub fn access(path: &ZStr, mode: i32) -> Maybe<()> {
        check_p!(unsafe { libc::access(path.as_ptr(), mode) }, Tag::access, path); Ok(())
    }
    /// sys.zig:3504 — never returns `.err`; any non-zero rc → `Ok(false)`.
    pub fn faccessat(dir: Fd, sub: &ZStr) -> Maybe<bool> {
        let rc = unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) };
        Ok(rc == 0)
    }
    pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check!(unsafe { libc::futimens(fd.native(), ts.as_ptr()) }, Tag::futimens); Ok(())
    }
    pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), ts.as_ptr(), 0) },
            Tag::utimensat, path
        );
        Ok(())
    }
    pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()> {
        let ts = [atime.to_timespec(), mtime.to_timespec()];
        check_p!(
            unsafe { libc::utimensat(libc::AT_FDCWD, path.as_ptr(), ts.as_ptr(), libc::AT_SYMLINK_NOFOLLOW) },
            Tag::utimensat, path
        );
        Ok(())
    }
    /// sys.zig:1748 — Windows uses `GetFileAttributesW`; posix is plain `access`.
    pub fn exists_z(path: &ZStr) -> bool {
        unsafe { libc::access(path.as_ptr(), libc::F_OK) == 0 }
    }
    pub fn exists_at(dir: Fd, sub: &ZStr) -> bool {
        unsafe { libc::faccessat(dir.native(), sub.as_ptr(), libc::F_OK, 0) == 0 }
    }
    /// sys.zig:3767 — calls extern C `is_executable_file` (c-bindings.cpp:72-89).
    /// We FFI to the same symbol so the behaviour is identical.
    pub fn is_executable_file_path(path: &ZStr) -> bool {
        unsafe extern "C" {
            fn is_executable_file(path: *const i8) -> bool;
        }
        unsafe { is_executable_file(path.as_ptr()) }
    }
    /// sys.zig:4152 — `fstat` then `@max(st_size, 0)` (clamp negative).
    pub fn get_file_size(fd: Fd) -> Maybe<u64> {
        Ok(fstat(fd)?.st_size.max(0) as u64)
    }
    /// `realpath` — `realpath$DARWIN_EXTSN` on macOS for proper symlink resolution
    /// (Zig: `bun.c.realpath`). Writes into `buf` and returns the written slice.
    pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]> {
        #[cfg(target_os = "macos")]
        unsafe extern "C" {
            #[link_name = "realpath$DARWIN_EXTSN"]
            fn _realpath(path: *const i8, resolved: *mut i8) -> *mut i8;
        }
        #[cfg(not(target_os = "macos"))]
        use libc::realpath as _realpath;
        let p = unsafe { _realpath(path.as_ptr(), buf.0.as_mut_ptr().cast()) };
        if p.is_null() { return Err(err_with_path(Tag::realpath, path)); }
        let len = unsafe { libc::strlen(p) };
        Ok(&buf.0[..len])
    }

    // ── B-2 round 9: fcntl/dup/pipe/io group ──
    pub type FcntlInt = isize;
    pub fn fcntl(fd: Fd, cmd: i32, arg: isize) -> Maybe<FcntlInt> {
        let rc = check!(unsafe { libc::fcntl(fd.native(), cmd, arg) }, Tag::fcntl);
        Ok(rc as isize)
    }
    pub fn dup2(old: Fd, new: Fd) -> Maybe<Fd> {
        let rc = check!(unsafe { libc::dup2(old.native(), new.native()) }, Tag::dup2);
        Ok(Fd::from_native(rc))
    }
    /// sys.zig:3839 — plain `pipe(&fds)`, NO CLOEXEC. Callers that want CLOEXEC
    /// set it themselves (matches Zig).
    pub fn pipe() -> Maybe<[Fd; 2]> {
        let mut fds = [0i32; 2];
        check!(unsafe { libc::pipe(fds.as_mut_ptr()) }, Tag::pipe);
        Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }
    pub fn isatty(fd: Fd) -> bool {
        unsafe { libc::isatty(fd.native()) == 1 }
    }
    pub fn fsync(fd: Fd) -> Maybe<()> {
        check!(unsafe { libc::fsync(fd.native()) }, Tag::fsync); Ok(())
    }
    pub fn fdatasync(fd: Fd) -> Maybe<()> {
        #[cfg(target_os = "macos")]
        // macOS has no fdatasync; Zig uses F_FULLFSYNC (sys.zig).
        { check!(unsafe { libc::fcntl(fd.native(), libc::F_FULLFSYNC) }, Tag::fdatasync); Ok(()) }
        #[cfg(not(target_os = "macos"))]
        { check!(unsafe { libc::fdatasync(fd.native()) }, Tag::fdatasync); Ok(()) }
    }
    pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Maybe<i64> {
        let rc = check!(unsafe { libc::lseek(fd.native(), offset, whence) }, Tag::lseek);
        Ok(rc)
    }
    pub fn chdir(path: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::chdir(path.as_ptr()) }, Tag::chdir, path); Ok(())
    }
    pub fn fchdir(fd: Fd) -> Maybe<()> {
        check!(unsafe { libc::fchdir(fd.native()) }, Tag::fchdir); Ok(())
    }
    pub fn umask(mode: Mode) -> Mode {
        unsafe { libc::umask(mode) }
    }

    // ── B-2 round 9: socket primitives (recv/send/socketpair) ──
    // Full networking lives in `bun_uws_sys`; these are the bare libc wrappers
    // sys.zig exposes for shell/pipe IPC.
    pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { libc::recv(fd.native(), buf.as_mut_ptr().cast(), len, flags) }, Tag::recv);
        Ok(n as usize)
    }
    pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize> {
        let len = buf.len().min(MAX_COUNT);
        let n = check!(unsafe { libc::send(fd.native(), buf.as_ptr().cast(), len, flags) }, Tag::send);
        Ok(n as usize)
    }
    pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
        recv(fd, buf, MSG_DONTWAIT)
    }
    /// sys.zig:2205 — `MSG_DONTWAIT | MSG_NOSIGNAL` so a broken-pipe write
    /// returns EPIPE instead of raising SIGPIPE.
    pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        send(fd, buf, SEND_FLAGS_NONBLOCK)
    }
    #[cfg(unix)]
    pub const MSG_DONTWAIT: i32 = libc::MSG_DONTWAIT;
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub const SEND_FLAGS_NONBLOCK: i32 = libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL;
    // macOS has no MSG_NOSIGNAL; SO_NOSIGPIPE on the socket is the equivalent
    // (set in `socketpair` below). Just MSG_DONTWAIT here.
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "freebsd"))))]
    pub const SEND_FLAGS_NONBLOCK: i32 = libc::MSG_DONTWAIT;
    /// sys.zig:3138 `socketpairImpl` — Linux uses `SOCK_CLOEXEC|SOCK_NONBLOCK`
    /// type flags; non-Linux sets CLOEXEC + nonblock + (Darwin) `SO_NOSIGPIPE`
    /// per-fd, closing both on any post-step error.
    pub fn socketpair(domain: i32, ty: i32, proto: i32, nonblock: bool) -> Maybe<[Fd; 2]> {
        let mut fds = [0i32; 2];
        #[cfg(target_os = "linux")]
        {
            let ty = ty | libc::SOCK_CLOEXEC | if nonblock { libc::SOCK_NONBLOCK } else { 0 };
            check!(unsafe { libc::socketpair(domain, ty, proto, fds.as_mut_ptr()) }, Tag::socketpair);
        }
        #[cfg(not(target_os = "linux"))]
        {
            check!(unsafe { libc::socketpair(domain, ty, proto, fds.as_mut_ptr()) }, Tag::socketpair);
            let close_both = |e| {
                unsafe { libc::close(fds[0]); libc::close(fds[1]); }
                Err::<[Fd; 2], _>(Error::from_code_int(e, Tag::socketpair))
            };
            for &fd in &fds {
                // CLOEXEC
                if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
                    return close_both(last_errno());
                }
                // O_NONBLOCK via GETFL→OR→SETFL (don't clobber existing flags).
                if nonblock {
                    let fl = unsafe { libc::fcntl(fd, libc::F_GETFL) };
                    if fl < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, fl | libc::O_NONBLOCK) } < 0 {
                        return close_both(last_errno());
                    }
                }
                // Darwin: SO_NOSIGPIPE so writes return EPIPE instead of SIGPIPE.
                #[cfg(target_os = "macos")]
                {
                    let on: libc::c_int = 1;
                    if unsafe {
                        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_NOSIGPIPE,
                            (&on as *const i32).cast(), core::mem::size_of::<i32>() as u32)
                    } < 0 {
                        return close_both(last_errno());
                    }
                }
            }
        }
        Ok([Fd::from_native(fds[0]), Fd::from_native(fds[1])])
    }

    // ── B-2 round 9: macOS clonefile / copyfile ──
    #[cfg(target_os = "macos")]
    mod darwin_copy {
        use super::*;
        unsafe extern "C" {
            fn clonefile(src: *const i8, dst: *const i8, flags: u32) -> i32;
            fn clonefileat(src_dir: i32, src: *const i8, dst_dir: i32, dst: *const i8, flags: u32) -> i32;
            fn copyfile(from: *const i8, to: *const i8, state: *mut core::ffi::c_void, flags: u32) -> i32;
            fn fcopyfile(from: i32, to: i32, state: *mut core::ffi::c_void, flags: u32) -> i32;
        }
        pub fn clonefile_(from: &ZStr, to: &ZStr) -> Maybe<()> {
            check_p!(unsafe { clonefile(from.as_ptr(), to.as_ptr(), 0) }, Tag::clonefile, from); Ok(())
        }
        pub fn clonefileat_(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
            check_p!(
                unsafe { clonefileat(from_dir.native(), from.as_ptr(), to_dir.native(), to.as_ptr(), 0) },
                Tag::clonefile, from
            );
            Ok(())
        }
        pub fn copyfile_(from: &ZStr, to: &ZStr, flags: u32) -> Maybe<()> {
            check_p!(unsafe { copyfile(from.as_ptr(), to.as_ptr(), core::ptr::null_mut(), flags) }, Tag::copyfile, from);
            Ok(())
        }
        pub fn fcopyfile_(from: Fd, to: Fd, flags: u32) -> Maybe<()> {
            check!(unsafe { fcopyfile(from.native(), to.native(), core::ptr::null_mut(), flags) }, Tag::fcopyfile);
            Ok(())
        }
    }
    #[cfg(target_os = "macos")]
    pub use darwin_copy::{clonefile_ as clonefile, clonefileat_ as clonefileat, copyfile_ as copyfile, fcopyfile_ as fcopyfile};

    // ── B-2 round 9: mmap/munmap ──
    pub fn mmap(addr: *mut u8, len: usize, prot: i32, flags: i32, fd: Fd, off: i64) -> Maybe<*mut u8> {
        let p = unsafe { libc::mmap(addr.cast(), len, prot, flags, fd.native(), off) };
        if p == libc::MAP_FAILED { return Err(err_with(Tag::mmap)); }
        Ok(p.cast())
    }
    pub fn munmap(ptr: *mut u8, len: usize) -> Maybe<()> {
        check!(unsafe { libc::munmap(ptr.cast(), len) }, Tag::munmap); Ok(())
    }

    /// sys.zig:504 — `sendfile(src, dest, len)`. Clamps `len` (avoid EINVAL on
    /// >2GB) and EINTR-retries via `check!`.
    #[cfg(target_os = "linux")]
    pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Maybe<usize> {
        let len = len.min(i32::MAX as usize - 1);
        let n = check!(
            unsafe { libc::sendfile(dest.native(), src.native(), core::ptr::null_mut(), len) },
            Tag::sendfile
        );
        Ok(n as usize)
    }
    #[cfg(target_os = "macos")]
    pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Maybe<usize> {
        let mut wrote = len.min(i32::MAX as usize - 1) as i64;
        loop {
            let rc = unsafe {
                libc::sendfile(src.native(), dest.native(), 0, &mut wrote, core::ptr::null_mut(), 0)
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                if e != libc::EAGAIN { return Err(Error::from_code_int(e, Tag::sendfile)); }
            }
            return Ok(wrote as usize);
        }
    }
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
    pub fn sendfile(_src: Fd, _dest: Fd, _len: usize) -> Maybe<usize> {
        Err(Error::from_code_int(libc::ENOSYS, Tag::sendfile))
    }
}
#[cfg(unix)]
pub use posix_impl::*;

/// `bun.jsc.Node.TimeLike` — `timespec` shape, decoupled from JSC (T6).
/// sys.zig takes this for futimens/utimens; the JSC binding constructs it from
/// JS Date/number. T1 owns the data shape.
#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]
pub struct TimeLike {
    pub sec: i64,
    pub nsec: i64,
}
impl TimeLike {
    pub const NOW: Self = Self { sec: 0, nsec: UTIME_NOW };
    pub const OMIT: Self = Self { sec: 0, nsec: UTIME_OMIT };
    #[inline]
    pub fn to_timespec(self) -> libc::timespec {
        libc::timespec { tv_sec: self.sec as _, tv_nsec: self.nsec as _ }
    }
}
#[cfg(unix)]
pub const UTIME_NOW: i64 = libc::UTIME_NOW as i64;
#[cfg(unix)]
pub const UTIME_OMIT: i64 = libc::UTIME_OMIT as i64;
#[cfg(windows)]
pub const UTIME_NOW: i64 = -1;
#[cfg(windows)]
pub const UTIME_OMIT: i64 = -2;

#[cfg(windows)]
mod windows_impl {
    // TODO(b2-windows): NT/kernel32/libuv triad in `lib_draft_b1.rs`.
    use super::*;
    macro_rules! stub {
        ($($vis:vis fn $name:ident($($p:ident : $t:ty),* $(,)?) -> $ret:ty;)+) => {
            $($vis fn $name($($p: $t),*) -> $ret { todo!(concat!("bun_sys::", stringify!($name), " — windows")) })+
        };
    }
    stub! {
        pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd>;
        pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd>;
        pub fn close(fd: Fd) -> Maybe<()>;
        pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize>;
        pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize>;
        pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize>;
        pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize>;
        pub fn stat(path: &ZStr) -> Maybe<Stat>;
        pub fn fstat(fd: Fd) -> Maybe<Stat>;
        pub fn lstat(path: &ZStr) -> Maybe<Stat>;
        pub fn mkdir(path: &ZStr, mode: Mode) -> Maybe<()>;
        pub fn unlink(path: &ZStr) -> Maybe<()>;
        pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()>;
        pub fn symlink(target: &ZStr, link: &ZStr) -> Maybe<()>;
        pub fn readlink(path: &ZStr, buf: &mut [u8]) -> Maybe<usize>;
        pub fn dup(fd: Fd) -> Maybe<Fd>;
        pub fn fchmod(fd: Fd, mode: Mode) -> Maybe<()>;
        pub fn fchown(fd: Fd, uid: u32, gid: u32) -> Maybe<()>;
        pub fn ftruncate(fd: Fd, len: i64) -> Maybe<()>;
        pub fn getcwd(buf: &mut [u8]) -> Maybe<usize>;
        pub fn page_size() -> usize;
        pub fn mkdirat(dir: Fd, path: &ZStr, mode: Mode) -> Maybe<()>;
        pub fn renameat(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()>;
        pub fn unlinkat(dir: Fd, path: &ZStr, flags: i32) -> Maybe<()>;
        pub fn mkdir_recursive_at(dir: Fd, sub: &[u8]) -> Maybe<()>;
        pub fn link(src: &ZStr, dest: &ZStr) -> Maybe<()>;
        pub fn linkat(src_dir: Fd, src: &ZStr, dest_dir: Fd, dest: &ZStr) -> Maybe<()>;
        pub fn linkat_tmpfile(tmpfd: Fd, dirfd: Fd, name: &ZStr) -> Maybe<()>;
        pub fn symlinkat(target: &ZStr, dirfd: Fd, dest: &ZStr) -> Maybe<()>;
        pub fn readlinkat(fd: Fd, path: &ZStr, buf: &mut [u8]) -> Maybe<usize>;
        pub fn chmod(path: &ZStr, mode: Mode) -> Maybe<()>;
        pub fn fchmodat(dir: Fd, path: &ZStr, mode: Mode, flags: i32) -> Maybe<()>;
        pub fn lchmod(path: &ZStr, mode: Mode) -> Maybe<()>;
        pub fn chown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()>;
        pub fn lchown(path: &ZStr, uid: u32, gid: u32) -> Maybe<()>;
        pub fn fchownat(dir: Fd, path: &ZStr, uid: u32, gid: u32, flags: i32) -> Maybe<()>;
        pub fn fstatat(fd: Fd, path: &ZStr) -> Maybe<Stat>;
        pub fn access(path: &ZStr, mode: i32) -> Maybe<()>;
        pub fn faccessat(dir: Fd, sub: &ZStr) -> Maybe<bool>;
        pub fn futimens(fd: Fd, atime: TimeLike, mtime: TimeLike) -> Maybe<()>;
        pub fn utimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()>;
        pub fn lutimens(path: &ZStr, atime: TimeLike, mtime: TimeLike) -> Maybe<()>;
        pub fn exists_z(path: &ZStr) -> bool;
        pub fn exists_at(dir: Fd, sub: &ZStr) -> bool;
        pub fn is_executable_file_path(path: &ZStr) -> bool;
        pub fn get_file_size(fd: Fd) -> Maybe<u64>;
        pub fn realpath<'a>(path: &ZStr, buf: &'a mut bun_core::PathBuffer) -> Maybe<&'a [u8]>;
        pub fn fcntl(fd: Fd, cmd: i32, arg: isize) -> Maybe<isize>;
        pub fn dup2(old: Fd, new: Fd) -> Maybe<Fd>;
        pub fn pipe() -> Maybe<[Fd; 2]>;
        pub fn isatty(fd: Fd) -> bool;
        pub fn fsync(fd: Fd) -> Maybe<()>;
        pub fn fdatasync(fd: Fd) -> Maybe<()>;
        pub fn lseek(fd: Fd, offset: i64, whence: i32) -> Maybe<i64>;
        pub fn chdir(path: &ZStr) -> Maybe<()>;
        pub fn fchdir(fd: Fd) -> Maybe<()>;
        pub fn umask(mode: Mode) -> Mode;
        pub fn recv(fd: Fd, buf: &mut [u8], flags: i32) -> Maybe<usize>;
        pub fn send(fd: Fd, buf: &[u8], flags: i32) -> Maybe<usize>;
        pub fn recv_non_block(fd: Fd, buf: &mut [u8]) -> Maybe<usize>;
        pub fn send_non_block(fd: Fd, buf: &[u8]) -> Maybe<usize>;
        pub fn socketpair(domain: i32, ty: i32, proto: i32, nonblock: bool) -> Maybe<[Fd; 2]>;
        pub fn mmap(addr: *mut u8, len: usize, prot: i32, flags: i32, fd: Fd, off: i64) -> Maybe<*mut u8>;
        pub fn munmap(ptr: *mut u8, len: usize) -> Maybe<()>;
        pub fn sendfile(src: Fd, dest: Fd, len: usize) -> Maybe<usize>;
    }
    pub type FcntlInt = isize;
    pub const MSG_DONTWAIT: i32 = 0;
    pub const SEND_FLAGS_NONBLOCK: i32 = 0;
}
#[cfg(windows)]
pub use windows_impl::*;

// `File` high-level helpers — wrap the syscall surface above.
impl File {
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        open(path, flags, mode).map(Self::from_fd)
    }
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        openat(dir, path, flags, mode).map(Self::from_fd)
    }
    /// snake_case alias (Zig: `File.openat`).
    #[inline]
    pub fn open_at(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        Self::openat(dir, path, flags, mode)
    }
    /// `std.fs.cwd().createFile(path, .{ .truncate })` replacement.
    pub fn create(dir: Fd, path: &[u8], truncate: bool) -> Maybe<Self> {
        let flags = O::WRONLY | O::CREAT | O::CLOEXEC | if truncate { O::TRUNC } else { 0 };
        openat_a(dir, path, flags, 0o666).map(Self::from_fd)
    }
    pub fn read(&self, buf: &mut [u8]) -> Maybe<usize> { read(self.handle, buf) }
    pub fn write(&self, buf: &[u8]) -> Maybe<usize> { write(self.handle, buf) }
    pub fn write_all(&self, mut buf: &[u8]) -> Maybe<()> {
        while !buf.is_empty() {
            let n = write(self.handle, buf)?;
            // File.zig:118-133 — `if (amt == 0) return .success;` (matches Zig).
            if n == 0 { return Ok(()); }
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
            if n == 0 { break; }
            rest = &mut rest[n..];
            total_read += n;
        }
        Ok(total_read)
    }
    /// Growable-`Vec` variant (was previously misnamed `read_all`). Kept for
    /// callers that want cursor-relative streaming into an existing `Vec`.
    pub fn read_to_end_into(&self, buf: &mut Vec<u8>) -> Maybe<usize> {
        let start = buf.len();
        loop {
            if buf.capacity() == buf.len() { buf.reserve(8192); }
            let spare = buf.spare_capacity_mut();
            // SAFETY: read() writes initialized bytes; we set_len to exactly what was written.
            let n = read(self.handle, unsafe {
                core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast(), spare.len())
            })?;
            if n == 0 { return Ok(buf.len() - start); }
            unsafe { buf.set_len(buf.len() + n); }
        }
    }
    pub fn read_to_end(&self) -> Maybe<Vec<u8>> {
        let mut v = Vec::new();
        // File.zig `readToEnd` — fstat-presized, pread-from-0; not a cursor read.
        self.read_to_end_with_array_list(&mut v, SizeHint::UnknownSize)?;
        Ok(v)
    }
    /// `File.getEndPos()` — file size via fstat.
    pub fn get_end_pos(&self) -> Maybe<usize> {
        Ok(fstat(self.handle)?.st_size as usize)
    }
    /// `File.readToEndWithArrayList(buf, hint)` — like `read_all` but takes a
    /// `SizeHint` so callers can pre-reserve. Returns the borrowed slice.
    pub fn read_to_end_with_array_list<'a>(&self, buf: &'a mut Vec<u8>, hint: SizeHint) -> Maybe<&'a [u8]> {
        // File.zig:298 — `probably_small` reserves 64; `unknown_size` fstats and
        // reserves `size+16`.
        match hint {
            SizeHint::ProbablySmall => buf.reserve(64),
            SizeHint::UnknownSize => {
                let size = self.get_end_pos()?;
                if buf.capacity() < size + 16 {
                    buf.reserve(size + 16 - buf.len());
                }
            }
        }
        let start = buf.len();
        let mut total: i64 = 0;
        loop {
            if buf.capacity() == buf.len() { buf.reserve(16); }
            let spare = buf.spare_capacity_mut();
            // SAFETY: pread()/read() write initialized bytes; we set_len to exactly what was written.
            let dst = unsafe {
                core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u8>(), spare.len())
            };
            #[cfg(unix)]
            let n = pread(self.handle, dst, total)?;
            #[cfg(not(unix))]
            let n = read(self.handle, dst)?;
            if n == 0 { break; }
            // SAFETY: `n` bytes were just initialized by the syscall.
            unsafe { buf.set_len(buf.len() + n); }
            total += n as i64;
        }
        Ok(&buf[start..])
    }
    pub fn pwrite_all(&self, mut buf: &[u8], mut off: i64) -> Maybe<()> {
        while !buf.is_empty() {
            let n = pwrite(self.handle, buf, off)?;
            if n == 0 { return Ok(()); }
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
            if n == 0 { break; }
            total += n;
            off += n as i64;
        }
        Ok(total)
    }
    /// `std.fs.File.seekTo` — `lseek(SEEK_SET)`.
    #[inline]
    pub fn seek_to(&self, offset: u64) -> Maybe<()> {
        set_file_offset(self.handle, offset)
    }
    pub fn stat(&self) -> Maybe<Stat> { fstat(self.handle) }
    pub fn close(self) -> Maybe<()> { close(self.handle) }
    /// `bun.sys.File.readFrom` — open + read + close.
    pub fn read_from(dir: Fd, path: &ZStr) -> Maybe<Vec<u8>> {
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        // File.zig: closes the fd on the error path too (no leak on read failure).
        let v = f.read_to_end();
        let _ = close(f.handle);
        v
    }
    /// `bun.sys.File.writeFile` — open + write + close.
    pub fn write_file(dir: Fd, path: &ZStr, data: &[u8]) -> Maybe<()> {
        // File.zig:141 — mode 0o664; `defer file.close()` (close on all paths).
        let f = Self::openat(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
        let r = f.write_all(data);
        let _ = close(f.handle);
        r
    }
    /// `File.bufferedWriter()` — `std.io.BufferedWriter` wrapping this fd.
    pub fn buffered_writer(&self) -> std::io::BufWriter<FileWriter> {
        std::io::BufWriter::new(FileWriter(self.handle))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun.PlatformIOVecConst` / `bun.platformIOVecConstCreate` — POSIX
// `iovec_const` (= `struct iovec` with the writev contract that `base` is
// not written through). On Windows the Zig original aliases `uv_buf_t`;
// that arm lands with the libuv triad in `lib_draft_b1.rs`.
// Layout matches `libc::iovec` (`{ *void, usize }`) so a `&[PlatformIoVecConst]`
// can be passed straight to `pwritev(2)`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PlatformIoVecConst {
    pub base: *const u8,
    pub len: usize,
}
#[cfg(unix)]
const _: () = assert!(
    core::mem::size_of::<PlatformIoVecConst>() == core::mem::size_of::<libc::iovec>()
        && core::mem::align_of::<PlatformIoVecConst>() == core::mem::align_of::<libc::iovec>()
);

#[inline]
pub fn platform_iovec_const_create(buf: &[u8]) -> PlatformIoVecConst {
    PlatformIoVecConst { base: buf.as_ptr(), len: buf.len() }
}

/// `bun.sys.pwritev` — gather-write at `offset`. Returns bytes written
/// (may be less than the sum of `vecs` lengths on a short write).
pub fn pwritev(fd: Fd, vecs: &[PlatformIoVecConst], offset: i64) -> Maybe<usize> {
    #[cfg(unix)]
    {
        // SAFETY: `PlatformIoVecConst` is layout-compatible with `libc::iovec`
        // (asserted above); `pwritev(2)` only reads through `iov_base`.
        loop {
            let rc = unsafe {
                libc::pwritev(
                    fd.native(),
                    vecs.as_ptr().cast::<libc::iovec>(),
                    vecs.len() as core::ffi::c_int,
                    offset,
                )
            };
            if rc < 0 {
                let e = last_errno();
                if e == libc::EINTR { continue; }
                return Err(Error::from_code_int(e, Tag::pwrite));
            }
            return Ok(rc as usize);
        }
    }
    #[cfg(not(unix))]
    {
        // TODO(b2-windows): route through `uv_fs_write` with `uv_buf_t[]`.
        let _ = (fd, vecs, offset);
        Err(Error::from_code_int(libc::ENOSYS, Tag::pwrite))
    }
}

/// `std::io::Write` adapter for `Fd` (used by `File::buffered_writer`).
pub struct FileWriter(pub Fd);
impl std::io::Write for FileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        write(self.0, buf).map_err(|e| std::io::Error::from_raw_os_error(e.errno as i32))
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — additional surface unblocked for dependents.
// Symbols are real posix wrappers (sys.zig posix arms 1:1); Windows arms stay
// `todo!()` until the NT/kernel32/libuv triad in `lib_draft_b1.rs` lands.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.sys.Error.Int` — backing integer for `errno`.
pub type ErrorInt = error::Int;
/// `std.posix.E` — un-prefixed errno enum (`.SUCCESS`, `.AGAIN`, ...).
/// PORT NOTE: aliased to `bun_errno::E` (= `SystemErrno`); variants currently
/// keep the `E` prefix (`EAGAIN` not `AGAIN`). Unprefixed associated consts
/// live on `SystemErrno` directly (errno crate); callers comparing against
/// `Errno::AGAIN`/`Errno::EXIST` rely on those.
pub type Errno = E;

/// `bun.sys.File.SizeHint` — pre-reserve hint for `read_to_end_with_array_list`.
/// Mirrors Zig's `enum { probably_small, unknown_size }` (File.zig:298).
#[derive(Clone, Copy, Debug)]
pub enum SizeHint {
    /// Reserve a small fixed buffer (64B).
    ProbablySmall,
    /// `fstat()` the fd to pre-size the buffer.
    UnknownSize,
}

/// `std.process.EnvMap` — owned `KEY → VALUE` map of environment variables.
/// Minimal real def (no Zig hash-map semantics needed; Rust callers iterate).
pub type EnvMap = std::collections::HashMap<String, String>;

/// `bun.sys.syslog` — debug-scoped log under `SYS` (Zig: `Output.scoped(.SYS)`).
/// PORT NOTE: `bun_core::scoped_log!` only accepts a bare ident for the scope,
/// so we re-expand its body here with the qualified `$crate::fd::SYS` path.
#[macro_export]
macro_rules! syslog {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        if cfg!(feature = "debug_logs") && $crate::fd::SYS.is_visible() {
            $crate::fd::SYS.log(
                ::core::format_args!($fmt $(, $arg)*),
            );
        }
    };
}

// ── `bun.c` — raw libc surface (no `Maybe` wrapping). ──
pub mod c {
    use core::ffi::{c_char, c_int, c_void};
    pub use libc::stat as Stat;
    pub use libc::{fchmod, memcmp};

    /// libc `dlsym` (RTLD_DEFAULT when `handle` is null).
    #[cfg(unix)]
    pub unsafe fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void {
        unsafe { libc::dlsym(handle, name) }
    }
    #[cfg(unix)]
    pub use libc::memmem;
    /// libc `__errno_location()` / `__error()` — pointer to thread-local errno.
    #[inline]
    pub unsafe fn errno_location() -> *mut c_int { unsafe { super::errno_ptr() } }

    /// `bun.c.kevent` — raw BSD kqueue event syscall (Darwin/FreeBSD only).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub unsafe fn kevent(
        kq: c_int,
        changelist: *const libc::kevent,
        nchanges: c_int,
        eventlist: *mut libc::kevent,
        nevents: c_int,
        timeout: *const libc::timespec,
    ) -> c_int {
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }

    /// Darwin `sendfile(fd, s, off, *len, *hdtr, flags)`.
    #[cfg(target_os = "macos")]
    pub unsafe fn sendfile(
        fd: c_int, s: c_int, off: i64, len: *mut i64,
        hdtr: *mut c_void, flags: c_int,
    ) -> c_int {
        unsafe { libc::sendfile(fd, s, off, len, hdtr.cast(), flags) }
    }
    /// FreeBSD `sendfile(fd, s, off, nbytes, *hdtr, *sbytes, flags)`.
    #[cfg(target_os = "freebsd")]
    pub unsafe fn sendfile(
        fd: c_int, s: c_int, off: i64, nbytes: usize,
        hdtr: *mut c_void, sbytes: *mut i64, flags: c_int,
    ) -> c_int {
        unsafe { libc::sendfile(fd, s, off, nbytes, hdtr.cast(), sbytes, flags) }
    }

    /// `bun.c.dlsymWithHandle` — see macro `dlsym_with_handle!` for the cached
    /// per-symbol form. This is the uncached runtime variant.
    pub unsafe fn dlsym_with_handle(handle: *mut c_void, name: *const c_char) -> *mut c_void {
        #[cfg(unix)] { unsafe { libc::dlsym(handle, name) } }
        #[cfg(windows)] { unsafe { core::ptr::null_mut() } /* GetProcAddress in windows mod */ }
    }

    /// `fork(2)` — POSIX only.
    #[cfg(unix)]
    #[inline] pub unsafe fn fork() -> libc::pid_t { unsafe { libc::fork() } }

    // ── Darwin libproc — process introspection (`<libproc.h>`). ──
    /// `struct proc_bsdinfo` (PROC_PIDTBSDINFO flavour). Fields match the SDK
    /// header; only `pbi_ppid` is currently consumed.
    #[cfg(target_os = "macos")]
    #[repr(C)]
    pub struct struct_proc_bsdinfo {
        pub pbi_flags: u32,
        pub pbi_status: u32,
        pub pbi_xstatus: u32,
        pub pbi_pid: u32,
        pub pbi_ppid: u32,
        pub pbi_uid: u32,
        pub pbi_gid: u32,
        pub pbi_ruid: u32,
        pub pbi_rgid: u32,
        pub pbi_svuid: u32,
        pub pbi_svgid: u32,
        pub rfu_1: u32,
        pub pbi_comm: [u8; 16],
        pub pbi_name: [u8; 32],
        pub pbi_nfiles: u32,
        pub pbi_pgid: u32,
        pub pbi_pjobc: u32,
        pub e_tdev: u32,
        pub e_tpgid: u32,
        pub pbi_nice: i32,
        pub pbi_start_tvsec: u64,
        pub pbi_start_tvusec: u64,
    }
    #[cfg(target_os = "macos")]
    pub const PROC_PIDTBSDINFO: c_int = 3;
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        /// `proc_pidinfo(pid, flavor, arg, buffer, buffersize)` — bytes written or ≤0.
        pub fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, buffersize: c_int) -> c_int;
        /// `proc_listchildpids(ppid, buffer, buffersize)` — count of pids written.
        pub fn proc_listchildpids(ppid: c_int, buffer: *mut c_void, buffersize: c_int) -> c_int;
    }
}

// ── `bun.linux` / `std.os.linux` — raw kernel syscalls (Linux only). ──
#[cfg(target_os = "linux")]
pub mod linux {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    pub use libc::pollfd;
    pub use libc::epoll_event;

    /// `std.os.linux.timespec` — Zig-shape (`sec`/`nsec`, no `tv_` prefix).
    /// Layout-identical to `libc::timespec` so a `*const timespec` can be
    /// passed straight to `syscall(SYS_futex, ..)`.
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct timespec {
        pub sec: libc::time_t,
        pub nsec: libc::c_long,
    }

    /// `std.os.linux.E` — errno; aliased to `bun_errno::E`.
    pub type Errno = super::E;
    #[inline] pub fn errno() -> c_int { super::last_errno() }

    /// `std.os.linux.E` — kernel errno enum with unprefixed variants and
    /// `init(rc)` decoding the `-errno`-in-return-value Linux raw-syscall ABI.
    /// Newtype (not an alias of `bun_errno::E`) because callers match on
    /// `E::AGAIN`/`E::INTR` (no `E` prefix).
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct E(pub u16);
    impl E {
        pub const SUCCESS:  E = E(0);
        pub const PERM:     E = E(libc::EPERM as u16);
        pub const NOENT:    E = E(libc::ENOENT as u16);
        pub const INTR:     E = E(libc::EINTR as u16);
        pub const AGAIN:    E = E(libc::EAGAIN as u16);
        pub const NOMEM:    E = E(libc::ENOMEM as u16);
        pub const FAULT:    E = E(libc::EFAULT as u16);
        pub const INVAL:    E = E(libc::EINVAL as u16);
        pub const NOSYS:    E = E(libc::ENOSYS as u16);
        pub const TIMEDOUT: E = E(libc::ETIMEDOUT as u16);
        /// Decode a raw Linux syscall return (`-errno` on failure, ≥0 on success).
        #[inline]
        pub fn init(rc: isize) -> E {
            // Zig: `if (rc > -4096) @enumFromInt(-rc) else .SUCCESS`.
            let u = rc as usize;
            if u > (-4096isize) as usize { E((u.wrapping_neg()) as u16) } else { E::SUCCESS }
        }
    }
    impl From<E> for &'static str {
        fn from(e: E) -> &'static str {
            bun_errno::SystemErrno::init(e.0 as i64).map(<&str>::from).unwrap_or("UNKNOWN")
        }
    }

    // ── epoll ──
    /// `std.os.linux.EPOLL` — flag/op constants. Exposed both as a module
    /// (`linux::EPOLL::IN`) and flat (`linux::EPOLL_IN`) since callers use both.
    pub mod EPOLL {
        pub const IN:      u32 = libc::EPOLLIN as u32;
        pub const OUT:     u32 = libc::EPOLLOUT as u32;
        pub const ERR:     u32 = libc::EPOLLERR as u32;
        pub const HUP:     u32 = libc::EPOLLHUP as u32;
        pub const RDHUP:   u32 = libc::EPOLLRDHUP as u32;
        pub const ET:      u32 = libc::EPOLLET as u32;
        pub const ONESHOT: u32 = libc::EPOLLONESHOT as u32;
        pub const CTL_ADD: i32 = libc::EPOLL_CTL_ADD;
        pub const CTL_MOD: i32 = libc::EPOLL_CTL_MOD;
        pub const CTL_DEL: i32 = libc::EPOLL_CTL_DEL;
    }
    pub const EPOLL_IN:      u32 = EPOLL::IN;
    pub const EPOLL_OUT:     u32 = EPOLL::OUT;
    pub const EPOLL_ERR:     u32 = EPOLL::ERR;
    pub const EPOLL_HUP:     u32 = EPOLL::HUP;
    pub const EPOLL_RDHUP:   u32 = EPOLL::RDHUP;
    pub const EPOLL_ET:      u32 = EPOLL::ET;
    pub const EPOLL_ONESHOT: u32 = EPOLL::ONESHOT;
    pub const EPOLL_CTL_ADD: i32 = EPOLL::CTL_ADD;
    pub const EPOLL_CTL_MOD: i32 = EPOLL::CTL_MOD;
    pub const EPOLL_CTL_DEL: i32 = EPOLL::CTL_DEL;

    // ── futex ──
    /// `std.os.linux.FUTEX` op (cmd + private flag), packed as Zig does.
    #[derive(Clone, Copy)]
    pub struct FutexOp { pub cmd: FutexCmd, pub private: bool }
    impl FutexOp {
        #[inline] fn raw(self) -> c_int {
            self.cmd as c_int | if self.private { libc::FUTEX_PRIVATE_FLAG } else { 0 }
        }
    }
    #[derive(Clone, Copy)] #[repr(i32)]
    pub enum FutexCmd {
        WAIT = libc::FUTEX_WAIT,
        WAKE = libc::FUTEX_WAKE,
        REQUEUE = libc::FUTEX_REQUEUE,
        WAIT_BITSET = libc::FUTEX_WAIT_BITSET,
        WAKE_BITSET = libc::FUTEX_WAKE_BITSET,
    }
    /// `syscall(SYS_futex, uaddr, op, val)` — 3-arg form (WAKE).
    /// Returns the raw kernel rc (decode with `E::init`).
    #[inline]
    pub unsafe fn futex_3arg(uaddr: *const u32, op: FutexOp, val: u32) -> isize {
        unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val) as isize }
    }
    /// `syscall(SYS_futex, uaddr, op, val, timeout)` — 4-arg form (WAIT).
    #[inline]
    pub unsafe fn futex_4arg(
        uaddr: *const u32, op: FutexOp, val: u32, timeout: *const timespec,
    ) -> isize {
        unsafe { libc::syscall(libc::SYS_futex, uaddr, op.raw(), val, timeout) as isize }
    }

    /// inotify mask flags (`std.os.linux.IN`).
    pub mod IN {
        pub const ACCESS: u32        = libc::IN_ACCESS;
        pub const MODIFY: u32        = libc::IN_MODIFY;
        pub const ATTRIB: u32        = libc::IN_ATTRIB;
        pub const CLOSE_WRITE: u32   = libc::IN_CLOSE_WRITE;
        pub const CLOSE_NOWRITE: u32 = libc::IN_CLOSE_NOWRITE;
        pub const OPEN: u32          = libc::IN_OPEN;
        pub const MOVED_FROM: u32    = libc::IN_MOVED_FROM;
        pub const MOVED_TO: u32      = libc::IN_MOVED_TO;
        pub const CREATE: u32        = libc::IN_CREATE;
        pub const DELETE: u32        = libc::IN_DELETE;
        pub const DELETE_SELF: u32   = libc::IN_DELETE_SELF;
        pub const MOVE_SELF: u32     = libc::IN_MOVE_SELF;
        pub const ONLYDIR: u32       = libc::IN_ONLYDIR;
        pub const DONT_FOLLOW: u32   = libc::IN_DONT_FOLLOW;
        pub const EXCL_UNLINK: u32   = libc::IN_EXCL_UNLINK;
        pub const MASK_ADD: u32      = libc::IN_MASK_ADD;
        pub const ISDIR: u32         = libc::IN_ISDIR;
        pub const ONESHOT: u32       = libc::IN_ONESHOT;
        pub const IGNORED: u32       = libc::IN_IGNORED;
        pub const CLOEXEC: c_int     = libc::IN_CLOEXEC;
        pub const NONBLOCK: c_int    = libc::IN_NONBLOCK;
        use core::ffi::c_int;
    }

    #[inline]
    pub unsafe fn inotify_init1(flags: c_int) -> c_int {
        unsafe { libc::inotify_init1(flags) }
    }
    #[inline]
    pub unsafe fn inotify_add_watch(fd: c_int, path: *const c_char, mask: u32) -> c_int {
        unsafe { libc::inotify_add_watch(fd, path, mask) }
    }
    #[inline]
    pub unsafe fn inotify_rm_watch(fd: c_int, wd: c_int) -> c_int {
        unsafe { libc::inotify_rm_watch(fd, wd) }
    }
    /// Raw `read(2)` returning kernel `usize` (Zig: `std.os.linux.read`).
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        unsafe { libc::read(fd, buf.cast(), count) }
    }
    /// Raw `sendfile(out, in, *offset, count)` (Zig: `std.os.linux.sendfile`).
    #[inline]
    pub unsafe fn sendfile(out_fd: c_int, in_fd: c_int, offset: *mut i64, count: usize) -> isize {
        unsafe { libc::sendfile(out_fd, in_fd, offset, count) }
    }
    /// Raw `ppoll(fds, nfds, *timeout, *sigmask)`.
    #[inline]
    pub unsafe fn ppoll(
        fds: *mut pollfd, nfds: usize,
        timeout: *const libc::timespec, sigmask: *const libc::sigset_t,
    ) -> c_int {
        unsafe { libc::ppoll(fds, nfds as _, timeout, sigmask) }
    }
    #[inline]
    pub unsafe fn epoll_ctl(epfd: c_int, op: c_int, fd: c_int, event: *mut epoll_event) -> c_int {
        unsafe { libc::epoll_ctl(epfd, op, fd, event) }
    }

    // ── `std.os.linux.*` syscall thunks ──
    // PORT NOTE: Zig's `std.os.linux.ioctl`/`copy_file_range` are *true* raw
    // syscalls returning the kernel `-errno`-in-`usize` ABI. glibc's
    // `libc::syscall()` is NOT — it returns `-1` and sets thread-local errno
    // on failure. Returning `isize` here routes callers through the
    // libc-convention `GetErrno for isize` impl (reads `errno`), instead of
    // the kernel-convention `GetErrno for usize` impl which would mis-decode
    // every failure as EPERM (`-1 as usize` → errno 1).

    /// `bun.linux.ioctl_ficlone` (platform/linux.zig:71): raw FICLONE ioctl.
    /// Support for FICLONE is dependent on the filesystem driver.
    #[inline]
    pub fn ioctl_ficlone(dest_fd: super::Fd, src_fd: super::Fd) -> isize {
        // FICLONE = _IOW(0x94, 9, c_int). Value matches Zig's `bun.c.FICLONE`.
        const FICLONE: libc::c_ulong = 0x40049409;
        // SAFETY: raw `ioctl(2)`; both fds owned by caller.
        unsafe {
            libc::syscall(libc::SYS_ioctl, dest_fd.native() as libc::c_long, FICLONE, src_fd.native() as libc::c_long) as isize
        }
    }

    /// `std.os.linux.copy_file_range` raw syscall.
    #[inline]
    pub unsafe fn copy_file_range(
        in_: c_int, off_in: *mut i64, out: c_int, off_out: *mut i64, len: usize, flags: u32,
    ) -> isize {
        // SAFETY: raw `copy_file_range(2)`; caller owns fds, offset ptrs may be null.
        unsafe {
            libc::syscall(
                libc::SYS_copy_file_range,
                in_ as libc::c_long, off_in, out as libc::c_long, off_out, len, flags as libc::c_long,
            ) as isize
        }
    }

    // `std.os.linux.sendfile` — use the existing `linux::sendfile` (libc
    // wrapper, isize return) defined above; `get_errno::<isize>` decodes it.

    /// `bun.linux.RWFFlagSupport` — runtime probe for `RWF_NOWAIT` (kernel ≥ 4.14).
    pub struct RWFFlagSupport;
    static RWF_STATE: core::sync::atomic::AtomicI8 = core::sync::atomic::AtomicI8::new(0);
    impl RWFFlagSupport {
        /// 0 = unknown, 1 = yes, -1 = no. On first call (unknown), checks for
        /// the buggy 5.9/5.10 kernels and the env-flag override before resolving.
        #[inline]
        pub fn is_maybe_supported() -> bool {
            match RWF_STATE.load(core::sync::atomic::Ordering::Relaxed) {
                0 => {
                    // platform/linux.zig:44 — kernels 5.9/5.10 have a buggy
                    // RWF_NOWAIT (returns EAGAIN spuriously); disable on those.
                    let v = bun_core::linux_kernel_version();
                    let buggy = v.major == 5 && (v.minor == 9 || v.minor == 10);
                    // BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK env override.
                    let env_off = bun_core::getenv_z(
                        bun_core::zstr!("BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK"),
                    ).is_some();
                    let r = if buggy || env_off { -1 } else { 1 };
                    RWF_STATE.store(r, core::sync::atomic::Ordering::Relaxed);
                    r > 0
                }
                s => s > 0,
            }
        }
        #[inline]
        pub fn disable() {
            RWF_STATE.store(-1, core::sync::atomic::Ordering::Relaxed);
        }
    }
}
#[cfg(not(target_os = "linux"))]
pub mod linux {
    // Empty on non-Linux; callers gate on `cfg(target_os = "linux")`.
}

// ── `bun.darwin` — Darwin-only platform surface. ──
#[cfg(target_os = "macos")]
pub mod darwin {
    use core::ffi::{c_char, c_void};
    use core::marker::{PhantomData, PhantomPinned};

    /// Opaque `os_log_t` handle (`<os/log.h>`).
    #[repr(C)]
    pub struct OSLog {
        _p: [u8; 0],
        _m: PhantomData<(*mut u8, PhantomPinned)>,
    }
    impl OSLog {
        /// `os_log_create("com.bun.bun", "PointsOfInterest")` — null on failure.
        pub fn init() -> Option<core::ptr::NonNull<OSLog>> {
            unsafe extern "C" {
                fn os_log_create(subsystem: *const c_char, category: *const c_char) -> *mut OSLog;
            }
            // SAFETY: static C-string literals.
            let p = unsafe { os_log_create(c"com.bun.bun".as_ptr(), c"PointsOfInterest".as_ptr()) };
            core::ptr::NonNull::new(p)
        }
        #[inline] pub fn as_ptr(&self) -> *const OSLog { self as *const _ }
        /// Full signpost API lives in `bun_platform::darwin`; this stub lets
        /// `bun_perf` compile its Darwin arm without pulling that crate up-tier.
        pub fn signpost(&self, name: i32) -> os_log::Signpost<'_> {
            os_log::Signpost { log: self, name }
        }
    }
    /// `std.c.EVFILT` — kqueue filter constants.
    pub mod EVFILT {
        pub const READ:   i16 = libc::EVFILT_READ;
        pub const WRITE:  i16 = libc::EVFILT_WRITE;
        pub const VNODE:  i16 = libc::EVFILT_VNODE;
        pub const PROC:   i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER:  i16 = libc::EVFILT_TIMER;
        pub const USER:   i16 = libc::EVFILT_USER;
        pub const MACHPORT: i16 = libc::EVFILT_MACHPORT;
    }
    /// `std.c.EV` — kqueue event flags (Darwin).
    pub mod EV {
        pub const ADD:      u16 = libc::EV_ADD;
        pub const DELETE:   u16 = libc::EV_DELETE;
        pub const ENABLE:   u16 = libc::EV_ENABLE;
        pub const DISABLE:  u16 = libc::EV_DISABLE;
        pub const ONESHOT:  u16 = libc::EV_ONESHOT;
        pub const CLEAR:    u16 = libc::EV_CLEAR;
        pub const RECEIPT:  u16 = libc::EV_RECEIPT;
        pub const DISPATCH: u16 = libc::EV_DISPATCH;
        pub const EOF:      u16 = libc::EV_EOF;
        pub const ERROR:    u16 = libc::EV_ERROR;
    }
    /// `std.c.NOTE` — kqueue fflags (Darwin).
    pub mod NOTE {
        pub const EXIT:       u32 = libc::NOTE_EXIT;
        pub const EXITSTATUS: u32 = libc::NOTE_EXITSTATUS;
        pub const SIGNAL:     u32 = libc::NOTE_SIGNAL;
        pub const FORK:       u32 = libc::NOTE_FORK;
        pub const EXEC:       u32 = libc::NOTE_EXEC;
        pub const TRIGGER:    u32 = libc::NOTE_TRIGGER;
        pub const DELETE:     u32 = libc::NOTE_DELETE;
        pub const WRITE:      u32 = libc::NOTE_WRITE;
        pub const EXTEND:     u32 = libc::NOTE_EXTEND;
        pub const ATTRIB:     u32 = libc::NOTE_ATTRIB;
        pub const LINK:       u32 = libc::NOTE_LINK;
        pub const RENAME:     u32 = libc::NOTE_RENAME;
        pub const REVOKE:     u32 = libc::NOTE_REVOKE;
    }
    /// Darwin `struct kevent64_s` (extended kevent with 2-slot `ext[]`).
    pub use libc::kevent64_s;
    /// `kevent64()` — Darwin's wider kevent. Thin re-export so callers don't
    /// need a direct `libc` dep.
    #[inline]
    pub unsafe fn kevent64(
        kq: core::ffi::c_int,
        changelist: *const kevent64_s, nchanges: core::ffi::c_int,
        eventlist: *mut kevent64_s, nevents: core::ffi::c_int,
        flags: core::ffi::c_uint, timeout: *const libc::timespec,
    ) -> core::ffi::c_int {
        unsafe { libc::kevent64(kq, changelist, nchanges, eventlist, nevents, flags, timeout) }
    }

    pub mod os_log {
        pub struct Signpost<'a> { pub log: &'a super::OSLog, pub name: i32 }
        impl<'a> Signpost<'a> {
            pub fn interval(&self, _cat: signpost::Category) -> signpost::Interval {
                signpost::Interval { _p: () }
            }
        }
        pub mod signpost {
            #[derive(Clone, Copy)] #[repr(u8)]
            pub enum Category { PointsOfInterest = 0 }
            pub struct Interval { pub(crate) _p: () }
            impl Interval { pub fn end(&self) {} }
        }
    }
}
#[cfg(not(target_os = "macos"))]
pub mod darwin {}

// ── `std.DynLib` — cross-platform dynamic library handle. ──
pub struct DynLib {
    handle: *mut c_void,
}
unsafe impl Send for DynLib {}
unsafe impl Sync for DynLib {}
impl DynLib {
    /// `dlopen(path, RTLD_LAZY)` / `LoadLibraryA(path)`.
    pub fn open(path: &[u8]) -> core::result::Result<Self, bun_core::Error> {
        let mut buf = bun_paths::PathBuffer::default();
        let len = path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), len) };
        match dlopen(z, RTLD::LAZY) {
            Some(h) => Ok(Self { handle: h }),
            None => Err(bun_core::err!("FileNotFound")),
        }
    }
    /// `dlsym` typed lookup.
    pub fn lookup<T>(&self, name: &ZStr) -> Option<T> {
        let p = dlsym_impl(Some(self.handle), name)?;
        // SAFETY: caller asserts `T` is a fn-pointer or `*mut c_void`-shaped type
        // matching the symbol's ABI (same as Zig `bun.cast(T, ptr)`).
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) })
    }
    pub fn close(self) {
        #[cfg(unix)]
        unsafe { libc::dlclose(self.handle); }
        // Windows: FreeLibrary via windows mod; intentionally leaked here
        // (Zig `DynLib.close` on Windows is a no-op in our usage).
    }
    #[inline] pub fn handle(&self) -> *mut c_void { self.handle }
}

/// `std.c.RTLD` flags for `dlopen`.
pub mod RTLD {
    pub const LAZY:   i32 = libc::RTLD_LAZY;
    pub const NOW:    i32 = libc::RTLD_NOW;
    pub const GLOBAL: i32 = libc::RTLD_GLOBAL;
    pub const LOCAL:  i32 = libc::RTLD_LOCAL;
}

/// sys.zig:4557 — `dlopen(filename, flags)`. Windows → `LoadLibraryA`.
pub fn dlopen(filename: &ZStr, flags: i32) -> Option<*mut c_void> {
    #[cfg(unix)] {
        // SAFETY: filename is NUL-terminated.
        let p = unsafe { libc::dlopen(filename.as_ptr(), flags) };
        if p.is_null() { None } else { Some(p) }
    }
    #[cfg(windows)] {
        let _ = flags;
        // SAFETY: filename is NUL-terminated.
        let p = unsafe { bun_windows_sys::externs::LoadLibraryA(filename.as_ptr()) };
        if p.is_null() { None } else { Some(p.cast()) }
    }
}
/// sys.zig:4565 — `dlsym(handle, name)`.
pub fn dlsym_impl(handle: Option<*mut c_void>, name: &ZStr) -> Option<*mut c_void> {
    #[cfg(unix)] {
        let h = handle.unwrap_or(core::ptr::null_mut());
        // SAFETY: name is NUL-terminated; dlsym accepts NULL handle as RTLD_DEFAULT.
        let p = unsafe { libc::dlsym(h, name.as_ptr()) };
        if p.is_null() { None } else { Some(p) }
    }
    #[cfg(windows)] {
        let _ = (handle, name);
        todo!("dlsym_impl windows: GetProcAddress")
    }
}
/// `bun.c.dlsymWithHandle` — once-cached typed lookup. The Zig version
/// monomorphises per `(Type, name, handle_getter)`; in Rust this is a macro.
#[macro_export]
macro_rules! dlsym_with_handle {
    ($T:ty, $name:literal, $handle:expr) => {{
        static ONCE: ::std::sync::Once = ::std::sync::Once::new();
        static mut PTR: *mut ::core::ffi::c_void = ::core::ptr::null_mut();
        ONCE.call_once(|| {
            if let Some(p) = $crate::dlsym_impl($handle, ::bun_core::zstr!($name)) {
                // SAFETY: only mutated once under Once.
                unsafe { PTR = p; }
            }
        });
        // SAFETY: read-only after Once; caller asserts `$T` is fn-ptr-shaped.
        let p = unsafe { PTR };
        if p.is_null() { None } else {
            Some(unsafe { ::core::mem::transmute_copy::<*mut ::core::ffi::c_void, $T>(&p) })
        }
    }};
}

// ── open helpers (sys.zig posix arms) ──

/// `openA` — like `open` but takes a non-NUL-terminated slice.
pub fn open_a(path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    openat_a(Fd::cwd(), path, flags, perm)
}
/// `openatA` — like `openat` but takes a non-NUL-terminated slice.
pub fn openat_a(dir: Fd, path: &[u8], flags: i32, perm: Mode) -> Maybe<Fd> {
    let mut buf = bun_paths::PathBuffer::default();
    if path.len() >= buf.0.len() {
        return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(path));
    }
    buf.0[..path.len()].copy_from_slice(path);
    buf.0[path.len()] = 0;
    // SAFETY: NUL-terminated above.
    let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), path.len()) };
    openat(dir, z, flags, perm)
}
/// `mkdiratZ` — `mkdirat` with already-NUL-terminated path. Same as `mkdirat`.
#[inline]
pub fn mkdirat_z(dir: Fd, path: &ZStr, mode: Mode) -> Maybe<()> {
    mkdirat(dir, path, mode)
}
/// bun.zig:879 `openDirA` — open a path as an iterable directory fd.
pub fn open_dir_at(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    openat_a(dir, path, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
}
/// bun.zig:890 `openDirAbsolute`. PORT NOTE: returns `Fd`, not `std.fs.Dir`.
pub fn open_dir_absolute(path: &[u8]) -> Maybe<Fd> {
    open_a(path, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
}
/// bun.zig:899 — Windows variant skips `DELETE` access; on POSIX identical.
pub fn open_dir_absolute_not_for_deleting_or_renaming(path: &[u8]) -> Maybe<Fd> {
    open_dir_absolute(path)
}
/// `openFileReadOnly` — `open(path, O_RDONLY|O_CLOEXEC)`.
pub fn open_file_read_only(path: &[u8]) -> Maybe<Fd> {
    open_a(path, O::RDONLY | O::CLOEXEC, 0)
}
/// `openatReadOnly` — `openat(dir, path, O_RDONLY|O_CLOEXEC)`.
pub fn openat_read_only(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    openat_a(dir, path, O::RDONLY | O::CLOEXEC, 0)
}
/// `openatWindows` — Windows-only NtCreateFile wrapper. On POSIX this is a
/// `@compileError`; provided as a stub so `#[cfg(windows)]` arms type-check.
#[cfg(windows)]
pub fn openat_windows(dir: Fd, path: &[u16], flags: i32, perm: Mode) -> Maybe<Fd> {
    let _ = (dir, path, flags, perm);
    todo!("b2-windows: openat_windows (NtCreateFile path in lib_draft_b1.rs)")
}

// ── existence checks ──

/// sys.zig:3447 — `access(path, F_OK) == 0`. `file_only` ignored on POSIX.
pub fn exists_os_path(path: &bun_paths::OSPathSliceZ, file_only: bool) -> bool {
    #[cfg(not(windows))] {
        let _ = file_only;
        // SAFETY: path is NUL-terminated.
        unsafe { libc::access(path.as_ptr().cast(), libc::F_OK) == 0 }
    }
    #[cfg(windows)] {
        let _ = (path, file_only);
        todo!("exists_os_path windows: GetFileAttributesW")
    }
}
/// sys.zig:3636 `ExistsAtType`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExistsAtType { File, Directory }
/// sys.zig:3640 — `fstatat` then `S_ISDIR`.
pub fn exists_at_type(dir: Fd, sub: &ZStr) -> Maybe<ExistsAtType> {
    #[cfg(unix)] {
        let st = fstatat(dir, sub)?;
        Ok(if S::ISDIR(st.st_mode as _) { ExistsAtType::Directory } else { ExistsAtType::File })
    }
    #[cfg(windows)] {
        let _ = (dir, sub);
        todo!("exists_at_type windows")
    }
}
/// sys.zig:3533 — `directoryExistsAt(dir, sub)`. ENOENT → `Ok(false)`.
pub fn directory_exists_at(dir: Fd, sub: &ZStr) -> Maybe<bool> {
    match exists_at_type(dir, sub) {
        Ok(t) => Ok(t == ExistsAtType::Directory),
        Err(e) if e.get_errno() == E::ENOENT => Ok(false),
        Err(e) => Err(e),
    }
}

// ── fcntl / nonblocking / dup ──

/// sys.zig:3599 — `fcntl(fd, F_GETFL, 0)`.
#[cfg(unix)]
pub fn get_fcntl_flags(fd: Fd) -> Maybe<FcntlInt> {
    fcntl(fd, libc::F_GETFL, 0)
}
#[cfg(windows)]
pub fn get_fcntl_flags(_fd: Fd) -> Maybe<FcntlInt> {
    Err(Error::from_code_int(libc::ENOSYS, Tag::fcntl))
}
/// sys.zig:3614.
#[inline]
pub fn set_nonblocking(fd: Fd) -> Maybe<()> { update_nonblocking(fd, true) }
/// sys.zig:3618 — GETFL → toggle O_NONBLOCK → SETFL (only if changed).
pub fn update_nonblocking(fd: Fd, nonblocking: bool) -> Maybe<()> {
    #[cfg(unix)] {
        let cur = get_fcntl_flags(fd)? as i32;
        let new = if nonblocking { cur | O::NONBLOCK } else { cur & !O::NONBLOCK };
        if new != cur { fcntl(fd, libc::F_SETFL, new as isize)?; }
        Ok(())
    }
    #[cfg(windows)] {
        let _ = (fd, nonblocking); Ok(())
    }
}
/// sys.zig:3873 — `fcntl(F_DUPFD_CLOEXEC)` (POSIX) / `DuplicateHandle` (Win).
/// `_flags` is ignored (Zig signature parity).
#[inline]
pub fn dup_with_flags(fd: Fd, _flags: i32) -> Maybe<Fd> { dup(fd) }

/// sys.zig:3788 — `lseek(fd, offset, SEEK_SET)`; result discarded.
pub fn set_file_offset(fd: Fd, offset: u64) -> Maybe<()> {
    lseek(fd, offset as i64, libc::SEEK_SET).map(|_| ())
}

// ── nonblocking read/write (preadv2/pwritev2 RWF_NOWAIT on Linux) ──

#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn sys_preadv2(fd: c_int, iov: *const libc::iovec, iovcnt: c_int, off: i64, flags: u32) -> isize;
    fn sys_pwritev2(fd: c_int, iov: *const libc::iovec, iovcnt: c_int, off: i64, flags: u32) -> isize;
}
#[cfg(target_os = "linux")]
const RWF_NOWAIT: u32 = 0x00000008;

/// sys.zig:4046 — Linux: `preadv2(.., RWF_NOWAIT)`; else plain `read`.
pub fn read_nonblocking(fd: Fd, buf: &mut [u8]) -> Maybe<usize> {
    #[cfg(target_os = "linux")]
    while linux::RWFFlagSupport::is_maybe_supported() {
        let iov = [libc::iovec { iov_base: buf.as_mut_ptr().cast(), iov_len: buf.len() }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_preadv2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc < 0 {
            let e = last_errno();
            match e {
                libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EACCES => {
                    linux::RWFFlagSupport::disable();
                    // sys.zig:4070 — only fall through to BLOCKING read if the fd is
                    // actually readable now; otherwise return retry (EAGAIN).
                    return match bun_core::is_readable(fd) {
                        bun_core::Pollable::Ready | bun_core::Pollable::Hup => read(fd, buf),
                        _ => Err(Error::retry().with_fd(fd)),
                    };
                }
                libc::EINTR => continue,
                _ => return Err(Error::from_code_int(e, Tag::read).with_fd(fd)),
            }
        }
        return Ok(rc as usize);
    }
    read(fd, buf)
}
/// sys.zig:4099 — Linux: `pwritev2(.., RWF_NOWAIT)`; else plain `write`.
pub fn write_nonblocking(fd: Fd, buf: &[u8]) -> Maybe<usize> {
    #[cfg(target_os = "linux")]
    while linux::RWFFlagSupport::is_maybe_supported() {
        let iov = [libc::iovec { iov_base: buf.as_ptr() as *mut _, iov_len: buf.len() }];
        // SAFETY: fd valid; iov points at a live stack array.
        let rc = unsafe { sys_pwritev2(fd.native(), iov.as_ptr(), 1, -1, RWF_NOWAIT) };
        if rc < 0 {
            let e = last_errno();
            match e {
                libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EACCES => {
                    linux::RWFFlagSupport::disable();
                    // sys.zig:4123 — poll before issuing a blocking write.
                    return match bun_core::is_writable(fd) {
                        bun_core::Pollable::Ready | bun_core::Pollable::Hup => write(fd, buf),
                        _ => {
                            let mut e = Error::retry();
                            e.syscall = Tag::write;
                            Err(e.with_fd(fd))
                        }
                    };
                }
                libc::EINTR => continue,
                _ => return Err(Error::from_code_int(e, Tag::write).with_fd(fd)),
            }
        }
        return Ok(rc as usize);
    }
    write(fd, buf)
}

/// sys.zig:4536 — `fallocate(fd, 0, offset, len)` on Linux, result discarded; no-op elsewhere.
pub fn preallocate_file(fd: FdNative, offset: i64, len: i64) -> core::result::Result<(), bun_core::Error> {
    #[cfg(target_os = "linux")] {
        // SAFETY: fd is a valid open descriptor owned by caller. Result intentionally
        // discarded (Zig: `_ = std.os.linux.fallocate(...)`) — preallocation is best-effort.
        let _ = unsafe { libc::fallocate(fd, 0, offset, len) };
    }
    let _ = (fd, offset, len);
    Ok(())
}

/// `kqueue()` — BSD kernel event queue (Darwin/FreeBSD only).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub fn kqueue() -> Maybe<Fd> {
    // SAFETY: kqueue(2) takes no args.
    let rc = unsafe { libc::kqueue() };
    if rc < 0 { return Err(err_with(Tag::kqueue)); }
    Ok(Fd::from_native(rc))
}

/// `clonefile` — macOS-only CoW copy. On non-Darwin returns ENOTSUP so
/// callers can fall back to `copy_file`.
#[cfg(not(target_os = "macos"))]
pub fn clonefile(from: &ZStr, to: &ZStr) -> Maybe<()> {
    Err(Error::from_code_int(libc::ENOTSUP, Tag::clonefile).with_path_dest(from.as_bytes(), to.as_bytes()))
}

// ── getFdPath ──

/// sys.zig:2940 — fd → absolute path. Linux: readlink `/proc/self/fd/N`;
/// macOS: `fcntl(F_GETPATH)`; Windows: `GetFinalPathNameByHandle`.
pub fn get_fd_path<'a>(fd: Fd, out: &'a mut bun_paths::PathBuffer) -> Maybe<&'a mut [u8]> {
    #[cfg(target_os = "linux")] {
        let mut proc = [0u8; 32];
        let n = {
            use std::io::Write as _;
            let mut c = std::io::Cursor::new(&mut proc[..]);
            let _ = write!(c, "/proc/self/fd/{}\0", fd.native());
            c.position() as usize - 1
        };
        // SAFETY: NUL written above.
        let z = unsafe { ZStr::from_raw(proc.as_ptr(), n) };
        let len = readlink(z, &mut out.0)?;
        return Ok(&mut out.0[..len]);
    }
    #[cfg(target_os = "macos")] {
        out.0.fill(0);
        fcntl(fd, libc::F_GETPATH, out.0.as_mut_ptr() as isize)?;
        // SAFETY: F_GETPATH writes a NUL-terminated string into `out`.
        let len = unsafe { libc::strlen(out.0.as_ptr().cast()) };
        return Ok(&mut out.0[..len]);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))] {
        let _ = (fd, out);
        Err(Error::from_code_int(libc::ENOSYS, Tag::readlink))
    }
}

// ── environ ──

/// `std.os.environ` — borrowed slice of `KEY=VALUE\0` C strings.
/// SAFETY note: the returned slice borrows the libc `environ` global; do not
/// mutate the environment concurrently.
pub fn environ() -> &'static [*const c_char] {
    #[cfg(unix)] {
        unsafe extern "C" { static mut environ: *const *const c_char; }
        // SAFETY: `environ` is a process-global NULL-terminated array.
        unsafe {
            let mut n = 0usize;
            let base = environ;
            if base.is_null() { return &[]; }
            while !(*base.add(n)).is_null() { n += 1; }
            core::slice::from_raw_parts(base, n)
        }
    }
    #[cfg(windows)] { &[] }
}

// ── moveFileZWithHandle (sys.zig:4266) ──

/// `renameat`; on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to copy-then-unlink. Port of `bun.sys.moveFileZWithHandle`.
pub fn move_file_z_with_handle(
    from_handle: Fd, from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr,
) -> core::result::Result<(), bun_core::Error> {
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe { libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR) };
            renameat(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            // Cross-device: full `copyFileZSlowWithHandle` (sys.zig:4305).
            let st = fstat(from_handle).map_err(bun_core::Error::from)?;
            // Unlink dest first — fixes ETXTBUSY on Linux.
            let _ = unlinkat(to_dir, destination, 0);
            let dst = openat(
                to_dir, destination,
                O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC, 0o644,
            ).map_err(bun_core::Error::from)?;
            #[cfg(target_os = "linux")] {
                // SAFETY: dst is a valid open fd; preallocation is best-effort.
                let _ = unsafe { libc::fallocate(dst.native(), 0, 0, st.st_size) };
            }
            // Seek input to 0 — caller may have left offset at EOF after writing.
            let _ = lseek(from_handle, 0, libc::SEEK_SET);
            let r = copy_file(from_handle, dst);
            // Preserve mode/owner (best-effort).
            // SAFETY: dst is a valid open fd.
            let _ = unsafe { libc::fchmod(dst.native(), st.st_mode) };
            let _ = unsafe { libc::fchown(dst.native(), st.st_uid, st.st_gid) };
            let _ = close(dst);
            r.map_err(bun_core::Error::from)?;
            let _ = unlinkat(from_dir, filename, 0);
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// `bun.sys.copyFile` — fd→fd full transfer using the best available kernel
/// fast path (ioctl_ficlone / copy_file_range / sendfile / read-write loop).
#[inline]
#[cfg(not(windows))]
pub fn copy_file(in_: Fd, out: Fd) -> Maybe<()> {
    copy_file::copy_file(in_, out)
}
#[cfg(windows)]
pub fn copy_file(in_: Fd, out: Fd) -> Maybe<()> {
    // Windows `bun.copyFile` takes paths, not fds; fd-based callers (e.g.
    // `move_file_z_with_handle`'s EXDEV fallback) get the read/write loop.
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = read(in_, &mut buf)?;
        if n == 0 { return Ok(()); }
        let mut wrote = 0;
        while wrote < n {
            let w = write(out, &buf[wrote..n])?;
            if w == 0 { return Err(Error::from_code_int(libc::EIO, Tag::write)); }
            wrote += w;
        }
    }
}

/// `bun.makePath` — free-fn form taking a `Dir` (Zig: `bun.makePath(dir, sub)`).
#[inline]
pub fn make_path(dir: Dir, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
    mkdir_recursive_at(dir.fd, sub_path).map_err(Into::into)
}
/// `bun.mkdirRecursive` — like `make_path` but cwd-relative, taking a slice.
#[inline]
pub fn mkdir_recursive(sub_path: &[u8]) -> Maybe<()> {
    mkdir_recursive_at(Fd::cwd(), sub_path)
}
/// bun.zig:2319 — Windows-only `makePath` over UTF-16. On POSIX, transcodes
/// to UTF-8 and delegates to `mkdir_recursive_at`.
pub fn make_path_w(dir: Fd, sub_path: &[u16]) -> Maybe<()> {
    #[cfg(windows)] {
        let _ = (dir, sub_path);
        todo!("b2-windows: make_path_w (CreateDirectoryW walk)")
    }
    #[cfg(not(windows))] {
        // PORT NOTE: simdutf utf16→utf8 in Zig; here we use a basic widening
        // since callers on POSIX never reach this path with non-ASCII.
        let mut buf = bun_paths::PathBuffer::default();
        let mut n = 0;
        for &c in sub_path {
            if c < 128 && n < buf.0.len() { buf.0[n] = c as u8; n += 1; }
            else { return Err(Error::from_code_int(libc::EINVAL, Tag::mkdir)); }
        }
        mkdir_recursive_at(dir, &buf.0[..n])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `std.posix` — wider surface than `bun_errno::posix` (which only has
// mode_t/E/S/errno). Dependents (`bun_resolver`, `bun_md`, `bun_crash`,
// `bun_threading`) reach for `Sigaction`, `getrlimit`, `tcgetattr`, raw
// `read`/`write`/`poll`, `dl_iterate_phdr` etc. We re-export the errno stub
// and layer the libc bits on top so `bun_sys::posix::*` is the single import.
// ──────────────────────────────────────────────────────────────────────────
pub mod posix {
    use core::ffi::{c_int, c_void};
    pub use bun_errno::posix::*;

    // ── signals ──
    #[cfg(unix)] pub use libc::sigaction as Sigaction;
    #[cfg(unix)] pub use libc::siginfo_t;
    #[cfg(unix)] pub use libc::sigset_t;
    /// `std.posix.sigaction(sig, &act, *oact)`.
    #[cfg(unix)]
    #[inline]
    pub unsafe fn sigaction(
        sig: c_int, act: *const Sigaction, oact: *mut Sigaction,
    ) -> c_int {
        unsafe { libc::sigaction(sig, act, oact) }
    }

    // ── time ──
    #[cfg(unix)] pub use libc::timespec;
    #[cfg(windows)]
    #[repr(C)] #[derive(Clone, Copy, Default)]
    pub struct timespec { pub tv_sec: i64, pub tv_nsec: i64 }

    // ── raw I/O (no `Maybe` wrapping; Zig: `std.posix.read/write`) ──
    #[cfg(unix)]
    #[inline]
    pub unsafe fn read(fd: c_int, buf: *mut u8, count: usize) -> isize {
        unsafe { libc::read(fd, buf.cast(), count) }
    }
    #[cfg(unix)]
    #[inline]
    pub unsafe fn write(fd: c_int, buf: *const u8, count: usize) -> isize {
        unsafe { libc::write(fd, buf.cast(), count) }
    }

    // ── poll ──
    /// `std.posix.pollfd`.
    #[cfg(unix)]
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct PollFd { pub fd: c_int, pub events: i16, pub revents: i16 }
    #[cfg(unix)] pub const POLL_IN: i16 = libc::POLLIN;
    #[cfg(unix)] pub const POLL_OUT: i16 = libc::POLLOUT;
    /// `std.posix.poll(fds, timeout_ms)` — returns count ready or error.
    #[cfg(unix)]
    pub fn poll(fds: &mut [PollFd], timeout_ms: c_int) -> core::result::Result<c_int, super::Error> {
        // SAFETY: PollFd is layout-identical to libc::pollfd.
        let rc = unsafe { libc::poll(fds.as_mut_ptr().cast(), fds.len() as _, timeout_ms) };
        if rc < 0 { return Err(super::err_with(super::Tag::ppoll)); }
        Ok(rc)
    }

    // ── termios ──
    #[cfg(unix)] pub use libc::termios as Termios;
    #[cfg(unix)]
    #[derive(Clone, Copy)] #[repr(i32)]
    pub enum TCSA { Now = libc::TCSANOW, Drain = libc::TCSADRAIN, Flush = libc::TCSAFLUSH }
    #[cfg(unix)]
    pub fn tcgetattr(fd: c_int) -> core::result::Result<Termios, super::Error> {
        let mut t = core::mem::MaybeUninit::<Termios>::uninit();
        // SAFETY: tcgetattr fully initializes `t` on success.
        let rc = unsafe { libc::tcgetattr(fd, t.as_mut_ptr()) };
        if rc < 0 { return Err(super::err_with(super::Tag::ioctl)); }
        Ok(unsafe { t.assume_init() })
    }
    #[cfg(unix)]
    pub fn tcsetattr(fd: c_int, action: TCSA, t: &Termios) -> core::result::Result<(), super::Error> {
        // SAFETY: t is a valid termios.
        let rc = unsafe { libc::tcsetattr(fd, action as c_int, t) };
        if rc < 0 { return Err(super::err_with(super::Tag::ioctl)); }
        Ok(())
    }

    // ── rlimit ──
    #[cfg(unix)]
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct Rlimit { pub cur: u64, pub max: u64 }
    #[cfg(unix)]
    #[derive(Clone, Copy)] #[repr(i32)]
    pub enum RlimitResource {
        NOFILE = libc::RLIMIT_NOFILE as _,
        STACK  = libc::RLIMIT_STACK as _,
        CORE   = libc::RLIMIT_CORE as _,
    }
    #[cfg(unix)]
    pub fn getrlimit(res: RlimitResource) -> core::result::Result<Rlimit, super::Error> {
        let mut r = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
        // SAFETY: r is written on success.
        let rc = unsafe { libc::getrlimit(res as _, &mut r) };
        if rc < 0 { return Err(super::err_with(super::Tag::TODO)); }
        Ok(Rlimit { cur: r.rlim_cur as u64, max: r.rlim_max as u64 })
    }
    #[cfg(unix)]
    pub fn setrlimit(res: RlimitResource, lim: Rlimit) -> core::result::Result<(), super::Error> {
        let r = libc::rlimit { rlim_cur: lim.cur as _, rlim_max: lim.max as _ };
        // SAFETY: r is a valid rlimit.
        let rc = unsafe { libc::setrlimit(res as _, &r) };
        if rc < 0 { return Err(super::err_with(super::Tag::TODO)); }
        Ok(())
    }

    // ── dynamic loading (Linux/FreeBSD) ──
    /// `std.posix.dl_iterate_phdr` — iterate loaded ELF objects.
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    #[inline]
    pub unsafe fn dl_iterate_phdr(
        callback: unsafe extern "C" fn(*mut libc::dl_phdr_info, usize, *mut c_void) -> c_int,
        data: *mut c_void,
    ) -> c_int {
        unsafe { libc::dl_iterate_phdr(Some(callback), data) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `std.net` — socket address. Minimal port of Zig's `std.net.Address`
// (just the sockaddr union + a couple of constructors; full resolver lives in
// `bun_dns`). Dependents only need the data shape + Display.
// ──────────────────────────────────────────────────────────────────────────
pub mod net {
    use core::fmt;

    /// `std.net.Address` — tagged union over sockaddr_in/in6/un.
    #[derive(Clone, Copy)]
    pub struct Address {
        /// Generic storage; `family()` discriminates.
        pub any: libc::sockaddr_storage,
    }
    impl Address {
        /// Construct from a borrowed `*const sockaddr` (Zig: `Address.initPosix`).
        /// SAFETY: `addr` must point at a valid sockaddr of the family it declares.
        pub unsafe fn init_posix(addr: *const libc::sockaddr) -> Self {
            let mut storage: libc::sockaddr_storage = unsafe { core::mem::zeroed() };
            let len = match unsafe { (*addr).sa_family } as i32 {
                libc::AF_INET => core::mem::size_of::<libc::sockaddr_in>(),
                libc::AF_INET6 => core::mem::size_of::<libc::sockaddr_in6>(),
                _ => core::mem::size_of::<libc::sockaddr>(),
            };
            unsafe {
                core::ptr::copy_nonoverlapping(
                    addr.cast::<u8>(),
                    (&mut storage as *mut libc::sockaddr_storage).cast::<u8>(),
                    len,
                );
            }
            Self { any: storage }
        }
        #[inline] pub fn family(&self) -> i32 { self.any.ss_family as i32 }
        #[inline] pub fn as_sockaddr(&self) -> *const libc::sockaddr {
            (&self.any as *const libc::sockaddr_storage).cast()
        }
        #[inline] pub fn sock_len(&self) -> u32 {
            match self.family() {
                libc::AF_INET => core::mem::size_of::<libc::sockaddr_in>() as u32,
                libc::AF_INET6 => core::mem::size_of::<libc::sockaddr_in6>() as u32,
                _ => core::mem::size_of::<libc::sockaddr_storage>() as u32,
            }
        }
    }
    impl Default for Address {
        fn default() -> Self { Self { any: unsafe { core::mem::zeroed() } } }
    }
    impl fmt::Debug for Address {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            fmt::Display::fmt(self, f)
        }
    }
    impl fmt::Display for Address {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            // PORT NOTE: Zig's std.net.Address.format prints "ip:port"/"[ip6]:port".
            // Minimal: print family for now; full impl in `bun_dns::address_to_string`.
            match self.family() {
                libc::AF_INET => {
                    // SAFETY: family checked.
                    let v4 = unsafe { &*(self.as_sockaddr().cast::<libc::sockaddr_in>()) };
                    let octets = v4.sin_addr.s_addr.to_ne_bytes();
                    write!(f, "{}.{}.{}.{}:{}", octets[0], octets[1], octets[2], octets[3], u16::from_be(v4.sin_port))
                }
                _ => write!(f, "<addr family={}>", self.family()),
            }
        }
    }
}

/// `std.elf` constants (just what `bun_exe_format`/`bun_crash` need).
pub mod elf {
    pub const PT_NULL: u32 = 0;
    pub const PT_LOAD: u32 = 1;
    pub const PT_DYNAMIC: u32 = 2;
    pub const PT_INTERP: u32 = 3;
    pub const PT_NOTE: u32 = 4;
    pub const PT_PHDR: u32 = 6;
    pub const PT_TLS: u32 = 7;
    pub const PT_GNU_STACK: u32 = 0x6474e551;
}

/// FreeBSD platform surface.
#[cfg(target_os = "freebsd")]
pub mod freebsd {
    use core::ffi::c_int;
    /// `struct kevent` (FreeBSD).
    pub type Kevent = libc::kevent;
    /// `std.c.EVFILT` — kqueue filter constants (FreeBSD).
    pub mod EVFILT {
        pub const READ:   i16 = libc::EVFILT_READ;
        pub const WRITE:  i16 = libc::EVFILT_WRITE;
        pub const VNODE:  i16 = libc::EVFILT_VNODE;
        pub const PROC:   i16 = libc::EVFILT_PROC;
        pub const SIGNAL: i16 = libc::EVFILT_SIGNAL;
        pub const TIMER:  i16 = libc::EVFILT_TIMER;
        pub const USER:   i16 = libc::EVFILT_USER;
    }
    /// `std.c.EV` — kqueue event flags (FreeBSD).
    pub mod EV {
        pub const ADD:      u16 = libc::EV_ADD;
        pub const DELETE:   u16 = libc::EV_DELETE;
        pub const ENABLE:   u16 = libc::EV_ENABLE;
        pub const DISABLE:  u16 = libc::EV_DISABLE;
        pub const ONESHOT:  u16 = libc::EV_ONESHOT;
        pub const CLEAR:    u16 = libc::EV_CLEAR;
        pub const RECEIPT:  u16 = libc::EV_RECEIPT;
        pub const DISPATCH: u16 = libc::EV_DISPATCH;
        pub const EOF:      u16 = libc::EV_EOF;
        pub const ERROR:    u16 = libc::EV_ERROR;
    }
    /// `std.c.NOTE` — kqueue fflags (FreeBSD).
    pub mod NOTE {
        pub const EXIT:    u32 = libc::NOTE_EXIT;
        pub const FORK:    u32 = libc::NOTE_FORK;
        pub const EXEC:    u32 = libc::NOTE_EXEC;
        pub const TRIGGER: u32 = libc::NOTE_TRIGGER;
        pub const DELETE:  u32 = libc::NOTE_DELETE;
        pub const WRITE:   u32 = libc::NOTE_WRITE;
        pub const EXTEND:  u32 = libc::NOTE_EXTEND;
        pub const ATTRIB:  u32 = libc::NOTE_ATTRIB;
        pub const LINK:    u32 = libc::NOTE_LINK;
        pub const RENAME:  u32 = libc::NOTE_RENAME;
        pub const REVOKE:  u32 = libc::NOTE_REVOKE;
    }
    /// `kevent()` syscall — thin re-export so callers don't need a direct
    /// `libc` dep. SAFETY: caller upholds the kernel contract.
    #[inline]
    pub unsafe fn kevent(
        kq: c_int,
        changelist: *const Kevent, nchanges: c_int,
        eventlist: *mut Kevent, nevents: c_int,
        timeout: *const libc::timespec,
    ) -> c_int {
        unsafe { libc::kevent(kq, changelist, nchanges, eventlist, nevents, timeout) }
    }
}
#[cfg(not(target_os = "freebsd"))]
pub mod freebsd {}

// ──────────────────────────────────────────────────────────────────────────
// `Dir` — `std.fs.Dir` replacement. Thin wrapper over `Fd`; close on Drop is
// NOT done (matches Zig — callers explicitly `.close()` or hold for lifetime).
// ──────────────────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
pub struct Dir { pub fd: Fd }

/// Options for `Dir::make_open_path` (Zig: `std.fs.Dir.OpenOptions`).
#[derive(Clone, Copy, Default)]
pub struct OpenDirOptions {
    pub iterate: bool,
    pub no_follow: bool,
}

impl Dir {
    #[inline] pub fn from_fd(fd: Fd) -> Self { Self { fd } }
    #[inline] pub fn fd(&self) -> Fd { self.fd }
    #[inline] pub fn cwd() -> Self { Self { fd: Fd::cwd() } }
    #[inline] pub fn close(self) { let _ = close(self.fd); }

    /// `std.fs.Dir.makePath` — `mkdir -p` relative to this dir.
    #[inline]
    pub fn make_path(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        mkdir_recursive_at(self.fd, sub_path).map_err(Into::into)
    }
    /// `std.fs.Dir.makeOpenPath` — `makePath` then `openDir`.
    pub fn make_open_path(&self, sub_path: &[u8], _opts: OpenDirOptions)
        -> core::result::Result<Dir, bun_core::Error>
    {
        mkdir_recursive_at(self.fd, sub_path)?;
        open_dir_at(self.fd, sub_path).map(Dir::from_fd).map_err(Into::into)
    }
    /// `std.fs.Dir.deleteTree` — recursive `rm -rf`. Port stub: routes via
    /// `walker_skippable` once that lands; for now best-effort `unlinkat`.
    pub fn delete_tree(&self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        // TODO(b2): full recursive walk (Zig std.fs.Dir.deleteTree). For B-2
        // surface this is best-effort: try `rmdir`, then `unlink`, ignoring ENOENT.
        let mut buf = bun_paths::PathBuffer::default();
        let len = sub_path.len().min(buf.0.len() - 1);
        buf.0[..len].copy_from_slice(&sub_path[..len]);
        buf.0[len] = 0;
        // SAFETY: NUL-terminated above.
        let z = unsafe { ZStr::from_raw(buf.0.as_ptr(), len) };
        #[cfg(unix)]
        match unlinkat(self.fd, z, libc::AT_REMOVEDIR) {
            Ok(()) => return Ok(()),
            Err(e) if e.get_errno() == E::ENOENT => return Ok(()),
            Err(e) if e.get_errno() == E::ENOTDIR => {
                return unlinkat(self.fd, z, 0).map_err(Into::into);
            }
            Err(e) if e.get_errno() == E::ENOTEMPTY => {
                // Full recursive impl pending; surface the error so callers can react.
                return Err(e.into());
            }
            Err(e) => return Err(e.into()),
        }
        #[cfg(windows)]
        Err(bun_core::err!("Unimplemented"))
    }
}

/// `std.fs.Dir.makeOpenPath` reachable as a module (Zig callers do
/// `bun.makePath` / `bun.makeOpenPath`).
pub mod make_path {
    use super::*;
    #[inline]
    pub fn make_open_path(dir: Dir, sub_path: &[u8], opts: OpenDirOptions)
        -> core::result::Result<Dir, bun_core::Error>
    {
        dir.make_open_path(sub_path, opts)
    }

    /// Dispatch trait for `make_path::<T>` over `u8` (POSIX) / `u16` (Windows).
    /// Mirrors Zig's `std.fs.Dir.makePath` taking `OSPathSlice`.
    pub trait PathChar: Copy {
        fn make_path_at(dir: Fd, sub: &[Self]) -> core::result::Result<(), bun_core::Error>;
    }
    impl PathChar for u8 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u8]) -> core::result::Result<(), bun_core::Error> {
            mkdir_recursive_at(dir, sub).map_err(Into::into)
        }
    }
    impl PathChar for u16 {
        #[inline]
        fn make_path_at(dir: Fd, sub: &[u16]) -> core::result::Result<(), bun_core::Error> {
            make_path_w(dir, sub).map_err(Into::into)
        }
    }
    /// `bun.makePath` — `mkdir -p` relative to `dir`, generic over path-char
    /// width so callers can pass `OSPathChar` slices unchanged.
    #[inline]
    pub fn make_path<T: PathChar>(dir: Dir, sub_path: &[T])
        -> core::result::Result<(), bun_core::Error>
    {
        T::make_path_at(dir.fd, sub_path)
    }
    /// Explicit UTF-16 form (Windows). On POSIX transcodes via `make_path_w`.
    #[inline]
    pub fn make_path_u16(dir: Dir, sub_path: &[u16])
        -> core::result::Result<(), bun_core::Error>
    {
        make_path_w(dir.fd, sub_path).map_err(Into::into)
    }
}
/// Type-style alias so callers can write `bun_sys::MakePath::make_path::<T>(..)`
/// (Zig: `bun.MakePath` namespace re-export).
pub use make_path as MakePath;

// `Fd` parity: `Fd::cwd().make_open_path(..)` / `.make_path(..)` are used by
// `bun_install` and `bun_bundler` directly on `Fd`. Extension trait so we
// don't fight with `bun_core`'s inherent impl.
pub trait FdDirExt: Copy {
    fn make_path(self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error>;
    fn make_open_path(self, sub_path: &[u8]) -> core::result::Result<Dir, bun_core::Error>;
    fn from_std_dir(dir: &Dir) -> Self;
}
impl FdDirExt for Fd {
    #[inline]
    fn make_path(self, sub_path: &[u8]) -> core::result::Result<(), bun_core::Error> {
        mkdir_recursive_at(self, sub_path).map_err(Into::into)
    }
    #[inline]
    fn make_open_path(self, sub_path: &[u8]) -> core::result::Result<Dir, bun_core::Error> {
        Dir::from_fd(self).make_open_path(sub_path, OpenDirOptions::default())
    }
    #[inline]
    fn from_std_dir(dir: &Dir) -> Fd { dir.fd }
}

// ──────────────────────────────────────────────────────────────────────────
// open helpers (additional)
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    /// `std.fs.File.OpenFlags` — convenience flagset for `open_file*` helpers.
    #[derive(Clone, Copy, Default)]
    pub struct OpenFlags: i32 {
        const READ_ONLY  = O::RDONLY;
        const WRITE_ONLY = O::WRONLY;
        const READ_WRITE = O::RDWR;
        const CREATE     = O::CREAT;
        const TRUNCATE   = O::TRUNC;
        const APPEND     = O::APPEND;
        const EXCLUSIVE  = O::EXCL;
    }
}

/// `std.fs.openFileAbsoluteZ` — open an absolute, NUL-terminated path.
#[inline]
pub fn open_file_absolute_z(path: &ZStr, flags: OpenFlags) -> Maybe<File> {
    open(path, flags.bits() | O::CLOEXEC, 0).map(File::from_fd)
}
/// `std.fs.cwd().openFile` — non-NUL-terminated convenience.
#[inline]
pub fn open_file(path: &[u8], flags: OpenFlags) -> Maybe<File> {
    open_a(path, flags.bits() | O::CLOEXEC, 0).map(File::from_fd)
}
/// bun.zig:883 — `openDirForIteration(dir, sub)`.
#[inline]
pub fn open_dir_for_iteration(dir: Fd, path: &[u8]) -> Maybe<Fd> {
    open_dir_at(dir, path)
}
/// `bun.iterateDir(dir)` — convenience wrapper around `dir_iterator::iterate`.
#[inline]
pub fn iterate_dir(dir: Fd) -> dir_iterator::WrappedIterator {
    dir_iterator::iterate(dir)
}
/// sys.zig:4246 — `moveFileZ`. Tries the rename first (no source open on the
/// hot path); on EISDIR removes the dest dir and retries; on EXDEV falls back
/// to the slow open+copy path. Only opens the source inside the EXDEV branch.
pub fn move_file_z(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr)
    -> core::result::Result<(), bun_core::Error>
{
    // TODO(port): renameatConcurrentlyWithoutFallback (renameat2 NOREPLACE →
    // EXCHANGE → deleteTree) — sys.zig:2480. Plain `renameat` for now.
    match renameat(from_dir, filename, to_dir, destination) {
        Ok(()) => Ok(()),
        Err(e) if e.get_errno() == E::EISDIR => {
            #[cfg(unix)]
            // SAFETY: destination is NUL-terminated.
            let _ = unsafe { libc::unlinkat(to_dir.native(), destination.as_ptr(), libc::AT_REMOVEDIR) };
            renameat(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) if e.get_errno() == E::EXDEV => {
            move_file_z_slow(from_dir, filename, to_dir, destination).map_err(Into::into)
        }
        Err(e) => Err(e.into()),
    }
}
/// sys.zig:4291 — `moveFileZSlow`: open source, unlink, copy to dest.
pub fn move_file_z_slow(from_dir: Fd, filename: &ZStr, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    let in_handle = openat(
        from_dir, filename,
        O::RDONLY | O::CLOEXEC,
        if cfg!(windows) { 0 } else { 0o644 },
    )?;
    let _ = unlinkat(from_dir, filename, 0);
    let r = copy_file_z_slow_with_handle(in_handle, to_dir, destination);
    let _ = close(in_handle);
    r
}
/// sys.zig:4305 — `copyFileZSlowWithHandle` (POSIX read/write fallback arm).
pub fn copy_file_z_slow_with_handle(in_handle: Fd, to_dir: Fd, destination: &ZStr) -> Maybe<()> {
    let st = fstat(in_handle)?;
    // Unlink dest first — fixes ETXTBUSY on Linux.
    let _ = unlinkat(to_dir, destination, 0);
    let dst = openat(to_dir, destination, O::WRONLY | O::CREAT | O::CLOEXEC | O::TRUNC, 0o644)?;
    #[cfg(target_os = "linux")] {
        // SAFETY: dst is a valid open fd; preallocation is best-effort.
        let _ = unsafe { libc::fallocate(dst.native(), 0, 0, st.st_size) };
    }
    let _ = lseek(in_handle, 0, libc::SEEK_SET);
    let r = copy_file(in_handle, dst);
    // SAFETY: dst is a valid open fd.
    let _ = unsafe { libc::fchmod(dst.native(), st.st_mode) };
    let _ = unsafe { libc::fchown(dst.native(), st.st_uid, st.st_gid) };
    let _ = close(dst);
    r
}
/// `renameatZ` alias (bun_install reaches for it as the NUL-terminated form).
#[inline]
pub fn renameat_z(from_dir: Fd, from: &ZStr, to_dir: Fd, to: &ZStr) -> Maybe<()> {
    renameat(from_dir, from, to_dir, to)
}

/// Linux `eventfd(initval, flags)` — kernel notification fd.
#[cfg(target_os = "linux")]
pub fn eventfd(initval: u32, flags: i32) -> Maybe<Fd> {
    // SAFETY: eventfd(2) is safe to call with any args.
    let rc = unsafe { libc::eventfd(initval, flags) };
    if rc < 0 { return Err(err_with(Tag::open)); }
    Ok(Fd::from_native(rc))
}

/// `bun.Output.stderrWriter()` — `std::io::Write` over stderr fd. Used by
/// callers that want a borrowed writer without going through `bun_core::Output`.
#[inline]
pub fn stderr_writer() -> FileWriter { FileWriter(Fd::stderr()) }

// ──────────────────────────────────────────────────────────────────────────
// `NodeFS::writeFileWithPathBuffer` — CYCLEBREAK MOVE_DOWN landing.
//
// Real impl lives in `bun_runtime::node::node_fs` (T6, takes JS encodings,
// JSArrayBuffer, etc). Bundler (T4) needs a sync write that doesn't pull JSC.
// This is the minimal shape: `Buffer` data + `Path` target → openat+write+close.
// ──────────────────────────────────────────────────────────────────────────

/// Data payload for `write_file_with_path_buffer`.
pub enum WriteFileData<'a> {
    Buffer { buffer: &'a [u8] },
    // T6 adds `String { value, encoding }` / `ArrayBuffer { .. }`.
}
/// Encoding tag (only `Buffer` is honoured at T1).
#[derive(Clone, Copy, Default)]
pub enum WriteFileEncoding { #[default] Buffer }
/// Target — path (relative to `dirfd`) or an already-open fd.
pub enum PathOrFileDescriptor {
    Path(bun_string::PathString),
    Fd(Fd),
}
impl Default for PathOrFileDescriptor {
    fn default() -> Self { PathOrFileDescriptor::Fd(Fd::INVALID) }
}
/// Args struct (Zig: anon-struct init at call sites).
pub struct WriteFileArgs<'a> {
    pub data: WriteFileData<'a>,
    pub encoding: WriteFileEncoding,
    pub dirfd: Fd,
    pub file: PathOrFileDescriptor,
    pub mode: Mode,
}
impl<'a> Default for WriteFileArgs<'a> {
    fn default() -> Self {
        Self {
            data: WriteFileData::Buffer { buffer: &[] },
            encoding: WriteFileEncoding::Buffer,
            dirfd: Fd::cwd(),
            file: PathOrFileDescriptor::default(),
            mode: 0o666,
        }
    }
}
/// `NodeFS::writeFileWithPathBuffer` — sync `openat(CREAT|TRUNC)` + write_all.
/// `path_buf` is a scratch buffer for NUL-terminating the relative path.
pub fn write_file_with_path_buffer(
    path_buf: &mut bun_paths::PathBuffer,
    args: WriteFileArgs<'_>,
) -> Maybe<usize> {
    let WriteFileData::Buffer { buffer } = args.data;
    let fd = match args.file {
        PathOrFileDescriptor::Fd(fd) => fd,
        PathOrFileDescriptor::Path(ref p) => {
            let bytes = p.slice();
            if bytes.len() >= path_buf.0.len() {
                return Err(Error::from_code_int(libc::ENAMETOOLONG, Tag::open).with_path(bytes));
            }
            path_buf.0[..bytes.len()].copy_from_slice(bytes);
            path_buf.0[bytes.len()] = 0;
            // SAFETY: NUL-terminated above.
            let z = unsafe { ZStr::from_raw(path_buf.0.as_ptr(), bytes.len()) };
            openat(args.dirfd, z, O::WRONLY | O::CREAT | O::TRUNC | O::CLOEXEC, args.mode)?
        }
    };
    let r = File::from_fd(fd).write_all(buffer);
    if !matches!(args.file, PathOrFileDescriptor::Fd(_)) { let _ = close(fd); }
    r.map(|_| buffer.len())
}

/// `bun.fetchCacheDirectoryPath` — resolve `$BUN_INSTALL_CACHE_DIR` /
/// `$XDG_CACHE_HOME/.bun/install/cache` / `$HOME/.bun/install/cache`.
/// PORT NOTE: full env-override chain lives in `bun_install`; this is the
/// fallback so the symbol resolves at T1. Returns an owned path (caller frees).
pub fn fetch_cache_directory_path() -> Vec<u8> {
    if let Some(v) = bun_core::getenv_z(bun_core::zstr!("BUN_INSTALL_CACHE_DIR")) {
        return v.to_vec();
    }
    if let Some(home) = bun_core::getenv_z(bun_core::zstr!("HOME")) {
        let mut p = home.to_vec();
        p.extend_from_slice(b"/.bun/install/cache");
        return p;
    }
    b".bun-cache".to_vec()
}

// ── `bun.fs` — forward stubs for the resolver-FS singleton (T4). ──
// CYCLEBREAK: real defs live in `bun_resolver::fs`; this gives `bun_install`
// a stable import path so its `use bun_sys::fs::FileSystem` lines resolve.
// The vtable is installed at runtime by the resolver crate.
pub mod fs {
    /// Opaque handle to `bun_resolver::fs::FileSystem`. Dependents that need
    /// the concrete type must downcast via the resolver crate.
    #[repr(C)]
    pub struct FileSystem { _opaque: [u8; 0] }
    impl FileSystem {
        /// Installed by `bun_resolver::fs` at init (cold-path vtable §Dispatch).
        pub fn instance() -> &'static FileSystem {
            todo!("b2-blocked: bun_resolver::fs::FileSystem::instance vtable install")
        }
        /// `fs.abs(parts)` — join `parts` against the cached cwd into a
        /// thread-local buffer. CYCLEBREAK: real impl in `bun_resolver::fs`;
        /// this delegates to `bun_paths::join_abs` against process cwd.
        pub fn abs(&self, parts: &[&[u8]]) -> Vec<u8> {
            let mut buf = bun_paths::PathBuffer::default();
            self.abs_buf(parts, &mut buf).to_vec()
        }
        /// `fs.absBuf(parts, &mut buf)` — like `abs` but writes into `buf`.
        pub fn abs_buf<'a>(&self, parts: &[&[u8]], buf: &'a mut bun_paths::PathBuffer) -> &'a [u8] {
            // PORT NOTE: Zig threads cwd through the FileSystem singleton and
            // calls `bun_paths::join_abs_string_buf::<Auto>`. That generic is
            // `PlatformT`-monomorphised; until the resolver vtable lands we do
            // a simple cwd-prefixed join (no `..` normalization).
            let mut cwd = bun_paths::PathBuffer::default();
            let cwd_len = super::getcwd(&mut cwd.0).unwrap_or(0);
            let mut n = 0usize;
            let push = |dst: &mut [u8], n: &mut usize, src: &[u8]| {
                let m = src.len().min(dst.len().saturating_sub(*n));
                dst[*n..*n + m].copy_from_slice(&src[..m]);
                *n += m;
            };
            // Absolute first part wins; otherwise prefix cwd.
            let first_abs = parts.first().map(|p| p.first() == Some(&bun_core::SEP)).unwrap_or(false);
            if !first_abs { push(&mut buf.0, &mut n, &cwd.0[..cwd_len]); }
            for p in parts {
                if n > 0 && buf.0.get(n - 1) != Some(&bun_core::SEP) {
                    push(&mut buf.0, &mut n, &[bun_core::SEP]);
                }
                push(&mut buf.0, &mut n, p);
            }
            &buf.0[..n]
        }
        /// `fs.dirnameStore` — interned-string store for parent dirs.
        /// Stub: returns the resolver's global store once installed.
        pub fn dirname_store(&self) -> &'static DirnameStore {
            static STORE: DirnameStore = DirnameStore { _opaque: [] };
            &STORE
        }
        /// `fs.setMaxFd(fd)` — track highest fd for stat-cache invalidation.
        /// No-op stub; resolver overrides via vtable.
        #[inline] pub fn set_max_fd(&self, _fd: super::FdNative) {}
    }
    /// `bun.fs.Entry` — single cached directory entry (name + kind).
    #[repr(C)]
    pub struct Entry { _opaque: [u8; 0] }
    impl Entry {
        // CYCLEBREAK: real fields/body live in `bun_resolver::fs::Entry`. These
        // accessor stubs let dependents type-check against the `bun_sys::fs`
        // path until MOVE_DOWN lands; bodies panic to surface mis-routing.
        #[inline] pub fn base(&self) -> &[u8] {
            todo!("b2-blocked: bun_resolver::fs::Entry::base (MOVE_DOWN pending)")
        }
        #[inline] pub fn base_lowercase(&self) -> &[u8] {
            todo!("b2-blocked: bun_resolver::fs::Entry::base_lowercase (MOVE_DOWN pending)")
        }
        #[inline] pub fn dir(&self) -> &'static [u8] {
            todo!("b2-blocked: bun_resolver::fs::Entry::dir (MOVE_DOWN pending)")
        }
        #[inline] pub fn abs_path(&self) -> &bun_string::PathString {
            todo!("b2-blocked: bun_resolver::fs::Entry::abs_path (MOVE_DOWN pending)")
        }
        #[inline] pub fn cache(&self) -> &EntryCache {
            todo!("b2-blocked: bun_resolver::fs::Entry::cache (MOVE_DOWN pending)")
        }
        /// Zig: `Entry.kind(fs, store_fd)`. The `fs` arg is the resolver's
        /// `Implementation` (higher-tier); accepted as `*mut c_void` here so
        /// the stub stays tier-clean.
        #[inline] pub fn kind(&mut self, _fs: *mut core::ffi::c_void, _store_fd: bool) -> super::EntryKind {
            todo!("b2-blocked: bun_resolver::fs::Entry::kind (MOVE_DOWN pending)")
        }
    }
    /// `bun.fs.Entry.Cache` — cached stat result for an `Entry`.
    #[derive(Clone, Copy)]
    pub struct EntryCache {
        pub symlink: bun_string::PathString,
        pub fd: super::Fd,
        pub kind: super::EntryKind,
    }
    /// `bun.fs.DirEntry` — directory entry cache record (name → Entry map).
    #[repr(C)]
    pub struct DirEntry { _opaque: [u8; 0] }
    impl DirEntry {
        /// Zig: `DirEntry.hasComptimeQuery(comptime query)` — fast O(1) lookup
        /// of a known-at-compile-time filename in this directory's entry map.
        #[inline] pub fn has_comptime_query(&self, _query_lower: &'static [u8]) -> bool {
            todo!("b2-blocked: bun_resolver::fs::DirEntry::has_comptime_query (MOVE_DOWN pending)")
        }
        /// Accessor for the underlying `EntryMap`. Real field is
        /// `bun_resolver::fs::DirEntry.data`; opaque here.
        #[inline] pub fn data(&self) -> &() {
            todo!("b2-blocked: bun_resolver::fs::DirEntry::data (MOVE_DOWN pending)")
        }
    }
    /// `bun.fs.FileSystem.DirnameStore` — interned-dirname arena.
    #[repr(C)]
    pub struct DirnameStore { _opaque: [u8; 0] }
    impl DirnameStore {
        /// Intern `value` into the dirname arena, returning a `&'static` slice.
        /// Zig: `DirnameStore.append(allocator, value)`.
        pub fn append(&self, _value: &[u8]) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            todo!("b2-blocked: bun_resolver::fs::DirnameStore::append (MOVE_DOWN pending)")
        }
        /// Intern the ASCII-lowercased form of `value`.
        /// Zig: `DirnameStore.appendLowerCase(allocator, value)`.
        pub fn append_lower_case(&self, _value: &[u8]) -> core::result::Result<&'static [u8], bun_alloc::AllocError> {
            todo!("b2-blocked: bun_resolver::fs::DirnameStore::append_lower_case (MOVE_DOWN pending)")
        }
    }
    /// `bun.fs.EntriesOption` — `Ok(DirEntry)` / `Err(err)`.
    pub enum EntriesOption {
        Entries(*const DirEntry),
        Err(bun_core::Error),
    }
}
/// Top-level alias (Zig: `bun.FileSystem`).
pub type FileSystem = fs::FileSystem;

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────

/// `bun_core::output::QuietWriter` is an opaque `[*mut (); 4]`. We stash the
/// raw fd in slot 0 and ignore the rest. (Zig's `QuietWriter` is `{ context:
/// File { handle: Fd } }`; the buffering layer in Zig is the std-adapter, which
/// we route to `QuietWriterAdapter` below.)
#[inline]
unsafe fn qw_fd(qw: *const bun_core::output::QuietWriter) -> Fd {
    // SAFETY: repr(C) [*mut (); 4]; slot 0 carries fd-as-usize-as-ptr.
    let raw = unsafe { *(qw as *const *mut ()) };
    Fd::from_native(raw as usize as _)
}
#[inline]
unsafe fn qw_set_fd(qw: *mut bun_core::output::QuietWriter, fd: Fd) {
    // SAFETY: repr(C) [*mut (); 4]; slot 0 carries fd-as-usize-as-ptr.
    unsafe { *(qw as *mut *mut ()) = fd.native() as usize as *mut (); }
}

/// Best-effort write-all loop. Returns `false` on I/O error / zero-write so
/// `ScopedLogger::log` can disable the scope; "quiet" callers discard the bool.
fn fd_write_all_quiet(fd: Fd, mut bytes: &[u8]) -> bool {
    while !bytes.is_empty() {
        match write(fd, bytes) {
            Ok(0) => return false, // short write → give up (matches Zig quiet semantics)
            Ok(n) => bytes = &bytes[n..],
            Err(_) => return false,
        }
    }
    true
}

/// Concrete repr behind the opaque `bun_core::output::QuietWriterAdapter`
/// (`[u8; 64]`). First field MUST be `io::Writer` so `new_interface()`'s
/// pointer-cast is sound. Layout asserted below.
#[repr(C)]
struct SysQuietWriterAdapter {
    writer: bun_core::io::Writer,
    fd: Fd,
}
const _: () = {
    assert!(core::mem::size_of::<SysQuietWriterAdapter>()
        <= core::mem::size_of::<bun_core::output::QuietWriterAdapter>());
    assert!(core::mem::align_of::<bun_core::output::QuietWriterAdapter>()
        >= core::mem::align_of::<SysQuietWriterAdapter>());
};

unsafe fn adapter_write_all(w: *mut bun_core::io::Writer, bytes: &[u8])
    -> core::result::Result<(), bun_core::Error>
{
    // SAFETY: `w` points at the first field of a SysQuietWriterAdapter (repr(C)).
    let this = unsafe { &*(w as *const SysQuietWriterAdapter) };
    let _ = fd_write_all_quiet(this.fd, bytes);
    Ok(())
}
unsafe fn adapter_flush(_w: *mut bun_core::io::Writer)
    -> core::result::Result<(), bun_core::Error>
{
    // Unbuffered (we write straight to the fd above), so flush is a no-op.
    // PERF(port): Zig buffers via `adaptToNewApi(buf)`; wire that in B-2.
    Ok(())
}

#[cfg(unix)]
unsafe fn sink_tty_winsize(fd: Fd) -> Option<bun_core::Winsize> {
    let mut ws: libc::winsize = unsafe { core::mem::zeroed() };
    // SAFETY: TIOCGWINSZ expects a *mut winsize.
    let rc = unsafe { libc::ioctl(fd.native(), libc::TIOCGWINSZ, &mut ws as *mut _) };
    if rc != 0 { return None; }
    Some(bun_core::Winsize {
        row: ws.ws_row,
        col: ws.ws_col,
        xpixel: ws.ws_xpixel,
        ypixel: ws.ws_ypixel,
    })
}
#[cfg(not(unix))]
unsafe fn sink_tty_winsize(_fd: Fd) -> Option<bun_core::Winsize> {
    // TODO(b2-windows): GetConsoleScreenBufferInfo.
    None
}

/// Backs `bun_core::output::OUTPUT_SINK_VTABLE` — stderr/mkdir/open/QuietWriter.
pub static OUTPUT_SINK_VTABLE_IMPL: bun_core::output::OutputSinkVTable =
    bun_core::output::OutputSinkVTable {
        stderr: || bun_core::output::File(Fd::stderr()),
        make_path: |cwd, dir| {
            mkdir_recursive_at(cwd, dir).map_err(Into::into)
        },
        create_file: |cwd, path| {
            openat_a(cwd, path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)
                .map_err(Into::into)
        },
        quiet_writer_from_fd: |fd| {
            let mut out = bun_core::output::QuietWriter::ZEROED;
            // SAFETY: see qw_set_fd.
            unsafe { qw_set_fd(&mut out, fd) };
            out
        },
        quiet_writer_adapt: |qw, _buf, _len| {
            // SAFETY: qw came from quiet_writer_from_fd above.
            let fd = unsafe { qw_fd(&qw) };
            let concrete = SysQuietWriterAdapter {
                writer: bun_core::io::Writer {
                    write_all: adapter_write_all,
                    flush: adapter_flush,
                },
                fd,
            };
            let mut out = bun_core::output::QuietWriterAdapter::uninit();
            // SAFETY: size/align asserted in const block above; out is repr(C) [u8;64].
            unsafe {
                core::ptr::write(
                    &mut out as *mut _ as *mut SysQuietWriterAdapter,
                    concrete,
                );
            }
            out
        },
        quiet_writer_flush: |_qw| {
            // Unbuffered — see adapter_flush.
        },
        quiet_writer_write_all: |qw, bytes| {
            // SAFETY: qw came from quiet_writer_from_fd above.
            let fd = unsafe { qw_fd(qw) };
            fd_write_all_quiet(fd, bytes)
        },
        quiet_writer_fd: |qw| {
            // SAFETY: qw came from quiet_writer_from_fd above.
            unsafe { qw_fd(qw) }
        },
        tty_winsize: sink_tty_winsize,
        is_terminal: |fd| isatty(fd),
        read: |fd, buf| read(fd, buf).map_err(Into::into),
    };

pub fn install_output_sink() {
    bun_core::output::install_output_sink(&OUTPUT_SINK_VTABLE_IMPL);
}
