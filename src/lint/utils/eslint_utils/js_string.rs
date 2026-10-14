//! JavaScript strings as the HIR stores them: UTF-8, in which half a surrogate pair is the three
//! bytes that its code point would have.

use bun_core::strings;
use std::borrow::Cow;

/// The code points of `units`. Half a surrogate pair is one.
pub(super) fn code_points_of(units: &[u16]) -> impl Iterator<Item = u32> + '_ {
    let mut at = 0;
    std::iter::from_fn(move || {
        let (c, len) = strings::decode_wtf16_raw(units.get(at..).filter(|rest| !rest.is_empty())?);
        at += usize::from(len);
        Some(c)
    })
}

/// `a + b`. The two halves of a surrogate pair that meet become one code point.
pub(super) fn concat<'a>(a: Cow<'a, [u8]>, b: Cow<'a, [u8]>) -> Cow<'a, [u8]> {
    if a.is_empty() {
        return b;
    }
    if b.is_empty() {
        return a;
    }
    let mut text = a.into_owned();
    strings::push_wtf8(&mut text, &b);
    Cow::Owned(text)
}

/// The first index at or after `from` where `needle` is in `units`.
pub(super) fn index_of(units: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let last = units.len().checked_sub(needle.len())?;
    (from..=last).find(|&at| units[at..].starts_with(needle))
}

/// The last index at or before `from` where `needle` is in `units`.
pub(super) fn last_index_of(units: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let last = units.len().checked_sub(needle.len())?;
    (0..=last.min(from))
        .rev()
        .find(|&at| units[at..].starts_with(needle))
}
