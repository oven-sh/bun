//! `uinvchar.cpp`: the invariant characters, the subset of ASCII that all charsets share.

use crate::common::memory::Appendable;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, U_INVARIANT_CONVERSION_ERROR, UErrorCode};
use std::ops::Deref;

/// All of ASCII except the line feed and ``!#$@[\]^`{|}~``.
const INVARIANT_CHARS: [u32; 4] = [0xffff_fbff, 0xffff_ffe5, 0x87ff_fffe, 0x87ff_fffe];

#[inline]
pub(crate) fn uchar_is_invariant(c: u32) -> bool {
    INVARIANT_CHARS
        .get((c >> 5) as usize)
        .is_some_and(|bits| bits & (1 << (c & 0x1f)) != 0)
}

/// `u_UCharsToChars` for one unit: NUL if `u` is not invariant.
#[inline]
pub(crate) fn uchar_to_char(u: u16) -> u8 {
    if uchar_is_invariant(u32::from(u)) {
        u as u8
    } else {
        0
    }
}

/// Returns the C string that `u_UCharsToChars` makes: it ends at the first NUL or unit that is not invariant.
pub(crate) fn invariant_prefix(us: impl IntoIterator<Item = u16>) -> impl Iterator<Item = u8> {
    us.into_iter().map(uchar_to_char).take_while(|&c| c != 0)
}

pub(crate) fn uprv_is_invariant_ustring(s: impl IntoIterator<Item = u16>) -> bool {
    s.into_iter().all(|c| uchar_is_invariant(u32::from(c)))
}

// ICU4C: charstr.cpp, CharString::appendInvariantChars
pub(crate) fn append_invariant_chars(
    dest: &mut (impl Appendable<u8> + Deref<Target = [u8]>),
    uchars: impl ExactSizeIterator<Item = u16> + Clone,
) -> Result<(), UErrorCode> {
    if !uprv_is_invariant_ustring(uchars.clone()) {
        Err(U_INVARIANT_CONVERSION_ERROR)
    } else if dest.len() + uchars.len() >= i32::MAX as usize {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    } else {
        dest.reserve_append(uchars.len())
            .map(|()| dest.add_each(uchars.map(|u| u as u8)))
    }
}

/// Like `append_invariant_chars`, into a new `Vec<u8>` or `SmallChars`.
pub(crate) fn invariant_chars<T: Default + Appendable<u8> + Deref<Target = [u8]>>(
    uchars: impl ExactSizeIterator<Item = u16> + Clone,
) -> Result<T, UErrorCode> {
    let mut chars = T::default();
    append_invariant_chars(&mut chars, uchars).map(|()| chars)
}
