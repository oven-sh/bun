//! Prettier's `getStringWidth`: the number of columns that a text takes.

use super::width_tables::{EMOJI, EMOJI_MODIFIER_BASE, NARROW_EMOJI, OXFMT_ZERO_WIDTH, WIDE};
use crate::options::Flavor;

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
        return if at(mark) == COMBINING_ENCLOSING_KEYCAP {
            mark + 1
        } else {
            0
        };
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

/// To the crate `unicode-width`, which oxfmt measures with, every character up to U+00A0 in a text is as wide as a letter.
/// To Prettier a control character has no width.
fn control_character_is_a_column(flavor: Flavor) -> bool {
    flavor.is_oxfmt()
}

#[cold]
fn width_of_non_ascii(text: &[u8], flavor: Flavor) -> u32 {
    let mut width = 0;
    let mut rest = text;
    // ASCII only takes a closer look next to other characters: `#` is an emoji before a keycap, or joined to one.
    while !rest.is_empty() {
        let ascii = bun_core::strings::first_non_ascii(rest).map_or(rest.len(), |at| at as usize);
        let plain = if ascii == rest.len() {
            ascii
        } else {
            ascii.saturating_sub(1)
        };
        width += rest[..plain]
            .iter()
            .filter(|&&byte| is_printable(byte) || control_character_is_a_column(flavor))
            .count() as u32;
        rest = &rest[plain..];
        let mut len = ascii - plain;
        loop {
            len += rest[len..]
                .iter()
                .take_while(|byte| !byte.is_ascii())
                .count();
            if len == rest.len() || !rest[..len].ends_with("\u{200D}".as_bytes()) {
                break;
            }
            len += 1;
        }
        width += width_of_characters(&rest[..len], flavor);
        rest = &rest[len..];
    }
    width
}

/// Whether `c` takes no column of its own behind `before`, to the crate `unicode-width`: the other ligatures that it
/// knows, of which `before` has one column.
fn ends_ligature(before: &[u32], c: u32) -> bool {
    match c {
        // A Khmer letter under another one.
        0x1780..=0x1782
        | 0x1784..=0x1787
        | 0x1789..=0x178C
        | 0x178E..=0x1793
        | 0x1795..=0x1798
        | 0x179B..=0x179D
        | 0x17A0
        | 0x17A2
        | 0x17A7
        | 0x17AB..=0x17AC
        | 0x17AF => before.ends_with(&[0x17D2]),
        // Two tone letters of Lisu.
        0xA4FC..=0xA4FD => matches!(before, [.., 0xA4F8..=0xA4FB]),
        // Hebrew alef and lamed, two consonants of Tifinagh, Old Turkic, each with a joiner.
        0x5DC => before.ends_with(&[0x5D0, 0x200D]),
        0x2D31..=0x2D65 | 0x2D6F => matches!(before, [.., 0x2D31..=0x2D65 | 0x2D6F, 0x200D]),
        0x10C03 => before.ends_with(&[0x10C32, 0x200D]),
        _ => false,
    }
}

fn width_of_characters(text: &[u8], flavor: Flavor) -> u32 {
    let chars: smallvec::SmallVec<[u32; 64]> =
        bstr::ByteSlice::chars(text).map(u32::from).collect();
    let (mut width, mut i) = (0, 0);
    // To the crate `unicode-width`, an Arabic lam and the alef after it are one ligature.
    let mut follows_lam = false;
    while let Some(&c) = chars.get(i) {
        let is_alef_of_ligature = follows_lam
            && flavor.is_oxfmt()
            && matches!(
                c,
                0x622 | 0x623 | 0x625 | 0x627 | 0x671..=0x673 | 0x675 | 0x773 | 0x774
            );
        // A joiner or a non-joiner between them keeps them apart.
        follows_lam = matches!(c, 0x644 | 0x6B5..=0x6B8 | 0x76A | 0x8A6 | 0x8C7)
            || (follows_lam
                && is_in(OXFMT_ZERO_WIDTH, c)
                && !matches!(
                    c,
                    0x605 | 0x890..=0x891 | 0x8E2 | 0x200C..=0x200D | 0x2065..=0x2069
                ));
        match emoji_len(&chars[i..]) {
            0 => {}
            len => {
                width += if len == 1 && is_in(NARROW_EMOJI, c) {
                    1
                } else {
                    2
                };
                i += len;
                continue;
            }
        }
        i += 1;
        width += match c {
            0..=0x1F | 0x7F..=0x9F => u32::from(control_character_is_a_column(flavor)),
            0x20..=0x7E => 1,
            0x300..=0x36F | 0xFE00..=0xFE0F => 0,
            _ if is_alef_of_ligature => 0,
            _ if flavor.is_oxfmt() && ends_ligature(&chars[..i - 1], c) => 0,
            _ if flavor.is_oxfmt() && is_in(OXFMT_ZERO_WIDTH, c) => 0,
            _ if is_in(WIDE, c) => 2,
            _ => 1,
        };
    }
    width
}

