//! What the flags of `open` ask of `NtCreateFile`.

use crate::{Mode, O};

/// Only JavaScript can ask for these two.
const WRITE_THROUGH: i32 = 0o10000;
const DIRECT: i32 = 0o40000;

/// A hint for the cache.
pub const SEQUENTIAL: i32 = 0o100000;

/// The numbers of `fs.constants`.
const UV_FLAGS: [(i32, i32); 9] = [
    (0x0001, O::WRONLY),
    (0x0002, O::RDWR),
    (0x0008, O::APPEND),
    (0x0100, O::CREAT),
    (0x0200, O::TRUNC),
    (0x0400, O::EXCL),
    (0x0200_0000, DIRECT),
    (0x0400_0000, WRITE_THROUGH),
    (0x0800_0000, WRITE_THROUGH),
];

/// Drops the flags that have no effect.
pub fn from_uv(flags: i32) -> i32 {
    let set = UV_FLAGS.iter().filter(|(uv, _)| flags & uv != 0);
    set.fold(0, |all, (_, ours)| all | ours)
}

pub fn to_uv(flags: i32) -> i32 {
    let set = UV_FLAGS.iter().filter(|(_, ours)| flags & ours != 0);
    set.fold(0, |all, (uv, _)| all | uv)
}

const FILE_WRITE_DATA: u32 = 0x0002;
const FILE_APPEND_DATA: u32 = 0x0004;
const FILE_READ_ATTRIBUTES: u32 = 0x0080;
const FILE_GENERIC_READ: u32 = 0x0012_0089;
const FILE_GENERIC_WRITE: u32 = 0x0012_0116;

const FILE_OPEN: u32 = 1;
const FILE_CREATE: u32 = 2;
const FILE_OPEN_IF: u32 = 3;
const FILE_OVERWRITE_IF: u32 = 5;

const FILE_WRITE_THROUGH: u32 = 0x0002;
const FILE_SEQUENTIAL_ONLY: u32 = 0x0004;
const FILE_NO_INTERMEDIATE_BUFFERING: u32 = 0x0008;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x0020;
const FILE_NON_DIRECTORY_FILE: u32 = 0x0040;
const FILE_OPEN_FOR_BACKUP_INTENT: u32 = 0x4000;
const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

const FILE_ATTRIBUTE_READONLY: u32 = 0x0001;
const FILE_ATTRIBUTE_NORMAL: u32 = 0x0080;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Create {
    pub(crate) access: u32,
    pub(crate) disposition: u32,
    pub(crate) options: u32,
    pub(crate) attributes: u32,
    /// The caller sets the size to 0 behind the open.
    pub(crate) truncate: bool,
}

/// `mode` is without the bits of the umask. `None` if the flags do not go together.
pub(crate) fn translate(flags: i32, mode: Mode) -> Option<Create> {
    let has = |flag| flags & flag != 0;
    let mut access = match (has(O::WRONLY), has(O::RDWR)) {
        (false, false) => FILE_GENERIC_READ,
        (true, false) => FILE_GENERIC_WRITE | FILE_READ_ATTRIBUTES,
        (false, true) => FILE_GENERIC_READ | FILE_GENERIC_WRITE,
        (true, true) => return None,
    };
    if has(O::APPEND) {
        access = access & !FILE_WRITE_DATA | FILE_APPEND_DATA;
    }

    let mut options = FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_FOR_BACKUP_INTENT;
    let disposition = match (has(O::CREAT), has(O::EXCL), has(O::TRUNC)) {
        (false, _, _) => FILE_OPEN,
        (true, false, false) => FILE_OPEN_IF,
        (true, false, true) => FILE_OVERWRITE_IF,
        (true, true, _) => {
            options |= FILE_OPEN_REPARSE_POINT;
            FILE_CREATE
        }
    };
    let truncate = has(O::TRUNC) && !has(O::CREAT);
    if truncate {
        if access & FILE_WRITE_DATA == 0 {
            return None;
        }
        options |= FILE_NON_DIRECTORY_FILE;
    }

    if has(DIRECT) {
        if has(O::APPEND) {
            return None;
        }
        access &= !FILE_APPEND_DATA;
        options |= FILE_NO_INTERMEDIATE_BUFFERING;
    }
    if has(SEQUENTIAL) {
        options |= FILE_SEQUENTIAL_ONLY;
    }
    if has(WRITE_THROUGH) {
        options |= FILE_WRITE_THROUGH;
    }

    let mut attributes = FILE_ATTRIBUTE_NORMAL;
    if has(O::CREAT) && mode & 0o200 == 0 {
        attributes |= FILE_ATTRIBUTE_READONLY;
    }
    Some(Create {
        access,
        disposition,
        options,
        attributes,
        truncate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_the_numbers_of_node() {
        let flags = O::RDWR | O::CREAT | O::EXCL | O::TRUNC | O::APPEND;
        assert_eq!(from_uv(0x70A), flags);
        assert_eq!(to_uv(flags), 0x70A);
        assert_eq!(from_uv(0x3000_1070 | 1), O::WRONLY);
    }

    #[test]
    fn translates_flags() {
        for (uv, access, disposition, options) in [
            (0x000, 0x12_0089, 1, 0x4020),
            (0x400, 0x12_0089, 1, 0x4020),
            (0x002, 0x12_019F, 1, 0x4020),
            (0x201, 0x12_0196, 1, 0x4060),
            (0x301, 0x12_0196, 5, 0x4020),
            (0x701, 0x12_0196, 2, 0x20_4020),
            (0x109, 0x12_0194, 3, 0x4020),
            (0x30A, 0x12_019D, 5, 0x4020),
            (0x108, 0x12_008D, 3, 0x4020),
            (0x0200_0001, 0x12_0192, 1, 0x4028),
            (0x0400_0001, 0x12_0196, 1, 0x4022),
            (0x0C00_0001, 0x12_0196, 1, 0x4022),
        ] {
            let expected = Create {
                access,
                disposition,
                options,
                attributes: 0x80,
                truncate: uv == 0x201,
            };
            assert_eq!(translate(from_uv(uv), 0o644), Some(expected));
        }
        for uv in [0x003, 0x200, 0x209, 0x0200_0009] {
            assert_eq!(translate(from_uv(uv), 0o644), None);
        }
        assert_eq!(translate(SEQUENTIAL, 0).unwrap().options, 0x4024);
        assert_eq!(translate(O::CREAT, 0o444).unwrap().attributes, 0x81);
        assert_eq!(translate(O::RDONLY, 0).unwrap().attributes, 0x80);
    }
}
