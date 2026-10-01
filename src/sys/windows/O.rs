//! The numeric `O_*` values Node exposes as `fs.constants` on Windows: MSVC's
//! `_O_*`, which are `bun_sys::O`'s, plus the `UV_FS_O_*` extensions.

pub use crate::O::{APPEND, CREAT, EXCL, RDONLY, RDWR, SEQUENTIAL, TRUNC, WRONLY};

pub const FILEMAP: i32 = 0x2000_0000;
pub const DIRECT: i32 = 0x0200_0000;
pub const DSYNC: i32 = 0x0400_0000;
pub const SYNC: i32 = 0x0800_0000;

/// The bits `open` reads.
const READ: i32 =
    WRONLY | RDWR | CREAT | EXCL | TRUNC | APPEND | SEQUENTIAL | FILEMAP | DIRECT | DSYNC | SYNC;

const _: () = {
    use crate::O::{CLOEXEC, DIRECTORY, NOATIME, NOFOLLOW, NONBLOCK, PATH};
    assert!(READ & (CLOEXEC | DIRECTORY | NOATIME | NOFOLLOW | NONBLOCK | PATH) == 0);
};

/// A numeric `flags` from JS as `bun_sys::O` values. The other `_O_*` bits are
/// dropped: `_O_WTEXT` and its neighbours have the numbers of `O::DIRECTORY`,
/// `O::NOFOLLOW` and `O::NOATIME`, which MSVC lacks. `SYNC` wins over `DSYNC`;
/// `open` refuses the two together.
pub fn from_js(flags: i32) -> i32 {
    let flags = flags & READ;
    if flags & SYNC != 0 {
        flags & !DSYNC
    } else {
        flags
    }
}