/// Whether `is_plain` is true for every byte. It looks at whole blocks without a branch, which the
/// compiler turns into vector instructions, so `is_plain` has to be free of branches too.
#[inline]
fn all_bytes(text: &[u8], is_plain: impl Fn(u8) -> bool + Copy) -> bool {
    let (blocks, rest) = text.as_chunks::<64>();
    let is_block_plain = |block: &[u8]| {
        block
            .iter()
            .fold(0, |odd, &byte| odd | u8::from(!is_plain(byte)))
            == 0
    };
    blocks.iter().all(|block| is_block_plain(block)) && is_block_plain(rest)
}

/// 0x20 to 0x7E
#[inline]
fn is_printable(byte: u8) -> bool {
    byte.wrapping_sub(0x20) < 0x5F
}

/// Whether `text` is one line of ASCII, as wide as it is long.
#[inline]
pub(crate) fn is_all_printable(text: &[u8]) -> bool {
    all_bytes(text, is_printable)
}

/// The number of bytes that a bit of [`OddBlocks`] is about.
const BLOCK: usize = 64;

/// Which blocks of a text have something in them that takes a closer look: a character whose width
/// is not 1, other than a tab or a line break, or a backslash.
#[derive(Default)]
pub(crate) struct OddBlocks(Vec<u64>);

impl OddBlocks {
    pub(crate) fn mark(&mut self, source: &[u8]) {
        let is_plain = |byte: u8| {
            (is_printable(byte) & (byte != b'\\'))
                | (byte == b'\t')
                | (byte == b'\n')
                | (byte == b'\r')
        };
        self.0.clear();
        self.0.extend(source.chunks(BLOCK * 64).map(|blocks| {
            let (blocks, rest) = blocks.as_chunks::<BLOCK>();
            let marks = blocks.iter().rev().fold(0, |marks, block| {
                marks << 1 | u64::from(!all_bytes(block, is_plain))
            });
            marks | u64::from(!all_bytes(rest, is_plain)) << (blocks.len() % 64)
        }));
    }

    /// Whether the text from `start` to `end`, which has no tab and no line break, is as wide as it
    /// is long and has no backslash. It can be so without this saying so.
    #[inline]
    pub(crate) fn is_plain(&self, start: u32, end: u32) -> bool {
        let is_odd = |block: usize| {
            self.0
                .get(block / 64)
                .is_none_or(|marks| marks >> (block % 64) & 1 != 0)
        };
        !(start as usize / BLOCK..=end as usize / BLOCK).any(is_odd)
    }
}

/// `text` has no line breaks.
#[inline]
pub(crate) fn string_width(text: &[u8]) -> u32 {
    string_width_as(text, Flavor::Prettier)
}

/// The same as `flavor` counts.
#[inline]
pub(crate) fn string_width_as(text: &[u8], flavor: Flavor) -> u32 {
    match all_bytes(text, |byte| is_printable(byte) | (byte == 0x7F)) {
        true => text.len() as u32,
        false => width_of_non_ascii(text, flavor),
    }
}
