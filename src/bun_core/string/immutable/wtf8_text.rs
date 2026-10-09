//! Text as JavaScript has it, in WTF-8: UTF-8 in which half of a surrogate pair, which the value of
//! a string literal such as `"\uD800"` has, is the three bytes that its code point would have.
//! What is counted in UTF-16 code units is counted as `String.prototype.length` counts.

use super::unicode_draft::decode_wtf8_rune_t_multibyte;
use super::{
    UNICODE_REPLACEMENT, decode_wtf16_raw, element_length_utf8_into_utf16, first_non_ascii,
    index_of_char_usize, is_valid_utf8, push_codepoint_wtf8, wtf8_byte_sequence_length,
    wtf8_to_utf16_alloc,
};

/// The code point that starts at `at`, and its length in bytes, which is 0 at the end of `text`.
/// Half of a surrogate pair is itself. A byte that is part of no sequence is U+FFFD, one byte long.
#[inline]
pub fn wtf8_codepoint_at(text: &[u8], at: usize) -> (u32, usize) {
    let Some((&first, _)) = text.get(at..).and_then(<[u8]>::split_first) else {
        return (u32::MAX, 0);
    };
    if first < 0x80 {
        return (u32::from(first), 1);
    }
    let len = wtf8_byte_sequence_length(first);
    if let Some(sequence) = text.get(at..at + usize::from(len)).filter(|_| len > 1) {
        let mut bytes = [0u8; 4];
        bytes[..sequence.len()].copy_from_slice(sequence);
        let cp = decode_wtf8_rune_t_multibyte(bytes, len, u32::MAX);
        if cp != u32::MAX {
            return (cp, usize::from(len));
        }
    }
    (UNICODE_REPLACEMENT, 1)
}

/// The code points of `text`, each with the offset in bytes where it starts: `[...text]`. See
/// [`wtf8_codepoint_at`].
#[inline]
pub fn wtf8_codepoints(text: &[u8]) -> Wtf8Codepoints<'_> {
    Wtf8Codepoints { text, at: 0 }
}

#[derive(Copy, Clone)]
pub struct Wtf8Codepoints<'t> {
    text: &'t [u8],
    at: usize,
}

impl Iterator for Wtf8Codepoints<'_> {
    type Item = (usize, u32);

    #[inline]
    fn next(&mut self) -> Option<(usize, u32)> {
        let at = self.at;
        let (cp, size) = wtf8_codepoint_at(self.text, at);
        if size == 0 {
            return None;
        }
        self.at += size;
        Some((at, cp))
    }
}

/// `[...text].length`
pub fn wtf8_codepoint_count(text: &[u8]) -> usize {
    match first_non_ascii(text) {
        None => text.len(),
        Some(_) => wtf8_codepoints(text).count(),
    }
}

/// The first code point of `text`.
#[inline]
pub fn wtf8_first_codepoint(text: &[u8]) -> Option<u32> {
    wtf8_codepoints(text).next().map(|it| it.1)
}

/// The number of UTF-16 code units of the code point `cp`.
#[inline]
pub const fn codepoint_len_utf16(cp: u32) -> u32 {
    if cp > 0xFFFF { 2 } else { 1 }
}

/// `text.length`
pub fn wtf8_len_utf16(text: &[u8]) -> u32 {
    match first_non_ascii(text) {
        None => text.len() as u32,
        Some(_) if is_valid_utf8(text) => element_length_utf8_into_utf16(text) as u32,
        Some(_) => wtf8_codepoints(text)
            .map(|it| codepoint_len_utf16(it.1))
            .sum(),
    }
}

/// The offset in bytes of the UTF-16 index `index` of `text`. An index past the end is the length
/// of `text`, and one in the middle of a surrogate pair is the start of the pair.
pub fn wtf8_offset_of_utf16_index(text: &[u8], index: u32) -> usize {
    let mut units = 0;
    for (at, cp) in wtf8_codepoints(text) {
        units += codepoint_len_utf16(cp);
        if units > index {
            return at;
        }
    }
    text.len()
}

/// `text.slice(start, end)` for indices that are not negative.
pub fn wtf8_slice_by_utf16(text: &[u8], start: u32, end: u32) -> &[u8] {
    let from = wtf8_offset_of_utf16_index(text, start);
    let to = wtf8_offset_of_utf16_index(text, end).max(from);
    text.get(from..to).unwrap_or_default()
}

/// Append `cp`, a code point or a UTF-16 code unit, to `buf`: a trail surrogate joins the lead
/// surrogate that `buf` ends with, as in `String.fromCharCode(0xD83D, 0xDE00)`.
pub fn push_codepoint_wtf8_joined(buf: &mut Vec<u8>, mut cp: u32) {
    if let (0xDC00..=0xDFFF, [.., 0xED, second @ 0xA0..=0xAF, third]) = (cp, &buf[..]) {
        let lead = 0xD000 | u32::from(second & 0x3F) << 6 | u32::from(third & 0x3F);
        cp = 0x1_0000 + ((lead - 0xD800) << 10) + (cp - 0xDC00);
        buf.truncate(buf.len() - 3);
    }
    push_codepoint_wtf8(buf, cp);
}

/// `buf += more`: the two halves of a surrogate pair that meet become one code point.
pub fn push_wtf8(buf: &mut Vec<u8>, more: &[u8]) {
    match *more {
        [0xED, second @ 0xB0..=0xBF, third, ref rest @ ..] => {
            let trail = 0xD000 | u32::from(second & 0x3F) << 6 | u32::from(third & 0x3F);
            push_codepoint_wtf8_joined(buf, trail);
            buf.extend_from_slice(rest);
        }
        _ => buf.extend_from_slice(more),
    }
}

