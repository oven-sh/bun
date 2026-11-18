//! What a user takes for a character.

use core::ops::Range;

use crate::api::core::DomString;

unsafe extern "C" {
    /// The start of the grapheme cluster in the low half, and the end in the high half.
    fn Bun__DOM__clusterAt(text: *const u16, length: u32, offset: u32) -> u64;
    safe fn Bun__DOM__isMark(character: u32) -> bool;
}

pub(super) fn cluster_at(text: &DomString, offset: u32) -> Range<u32> {
    const REACH: u32 = 128;
    let from = offset.saturating_sub(REACH);
    let around: Vec<_> = (from..text.len().min(offset + REACH))
        .map(|it| text.unit(it))
        .collect();
    // SAFETY: the pointer and the length are of a slice.
    let found = unsafe { Bun__DOM__clusterAt(around.as_ptr(), around.len() as u32, offset - from) };
    from + found as u32..from + (found >> 32) as u32
}

/// Backspace takes a combining mark off a letter, but the whole of an emoji.
pub(super) fn follows_mark(text: &DomString, offset: u32) -> bool {
    let unit = text.unit(offset - 1);
    !matches!(unit, 0xfe00..=0xfe0f | 0x20e3)
        && (matches!(unit, 0x1160..=0x11ff) || Bun__DOM__isMark(unit.into()))
}

pub(super) fn before_backspace(text: &DomString, offset: u32) -> u32 {
    if offset == 0 || follows_mark(text, offset) {
        offset.saturating_sub(1)
    } else {
        cluster_at(text, offset - 1).start
    }
}

pub(super) fn ends_in_word(text: &DomString, offset: u32) -> bool {
    let last = char::decode_utf16(
        (offset.saturating_sub(2)..offset.min(text.len())).map(|it| text.unit(it)),
    )
    .last();
    last.and_then(Result::ok).is_some_and(|it| {
        it.is_alphanumeric() || matches!(it, '\'' | '’') || Bun__DOM__isMark(it.into())
    })
}
