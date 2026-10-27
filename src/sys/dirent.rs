//! Parses records from a `getdents64`, `getdirentries64` or `getdents` buffer. A sandbox can emulate
//! the syscall, so every length in a record is bounds-checked.

use crate::{E, Error, Tag};

/// Describes a record's field offsets. Every layout has `d_ino` at 0 and `d_reclen` at 16.
pub trait Layout {
    const D_TYPE: usize;
    /// `None` on Linux, where the name is only NUL-terminated.
    const D_NAMLEN: Option<usize>;
    /// Offset of `d_name[0]`, which is also the header size.
    const D_NAME: usize;
    /// True on Darwin and FreeBSD, which mark a removed entry with inode 0.
    const INODE_ZERO_IS_REMOVED: bool;
    /// False on platforms whose FAT driver can report an entry with a blank 8.3 name.
    const EMPTY_NAME_IS_MALFORMED: bool;
}

const D_INO: usize = 0;
const D_RECLEN: usize = 16;

#[cfg(any(target_os = "linux", target_os = "android"))]
pub struct Linux;
#[cfg(any(target_os = "linux", target_os = "android"))]
impl Layout for Linux {
    const D_TYPE: usize = 18;
    const D_NAMLEN: Option<usize> = None;
    const D_NAME: usize = 19;
    const INODE_ZERO_IS_REMOVED: bool = false;
    const EMPTY_NAME_IS_MALFORMED: bool = true;
}
#[cfg(any(target_os = "linux", target_os = "android"))]
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(libc::dirent64, d_ino) == D_INO);
    assert!(offset_of!(libc::dirent64, d_reclen) == D_RECLEN);
    assert!(offset_of!(libc::dirent64, d_type) == Linux::D_TYPE);
    assert!(offset_of!(libc::dirent64, d_name) == Linux::D_NAME);
};

#[cfg(target_os = "macos")]
pub struct Darwin;
#[cfg(target_os = "macos")]
impl Layout for Darwin {
    const D_TYPE: usize = 20;
    const D_NAMLEN: Option<usize> = Some(18);
    const D_NAME: usize = 21;
    const INODE_ZERO_IS_REMOVED: bool = true;
    const EMPTY_NAME_IS_MALFORMED: bool = false;
}
#[cfg(target_os = "macos")]
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(libc::dirent, d_ino) == D_INO);
    assert!(offset_of!(libc::dirent, d_reclen) == D_RECLEN);
    assert!(offset_of!(libc::dirent, d_namlen) == 18);
    assert!(offset_of!(libc::dirent, d_type) == Darwin::D_TYPE);
    assert!(offset_of!(libc::dirent, d_name) == Darwin::D_NAME);
};

#[cfg(target_os = "freebsd")]
pub struct FreeBsd;
#[cfg(target_os = "freebsd")]
impl Layout for FreeBsd {
    const D_TYPE: usize = 18;
    const D_NAMLEN: Option<usize> = Some(20);
    const D_NAME: usize = 24;
    const INODE_ZERO_IS_REMOVED: bool = true;
    const EMPTY_NAME_IS_MALFORMED: bool = false;
}
#[cfg(target_os = "freebsd")]
const _: () = {
    use core::mem::offset_of;
    assert!(offset_of!(libc::dirent, d_fileno) == D_INO);
    assert!(offset_of!(libc::dirent, d_reclen) == D_RECLEN);
    assert!(offset_of!(libc::dirent, d_namlen) == 20);
    assert!(offset_of!(libc::dirent, d_type) == FreeBsd::D_TYPE);
    assert!(offset_of!(libc::dirent, d_name) == FreeBsd::D_NAME);
};

#[cfg(any(target_os = "linux", target_os = "android"))]
pub type Native = Linux;
#[cfg(target_os = "macos")]
pub type Native = Darwin;
#[cfg(target_os = "freebsd")]
pub type Native = FreeBsd;

pub struct Record<'a> {
    /// Offset of the next record, with `at < next <= filled.len()`.
    pub next: usize,
    /// `None` for records that walkers skip, such as `.`, `..` and removed entries.
    pub entry: Option<Entry<'a>>,
}

pub struct Entry<'a> {
    /// `d_name` without its NUL. The NUL is the next byte and is inside the record.
    pub name: &'a [u8],
    pub d_type: u8,
    pub ino: u64,
}

/// Parses the record at `filled[at..]`, where `filled` is the part of the buffer the syscall wrote.
/// Returns `None` if the record is malformed.
#[inline]
pub fn parse<L: Layout>(filled: &[u8], at: usize) -> Option<Record<'_>> {
    let rest = filled.get(at..)?;
    let header = rest.get(..L::D_NAME)?;
    let u16_at = |offset: usize| {
        Some(usize::from(u16::from_ne_bytes(
            *header.get(offset..)?.first_chunk()?,
        )))
    };

    let reclen = u16_at(D_RECLEN)?;
    let name_field = rest.get(L::D_NAME..reclen)?;
    let skipped = Some(Record {
        next: at + reclen,
        entry: None,
    });

    let ino = u64::from_ne_bytes(*header.get(D_INO..)?.first_chunk()?);
    if L::INODE_ZERO_IS_REMOVED && ino == 0 {
        return skipped;
    }

    let (name, unreported) = match L::D_NAMLEN {
        Some(offset) => {
            let namlen = u16_at(offset)?;
            if *name_field.get(namlen)? != 0 {
                return None;
            }
            // C APIs stop at the first NUL, which can come before `d_namlen`.
            let read_by_c = matches!(*name_field, [0, ..] | [b'.', 0, ..] | [b'.', b'.', 0, ..]);
            (name_field.get(..namlen)?, read_by_c)
        }
        None => {
            // A scalar loop here is visible in startup profiles for large directories.
            let nul = bun_core::strings::index_of_char_usize(name_field, 0);
            let nul = nul.unwrap_or(name_field.len());
            name_field.get(nul)?;
            let name = name_field.get(..nul)?;
            (name, nul <= 2 && matches!(name, b"" | b"." | b".."))
        }
    };
    if unreported {
        // An empty name resolves to the directory itself, so a recursive walk would never end.
        if L::EMPTY_NAME_IS_MALFORMED && name.is_empty() {
            return None;
        }
        return skipped;
    }

    Some(Record {
        next: at + reclen,
        entry: Some(Entry {
            name,
            d_type: *header.get(L::D_TYPE)?,
            ino,
        }),
    })
}

/// Sentinel `end_index` for a walk that hit a malformed record. It's larger than any cursor, so the
/// walker never refills, and larger than any buffer, so `record_at` never parses.
const ENDED: usize = usize::MAX;

/// Ends a walk at a malformed record. The first call returns `EIO`, like the kernel does for a bad
/// FUSE reply. Later calls return end of directory.
#[cold]
// Not `#[inline(never)]`: an outlined call pushes `next` past the inline threshold in the recursive
// `readdirSync` loops.
pub fn end_walk<T>(end_index: &mut usize, syscall: Tag) -> Result<Option<T>, Error> {
    if *end_index == ENDED {
        return Ok(None);
    }
    *end_index = ENDED;
    Err(Error::from_code(E::EIO, syscall))
}