/// Whether `text` has half of a surrogate pair.
pub fn wtf8_has_surrogate(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = index_of_char_usize(rest, 0xED) {
        if matches!(rest.get(at + 1), Some(0xA0..=0xBF)) {
            return true;
        }
        rest = &rest[at + 1..];
    }
    false
}

/// `buf += text.toWellFormed()`: half of a surrogate pair becomes U+FFFD, and what is appended is
/// UTF-8 if `text` is WTF-8.
pub fn push_wtf8_well_formed(buf: &mut Vec<u8>, mut text: &[u8]) {
    while let Some(at) = index_of_char_usize(text, 0xED) {
        let (before, rest) = text.split_at(at);
        buf.extend_from_slice(before);
        match rest {
            [0xED, 0xA0..=0xBF, 0x80..=0xBF, after @ ..] => {
                buf.extend_from_slice("\u{FFFD}".as_bytes());
                text = after;
            }
            _ => {
                buf.push(0xED);
                text = &rest[1..];
            }
        }
    }
    buf.extend_from_slice(text);
}

/// The UTF-16 code units of `text`. [`wtf8_to_utf16_alloc`] for ASCII too.
pub fn wtf8_to_utf16(text: &[u8]) -> Vec<u16> {
    wtf8_to_utf16_alloc(text).unwrap_or_else(|| text.iter().map(|&byte| u16::from(byte)).collect())
}

/// The text that has the UTF-16 code units `units`. Half of a surrogate pair stays what it is.
pub fn wtf16_to_wtf8(units: &[u16]) -> Vec<u8> {
    let mut text = Vec::with_capacity(units.len());
    let mut rest = units;
    while !rest.is_empty() {
        let (cp, len) = decode_wtf16_raw(rest);
        push_codepoint_wtf8(&mut text, cp);
        rest = &rest[usize::from(len)..];
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wtf8_codepoint_at_reads_what_push_codepoint_wtf8_writes() {
        for cp in 0..=0x10FFFF {
            let mut text = vec![b'a'];
            super::super::push_codepoint_wtf8(&mut text, cp);
            assert_eq!(
                wtf8_codepoint_at(&text, 1),
                (cp, text.len() - 1),
                "U+{cp:04X}"
            );
            assert_eq!(
                wtf8_len_utf16(&text),
                1 + codepoint_len_utf16(cp),
                "U+{cp:04X}"
            );
        }
    }

    #[test]
    fn wtf8_codepoint_at_takes_one_byte_of_what_is_no_sequence() {
        let not_sequences: &[&[u8]] = &[
            b"\x80",
            b"\xC0\x80",
            b"\xC1\xBF",
            b"\xC2",
            b"\xC2a",
            b"\xE0\x9F\xBF",
            b"\xE2\x82",
            b"\xF0\x8F\xBF\xBF",
            b"\xF0\x9F\x98",
            b"\xF4\x90\x80\x80",
            b"\xF5\x80\x80\x80",
            b"\xFF",
        ];
        for text in not_sequences {
            assert_eq!(wtf8_codepoint_at(text, 0), (0xFFFD, 1), "{text:x?}");
            assert_eq!(wtf8_len_utf16(text), text.len() as u32, "{text:x?}");
        }
        assert_eq!(wtf8_codepoint_at(b"a", 1), (u32::MAX, 0));
        assert_eq!(wtf8_codepoint_at(b"a", 9), (u32::MAX, 0));
    }

    #[test]
    fn utf16_indices_are_those_of_javascript() {
        // "a😀\uD800é"
        let text = b"a\xF0\x9F\x98\x80\xED\xA0\x80\xC3\xA9";
        assert_eq!(wtf8_len_utf16(text), 5);
        assert_eq!(wtf8_codepoint_count(text), 4);
        let offsets: Vec<usize> = (0..7)
            .map(|index| wtf8_offset_of_utf16_index(text, index))
            .collect();
        assert_eq!(offsets, [0, 1, 1, 5, 8, 10, 10]);
        assert_eq!(wtf8_slice_by_utf16(text, 3, 4), b"\xED\xA0\x80");
    }

    #[test]
    fn halves_that_meet_are_one_code_point() {
        let mut text = Vec::new();
        for unit in [0x61, 0xD83D, 0xDE00, 0xDE00, 0xD83D, 0x61, 0xD83D] {
            push_codepoint_wtf8_joined(&mut text, unit);
        }
        let expected = b"a\xF0\x9F\x98\x80\xED\xB8\x80\xED\xA0\xBDa\xED\xA0\xBD";
        assert_eq!(text, expected);
        assert!(wtf8_has_surrogate(&text));
        assert_eq!(
            wtf8_to_utf16(&text),
            [0x61, 0xD83D, 0xDE00, 0xDE00, 0xD83D, 0x61, 0xD83D]
        );
        assert_eq!(wtf16_to_wtf8(&wtf8_to_utf16(&text)), text);
        push_wtf8(&mut text, b"\xED\xB8\x80b");
        assert!(text.ends_with(b"a\xF0\x9F\x98\x80b"));
        let mut well_formed = Vec::new();
        push_wtf8_well_formed(&mut well_formed, b"\xED\x9F\xBF\xED\xA0\x80\xED");
        assert_eq!(well_formed, b"\xED\x9F\xBF\xEF\xBF\xBD\xED");
        assert!(!wtf8_has_surrogate("\u{D7FF}".as_bytes()));
        assert_eq!(wtf8_to_utf16(b"ab"), [0x61, 0x62]);
    }
}
