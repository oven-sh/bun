//! `bun_winfs` — Bun's native Windows filesystem engine (the libuv
//! `fs__stat*`/`fs__open`/`fs__read`/`fs__write` replacement).
//!
//! The stat family (`stat`/`lstat`/`fstat`), the open/read/write family
//! (`open`/`read`/`write`/`ftruncate`/`fsync`/`close`), the links/dirs
//! family (`readlink`/`symlink`/`unlink`/`rmdir`/`rename`/`link`/`mkdir`),
//! the directory-enumeration engine (`DirIter`, the scandir/opendir
//! replacement), and the misc-metadata family (`utimes`/`chmod`/`chown`/
//! `access`/`realpath`/`statfs`/`copyfile`/`mkdtemp`/`mkstemp`) over raw
//! NUL-terminated wide paths and HANDLEs. Design
//! contracts are tracked in `src/sys/windows/quirks/` (`// quirk: <ID>` annotations
//! reference ledger entries); the reference implementation is libuv
//! `src/win/fs.c`, ported per the `fs-meta.md`, `fs-open-io.md` and
//! `fs-links-dir.md` ledger areas. Path conversion (WTF-8 ↔ UTF-16), `Fd`
//! mapping, and errno translation are the `bun_sys` wrapper's job, not this
//! crate's.
//!
//! Error policy: this crate traffics in raw `Win32Error`/`NTSTATUS` and never
//! produces an errno — consumers translate exactly once at their boundary
//! via `bun_sys::windows::win_error`. // quirk: SOCK-58

pub mod fsio;
pub mod fslnk;
pub mod fsmisc;
pub mod readdir;
pub mod stat;

#[cfg(windows)]
pub use fsio::{OpenFlags, close, fdatasync, fsync, ftruncate, open_path, read_at, write_at};
#[cfg(windows)]
pub use fslnk::{
    ReadlinkTarget, SymlinkFlags, link_path, mkdir_path, readlink_path, rename_path, rmdir_path,
    symlink_path, unlink_path,
};
#[cfg(windows)]
pub use fsmisc::{
    AccessMode, CopyFileFlags, FileTimeSpec, WindowsStatFs, access_path, chmod_path, chown_path,
    copyfile_path, fchmod_handle, fchown_handle, futimes_handle, lchown_path, lutimes_path,
    mkdtemp_path, mkstemp_path, realpath_path, statfs_path, utimes_path,
};
#[cfg(windows)]
pub use readdir::{DirEntry, DirIter, DirentKind};
#[cfg(windows)]
pub use stat::{Timespec, WindowsStat, fstat_handle, lstat_path, stat_path};
