//! Prettier's `getStringWidth`: the number of columns that a text takes.

use super::width_tables::{EMOJI, EMOJI_MODIFIER_BASE, NARROW_EMOJI, WIDE};

fn is_in(table: &[(u32, u32)], c: u32) -> bool {
    let after = table.partition_point(|range| range.0 <= c);
    after > 0 && c <= table[after - 1].1
}

const VARIATION_SELECTOR_16: u32 = 0xFE0F;
const ZERO_WIDTH_JOINER: u32 = 0x200D;
const COMBINING_ENCLOSING_KEYCAP: u32 = 0x20E3;

fn is_skin_tone(c: u32) -> bool {
    (0x1F3FB..=0x1F3FF).contains(&c)
}

fn is_regional_indicator(c: u32) -> bool {
    (0x1F1E6..=0x1F1FF).contains(&c)
}

/// The number of characters at the start of `chars` that are one emoji, in the sense of the
/// `emoji-regex` package. This accepts any sequence that is joined like an emoji, where the
/// package only accepts those that are recommended for interchange.
fn emoji_len(chars: &[u32]) -> usize {
    let at = |i: usize| chars.get(i).copied().unwrap_or(0);
    let first = at(0);
    if matches!(first, 0x23 | 0x2A | 0x30..=0x39) {
        let mark = if at(1) == VARIATION_SELECTOR_16 { 2 } else { 1 };
        return if at(mark) == COMBINING_ENCLOSING_KEYCAP { mark + 1 } else { 0 };
    }
    if is_regional_indicator(first) {
        return if is_regional_indicator(at(1)) { 2 } else { 0 };
    }
    if !is_in(EMOJI, first) {
        return 0;
    }
    let mut len = 0;
    loop {
        let base = at(len);
        len += 1;
        if at(len) == VARIATION_SELECTOR_16
            || (is_skin_tone(at(len)) && is_in(EMOJI_MODIFIER_BASE, base))
        {
            len += 1;
        }
        // The flags of England, Scotland and Wales.
        if base == 0x1F3F4 && (0xE0020..=0xE007E).contains(&at(len)) {
            while (0xE0020..=0xE007E).contains(&at(len)) {
                len += 1;
            }
            if at(len) == 0xE007F {
                len += 1;
            }
        }
        if at(len) == ZERO_WIDTH_JOINER && is_in(EMOJI, at(len + 1)) {
            len += 1;
        } else {
            return len;
        }
    }
}

#[cold]
fn width_of_non_ascii(text: &[u8]) -> u32 {
    let chars: smallvec::SmallVec<[u32; 64]> =
        bstr::ByteSlice::chars(text).map(u32::from).collect();
    let (mut width, mut i) = (0, 0);
    while let Some(&c) = chars.get(i) {
        match emoji_len(&chars[i..]) {
            0 => {}
            len => {
                width += if len == 1 && is_in(NARROW_EMOJI, c) { 1 } else { 2 };
                i += len;
                continue;
            }
        }
        i += 1;
        width += match c {
            0..=0x1F | 0x7F..=0x9F => 0,
            0x20..=0x7E => 1,
            0x300..=0x36F | 0xFE00..=0xFE0F => 0,
            _ if is_in(WIDE, c) => 2,
            _ => 1,
        };
    }
    width
}

/// Whether every byte for which `is_plain` is false is absent. It looks at whole blocks, which
/// the compiler turns into vector instructions.
#[inline]
fn all_bytes(text: &[u8], is_plain: impl Fn(u8) -> bool + Copy) -> bool {
    text.chunks(64).all(|block| block.iter().fold(true, |all, &byte| all & is_plain(byte)))
}

/// Whether the width of every part of `source` that has no tab and no line break is its length.
pub(crate) fn is_width_len(source: &[u8]) -> bool {
    all_bytes(source, |byte| matches!(byte, 0x20..=0x7E | b'\t' | b'\n' | b'\r'))
}

/// `text` has no line breaks. Control characters count as nothing.
#[inline]
pub(crate) fn string_width(text: &[u8]) -> u32 {
    match all_bytes(text, |byte| matches!(byte, 0x20..=0x7F)) {
        true => text.len() as u32,
        false => width_of_non_ascii(text),
    }
}
