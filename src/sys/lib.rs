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
// Syscall fn stubs — signatures only so callers type-check; bodies in B-2.
// ──────────────────────────────────────────────────────────────────────────
macro_rules! stub {
    ($($vis:vis fn $name:ident($($p:ident : $t:ty),* $(,)?) -> $ret:ty;)+) => {
        $($vis fn $name($($p: $t),*) -> $ret { todo!(concat!("bun_sys::", stringify!($name), " — B-2")) })+
    };
}
stub! {
    pub fn open(path: &bun_core::ZStr, flags: i32, mode: Mode) -> Maybe<Fd>;
    pub fn openat(dir: Fd, path: &bun_core::ZStr, flags: i32, mode: Mode) -> Maybe<Fd>;
    pub fn close(fd: Fd) -> Maybe<()>;
    pub fn read(fd: Fd, buf: &mut [u8]) -> Maybe<usize>;
    pub fn write(fd: Fd, buf: &[u8]) -> Maybe<usize>;
    pub fn pread(fd: Fd, buf: &mut [u8], off: i64) -> Maybe<usize>;
    pub fn pwrite(fd: Fd, buf: &[u8], off: i64) -> Maybe<usize>;
    pub fn stat(path: &bun_core::ZStr) -> Maybe<Stat>;
    pub fn fstat(fd: Fd) -> Maybe<Stat>;
    pub fn lstat(path: &bun_core::ZStr) -> Maybe<Stat>;
    pub fn mkdir(path: &bun_core::ZStr, mode: Mode) -> Maybe<()>;
    pub fn unlink(path: &bun_core::ZStr) -> Maybe<()>;
    pub fn rename(from: &bun_core::ZStr, to: &bun_core::ZStr) -> Maybe<()>;
    pub fn symlink(target: &bun_core::ZStr, link: &bun_core::ZStr) -> Maybe<()>;
    pub fn readlink(path: &bun_core::ZStr, buf: &mut [u8]) -> Maybe<usize>;
    pub fn dup(fd: Fd) -> Maybe<Fd>;
    pub fn getcwd(buf: &mut [u8]) -> Maybe<usize>;
    pub fn page_size() -> usize;
}

// ──────────────────────────────────────────────────────────────────────────
// OUTPUT_SINK — bun_core's stderr vtable, installed by us at init (B-0 hook).
// ──────────────────────────────────────────────────────────────────────────
pub fn install_output_sink() {
    // B-2: build a real OutputSinkVTable wrapping stderr/make_path/create_file
    // and call bun_core::output::install_output_sink(&STATIC_VTABLE).
}
