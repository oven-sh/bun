//! Contracts of single headers, one file each. This file has the raw-pointer helpers that they share.

pub(crate) mod ubrk;
pub(crate) mod ulistformatter;
pub(crate) mod uloc;

use super::Unit;

/// Returns an empty slice if `s` is null.
/// SAFETY: `s` is null or points to `length` values that are not written during `'a`.
pub(crate) unsafe fn slice<'a, T>(s: *const T, length: usize) -> &'a [T] {
    // WTF's empty string is 8-bit, so the pointer to its 16-bit form may be misaligned.
    if s.is_null() || length == 0 {
        return &[];
    }
    // SAFETY: `s` is not null.
    unsafe { std::slice::from_raw_parts(s, length) }
}

/// Returns the units before the NUL, at most `limit`.
/// SAFETY: `s` points to a NUL-terminated string, or to `limit` units, that is not written during `'a`.
pub(crate) unsafe fn before_nul<'a, T: Unit>(s: *const T, limit: usize) -> &'a [T] {
    let mut length = 0;
    // SAFETY: no unit before this one is the NUL.
    while length < limit && unsafe { *s.add(length) } != T::default() {
        length += 1;
    }
    // SAFETY: `length` units have been read.
    unsafe { slice(s, length) }
}
