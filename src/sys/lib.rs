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

    /// `DirIterator.NewWrappedIterator(if windows .u16 else .u8)`
    pub struct WrappedIterator {
        dir: Fd,
        // TODO(b2-blocked): platform-specific readdir state (DIR* / HANDLE+buf).
    }
    impl WrappedIterator {
        #[inline] pub fn dir(&self) -> Fd { self.dir }
        pub fn next(&mut self) -> super::Result<Option<IteratorResult>> {
            todo!("b2-blocked: bun_runtime::node::dir_iterator (T6) — vtable install pending")
        }
    }

    pub fn iterate(dir: Fd) -> WrappedIterator {
        WrappedIterator { dir }
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
        let flags = libc::O_DIRECTORY | libc::O_RDONLY | libc::O_CLOEXEC;
        #[cfg(target_os = "linux")] let flags = flags | libc::O_NONBLOCK;
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
#[cfg(any())] pub mod windows;

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
    #[cfg(target_os = "linux")] pub const DIRECTORY: i32 = libc::O_DIRECTORY;
    #[cfg(target_os = "linux")] pub const PATH: i32 = libc::O_PATH;
    #[cfg(target_os = "linux")] pub const NOATIME: i32 = libc::O_NOATIME;
    #[cfg(not(target_os = "linux"))] pub const DIRECTORY: i32 = 0;
}

// ──────────────────────────────────────────────────────────────────────────
// `File` — high-level handle. B-1 stub; B-2 wires read/write/stat.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
pub struct File(pub Fd);
impl File {
    pub fn from_fd(fd: Fd) -> Self { Self(fd) }
    pub fn handle(&self) -> Fd { self.0 }
}

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
    pub const TODO: Tag = Tag(0);
    /// Full tag enum (~200 variants) lives in `lib_draft_b1.rs`. This subset
    /// covers the un-gated posix surface; B-2 widens as syscalls land.
    pub fn name(self) -> &'static str {
        match self.0 {
            0 => "TODO", 1 => "open", 2 => "close", 3 => "read", 4 => "write",
            5 => "pread", 6 => "pwrite", 7 => "stat", 8 => "fstat", 9 => "lstat",
            10 => "mkdir", 11 => "unlink", 12 => "rename", 13 => "symlink",
            14 => "readlink", 15 => "dup", 16 => "getcwd", 17 => "fchmod",
            18 => "fchown", 19 => "ftruncate",
            _ => "unknown",
        }
    }
}
impl From<Tag> for &'static str {
    #[inline] fn from(t: Tag) -> &'static str { t.name() }
}

#[cfg(unix)]
mod posix_impl {
    use super::*;
    macro_rules! check { ($rc:expr, $tag:expr) => {{
        let rc = $rc; if rc < 0 { return Err(err_with($tag)); } rc
    }}}
    macro_rules! check_p { ($rc:expr, $tag:expr, $path:expr) => {{
        let rc = $rc; if rc < 0 { return Err(err_with_path($tag, $path)); } rc
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
        let n = check!(unsafe { libc::read(fd.native(), buf.as_mut_ptr().cast(), buf.len()) }, Tag::read);
        Ok(n as usize)
    }
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize> {
        let n = check!(unsafe { libc::write(fd.native(), buf.as_ptr().cast(), buf.len()) }, Tag::write);
        Ok(n as usize)
    }
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize> {
        let n = check!(unsafe { libc::pread(fd.native(), buf.as_mut_ptr().cast(), buf.len(), off) }, Tag::pread);
        Ok(n as usize)
    }
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize> {
        let n = check!(unsafe { libc::pwrite(fd.native(), buf.as_ptr().cast(), buf.len(), off) }, Tag::pwrite);
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
        Ok(n as usize)
    }
    pub fn dup(fd: Fd) -> Maybe<Fd> {
        let rc = check!(unsafe { libc::dup(fd.native()) }, Tag::dup);
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
}
#[cfg(unix)]
pub use posix_impl::*;

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
    }
}
#[cfg(windows)]
pub use windows_impl::*;

// `File` high-level helpers — wrap the syscall surface above.
impl File {
    pub fn open(path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        open(path, flags, mode).map(Self)
    }
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Self> {
        openat(dir, path, flags, mode).map(Self)
    }
    pub fn read(&self, buf: &mut [u8]) -> Maybe<usize> { read(self.0, buf) }
    pub fn write(&self, buf: &[u8]) -> Maybe<usize> { write(self.0, buf) }
    pub fn write_all(&self, mut buf: &[u8]) -> Maybe<()> {
        while !buf.is_empty() {
            let n = write(self.0, buf)?;
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
            let n = read(self.0, unsafe {
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
    pub fn stat(&self) -> Maybe<Stat> { fstat(self.0) }
    pub fn close(self) -> Maybe<()> { close(self.0) }
    /// `bun.sys.File.readFrom` — open + read + close.
    pub fn read_from(dir: Fd, path: &ZStr) -> Maybe<Vec<u8>> {
        let f = Self::openat(dir, path, O::RDONLY, 0)?;
        let v = f.read_to_end()?;
        let _ = close(f.0);
        Ok(v)
    }
    /// `bun.sys.File.writeFile` — open + write + close.
    pub fn write_file(dir: Fd, path: &ZStr, data: &[u8]) -> Maybe<()> {
        let f = Self::openat(dir, path, O::WRONLY | O::CREAT | O::TRUNC, 0o644)?;
        f.write_all(data)?;
        close(f.0)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────
pub fn install_output_sink() {
    // B-2: build a real OutputSinkVTable wrapping stderr/make_path/create_file
    // and call bun_core::output::install_output_sink(&STATIC_VTABLE).
}
