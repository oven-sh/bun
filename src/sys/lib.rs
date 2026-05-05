#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_sys` — B-1 minimal compiling surface.
//! Full Phase-A draft (5500 lines, all syscall wrappers) preserved in
//! `lib_draft_b1.rs`. B-2: un-gate per-syscall, wire libc/kernel32/ntdll.

#[cfg(any())] #[path = "lib_draft_b1.rs"] mod draft;
#[cfg(any())] mod fd;
#[cfg(any())] #[path = "File.rs"] pub mod file;
#[cfg(any())] #[path = "Error.rs"] mod error;
#[cfg(any())] mod walker_skippable;
#[cfg(any())] mod coreutils_error_map;
#[cfg(any())] mod libuv_error_map;
#[cfg(any())] #[path = "SignalCode.rs"] mod signal_code;
#[cfg(any())] mod tmp;
#[cfg(any())] pub mod windows;

use core::ffi::{c_char, c_int, c_void};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports from lower-tier crates (PORTING.md crate map).
// ──────────────────────────────────────────────────────────────────────────
pub use bun_core::{Fd, Mode, FileKind, kind_from_mode, Error};
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
fn last_errno() -> i32 {
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
    let mut e = Error::from_errno(last_errno());
    e.syscall = tag.0;
    e
}
#[inline]
fn err_with_path(tag: Tag, path: &ZStr) -> Error {
    let mut e = err_with(tag);
    e.path_ptr = path.as_bytes().as_ptr();
    e.path_len = path.len() as u32;
    e
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
    pub const ftruncate: Tag = Tag(19);
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
    pub fn unlink(path: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::unlink(path.as_ptr()) }, Tag::unlink, path); Ok(())
    }
    pub fn rename(from: &ZStr, to: &ZStr) -> Maybe<()> {
        check_p!(unsafe { libc::rename(from.as_ptr(), to.as_ptr()) }, Tag::rename, from); Ok(())
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
            if n == 0 { return Err(Error::from_errno(libc::EIO)); }
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
