#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_sys` — B-1 minimal compiling surface.
//! Full Phase-A draft (5500 lines, all syscall wrappers) preserved in
//! `lib_draft_b1.rs`. B-2: un-gate per-syscall, wire libc/kernel32/ntdll.

#[cfg(any())] #[path = "lib_draft_b1.rs"] mod draft;
// RESOLVED (B-2 round 7): `Fd` struct + pure-data accessors hoisted to
// `bun_core::Fd` (canonical T0). `fd.rs` is now `pub trait FdExt` over that.
pub mod fd;
pub use fd::{FdExt, FdOptionalExt, ErrorCase, MakeLibUvOwnedError, HashMapContext, MovableIfWindowsFd, FdT, UvFile};
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
        // SAFETY: path is NUL-terminated; st is written on success.
        let rc = unsafe {
            libc::fstatat(fd.native(), path.as_ptr().cast(), st.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW)
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
pub use bun_errno::{E, S, SystemErrno, get_errno, posix};

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
    #[cfg(not(target_os = "linux"))] pub const PATH: i32 = 0;
    #[cfg(not(target_os = "linux"))] pub const NOATIME: i32 = 0;
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
        check!(unsafe { libc::close(fd.native()) }, Tag::close); Ok(())
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
        let mut peel = end;
        // Walk down: try mkdirat; on ENOENT, peel one component.
        loop {
            buf[peel] = 0;
            // SAFETY: buf[0..=peel] is NUL-terminated immediately above.
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
                }
                Err(e) => return Err(e),
            }
        }
        // Walk back up, creating each peeled component.
        while peel < end {
            buf[peel] = bun_core::SEP; // restore separator we NUL'd
            peel += 1;
            while peel < end && buf[peel] != bun_core::SEP { peel += 1; }
            buf[peel] = 0;
            // SAFETY: buf[0..=peel] is NUL-terminated immediately above.
            let z = unsafe { ZStr::from_raw(buf.as_ptr(), peel) };
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
    /// `linkatTmpfile` (sys.zig:3973): materialize an `O_TMPFILE` fd via
    /// `linkat(AT_FDCWD, "/proc/self/fd/<tmpfd>", dirfd, name, AT_SYMLINK_FOLLOW)`.
    /// Linux-only; on other unix this errors with EOPNOTSUPP (Zig same).
    #[cfg(target_os = "linux")]
    pub fn linkat_tmpfile(tmpfd: Fd, dirfd: Fd, name: &ZStr) -> Maybe<()> {
        let mut buf = [0u8; 32];
        let n = {
            use std::io::Write as _;
            let mut c = std::io::Cursor::new(&mut buf[..]);
            let _ = write!(c, "/proc/self/fd/{}\0", tmpfd.native());
            c.position() as usize - 1
        };
        // SAFETY: NUL written by the format string above.
        let proc = unsafe { ZStr::from_raw(buf.as_ptr(), n) };
        check_p!(
            unsafe { libc::linkat(libc::AT_FDCWD, proc.as_ptr(), dirfd.native(), name.as_ptr(), libc::AT_SYMLINK_FOLLOW) },
            Tag::linkat, name
        );
        Ok(())
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
        check_p!(unsafe { libc::fstatat(fd.native(), path.as_ptr(), st.as_mut_ptr(), 0) }, Tag::fstatat, path);
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
    /// sys.zig:4140 — `fstat` then `st_size`.
    pub fn get_file_size(fd: Fd) -> Maybe<u64> {
        Ok(fstat(fd)?.st_size as u64)
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
            if n == 0 { return Err(Error::from_code_int(libc::EIO, Tag::write)); }
            buf = &buf[n..];
        }
        Ok(())
    }
    pub fn read_all(&self, buf: &mut Vec<u8>) -> Maybe<usize> {
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
        self.read_all(&mut v)?;
        Ok(v)
    }
    /// `File.readToEndWithArrayList(buf, hint)` — like `read_all` but takes a
    /// `SizeHint` so callers can pre-reserve. Returns the borrowed slice.
    pub fn read_to_end_with_array_list<'a>(&self, buf: &'a mut Vec<u8>, hint: SizeHint) -> Maybe<&'a [u8]> {
        if let SizeHint::Size(n) = hint { buf.reserve(n); }
        let start = buf.len();
        self.read_all(buf)?;
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
    pub fn stat(&self) -> Maybe<Stat> { fstat(self.handle) }
    pub fn close(self) -> Maybe<()> { close(self.handle) }
    /// `bun.sys.File.readFrom` — open + read + close.
    pub fn read_from(dir: Fd, path: &ZStr) -> Maybe<Vec<u8>> {
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        let v = f.read_to_end()?;
        let _ = close(f.handle);
        Ok(v)
    }
    /// `bun.sys.File.writeFile` — open + write + close.
    pub fn write_file(dir: Fd, path: &ZStr, data: &[u8]) -> Maybe<()> {
        let f = Self::openat(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o644)?;
        f.write_all(data)?;
        close(f.handle)
    }
    /// `File.bufferedWriter()` — `std.io.BufferedWriter` wrapping this fd.
    pub fn buffered_writer(&self) -> std::io::BufWriter<FileWriter> {
        std::io::BufWriter::new(FileWriter(self.handle))
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

/// `bun.sys.File.SizeHint` — pre-reserve hint for `read_to_end`.
#[derive(Clone, Copy, Debug)]
pub enum SizeHint {
    UnknownSize,
    Size(usize),
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
            $crate::fd::SYS.log(::core::format_args!($fmt $(, $arg)*));
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
}

// ── `bun.linux` / `std.os.linux` — raw kernel syscalls (Linux only). ──
#[cfg(target_os = "linux")]
pub mod linux {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    pub use libc::pollfd;
    pub use libc::epoll_event;

    /// `std.os.linux.E` — errno; aliased to `bun_errno::E`.
    pub type Errno = super::E;
    #[inline] pub fn errno() -> c_int { super::last_errno() }

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

    /// `bun.linux.RWFFlagSupport` — runtime probe for `RWF_NOWAIT` (kernel ≥ 4.14).
    pub struct RWFFlagSupport;
    static RWF_STATE: core::sync::atomic::AtomicI8 = core::sync::atomic::AtomicI8::new(0);
    impl RWFFlagSupport {
        /// 0 = unknown (assume yes), 1 = yes, -1 = no.
        #[inline]
        pub fn is_maybe_supported() -> bool {
            RWF_STATE.load(core::sync::atomic::Ordering::Relaxed) >= 0
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
            match get_errno(e) {
                E::ENOTSUP | E::ENOSYS | E::EPERM | E::EACCES => {
                    linux::RWFFlagSupport::disable();
                    return read(fd, buf);
                }
                E::EINTR => continue,
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
            match get_errno(e) {
                E::ENOTSUP | E::ENOSYS | E::EPERM | E::EACCES => {
                    linux::RWFFlagSupport::disable();
                    return write(fd, buf);
                }
                E::EINTR => continue,
                _ => return Err(Error::from_code_int(e, Tag::write).with_fd(fd)),
            }
        }
        return Ok(rc as usize);
    }
    write(fd, buf)
}

/// sys.zig:4536 — `posix_fallocate` (Linux) / no-op elsewhere.
pub fn preallocate_file(fd: FdNative, offset: i64, len: i64) -> core::result::Result<(), bun_core::Error> {
    #[cfg(target_os = "linux")] {
        // SAFETY: fd is a valid open descriptor owned by caller.
        let rc = unsafe { libc::posix_fallocate(fd, offset, len) };
        // posix_fallocate returns the errno directly (0 on success).
        if rc != 0 { return Err(bun_core::Error::from_errno(rc)); }
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
            // Cross-device: copy bytes then unlink source.
            let dst = openat(to_dir, destination, O::WRONLY | O::CREAT | O::TRUNC, 0o644)
                .map_err(bun_core::Error::from)?;
            let r = copy_file(from_handle, dst);
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
/// PORT NOTE: full state-machine lives in `copy_file.rs` (still gated); this
/// is the read/write fallback so `move_file_z_with_handle` and friends work.
pub fn copy_file(in_: Fd, out: Fd) -> Maybe<()> {
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
    }
    /// `bun.fs.Entry` — directory entry cache record.
    #[repr(C)]
    pub struct DirEntry { _opaque: [u8; 0] }
    /// `bun.fs.EntriesOption` — `Ok(DirEntry)` / `Err(err)`.
    pub enum EntriesOption {
        Entries(*const DirEntry),
        Err(bun_core::Error),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────
pub fn install_output_sink() {
    // B-2: build a real OutputSinkVTable wrapping stderr/make_path/create_file
    // and call bun_core::output::install_output_sink(&STATIC_VTABLE).
}
