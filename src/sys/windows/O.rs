//! The numeric `O_*` values Node exposes as `fs.constants` on Windows (MSVC
//! `_O_*` plus the `UV_FS_O_*` extensions), and the translation to and from
//! the POSIX-shaped `bun_sys::O` values Bun uses internally.

pub const APPEND: i32 = 0x0008;
pub const CREAT: i32 = 0x0100;
pub const EXCL: i32 = 0x0400;
pub const FILEMAP: i32 = 0x2000_0000;
pub const RDONLY: i32 = 0x0000;
pub const RDWR: i32 = 0x0002;
pub const TRUNC: i32 = 0x0200;
pub const WRONLY: i32 = 0x0001;
pub const DIRECT: i32 = 0x0200_0000;
pub const DSYNC: i32 = 0x0400_0000;
pub const SYNC: i32 = 0x0800_0000;

// The POSIX-shaped flag values Bun normalises to internally: `crate::O`, plus
// the Linux values of SYNC/DSYNC/DIRECT, which are zero in `crate::O` on
// Windows but are still recognised here when a caller passes them.
mod bun_o {
    pub(super) use crate::O::{APPEND, CREAT, EXCL, RDWR, TRUNC, WRONLY};
    pub(super) const DSYNC: i32 = 0o10000;
    pub(super) const DIRECT: i32 = 0o40000;
    pub(super) const SYNC: i32 = 0o4010000;
}

/// Convert from internal `bun.O` flags to the Windows `fs.constants` values.
pub fn from_bun_o(c_flags: i32) -> i32 {
    let mut flags: i32 = 0;
    if c_flags & bun_o::WRONLY != 0 {
        flags |= WRONLY;
    }
    if c_flags & bun_o::RDWR != 0 {
        flags |= RDWR;
    }
    if c_flags & bun_o::CREAT != 0 {
        flags |= CREAT;
    }
    if c_flags & bun_o::EXCL != 0 {
        flags |= EXCL;
    }
    if c_flags & bun_o::TRUNC != 0 {
        flags |= TRUNC;
    }
    if c_flags & bun_o::APPEND != 0 {
        flags |= APPEND;
    }
    // `open` rejects SYNC and DSYNC together (EINVAL).
    // `SYNC` (0o4010000) is a superset of `DSYNC` (0o10000), so check
    // SYNC first to emit only `SYNC` when both bits are present.
    // NOTE: `& != 0` is an any-overlap check;
    // a DSYNC-only input also takes this branch.
    if c_flags & bun_o::SYNC != 0 {
        flags |= SYNC;
    } else if c_flags & bun_o::DSYNC != 0 {
        flags |= DSYNC;
    }
    if c_flags & bun_o::DIRECT != 0 {
        flags |= DIRECT;
    }
    if c_flags & FILEMAP != 0 {
        flags |= FILEMAP;
    }
    flags
}

/// Convert from the Windows `fs.constants` values to internal `bun.O` flags.
/// Inverse of [`from_bun_o`]; needed because `fs.constants` exposes the
/// platform's native C values to JavaScript, but internally Bun normalises
/// all flags to the `bun.O` (POSIX-like) representation.
pub fn to_bun_o(windows_flags: i32) -> i32 {
    let mut flags: i32 = 0;
    if windows_flags & WRONLY != 0 {
        flags |= bun_o::WRONLY;
    }
    if windows_flags & RDWR != 0 {
        flags |= bun_o::RDWR;
    }
    if windows_flags & CREAT != 0 {
        flags |= bun_o::CREAT;
    }
    if windows_flags & EXCL != 0 {
        flags |= bun_o::EXCL;
    }
    if windows_flags & TRUNC != 0 {
        flags |= bun_o::TRUNC;
    }
    if windows_flags & APPEND != 0 {
        flags |= bun_o::APPEND;
    }
    if windows_flags & SYNC != 0 {
        flags |= bun_o::SYNC;
    } else if windows_flags & DSYNC != 0 {
        flags |= bun_o::DSYNC;
    }
    if windows_flags & DIRECT != 0 {
        flags |= bun_o::DIRECT;
    }
    if windows_flags & FILEMAP != 0 {
        flags |= FILEMAP;
    }
    flags
}
