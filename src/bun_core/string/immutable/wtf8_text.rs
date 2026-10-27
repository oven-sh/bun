//! Text as JavaScript has it, in WTF-8: UTF-8 in which half of a surrogate pair, which the value of
//! a string literal such as `"\uD800"` has, is the three bytes that its code point would have.
//! What is counted in UTF-16 code units is counted as `String.prototype.length` counts.

use super::unicode_draft::decode_wtf8_rune_t_multibyte;
use super::{
    UNICODE_REPLACEMENT, decode_wtf16_raw, element_length_utf8_into_utf16, first_non_ascii,
    index_of_char_usize, is_valid_utf8, push_codepoint_wtf8, wtf8_byte_sequence_length,
    wtf8_to_utf16_alloc,
};
use bun_simdutf_sys::simdutf;

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

/// What [`wtf8_step`] found.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Wtf8Step {
    /// U+FFFD if `replaced`.
    pub code_point: u32,
    /// The bytes to go on by: 1 or more.
    pub len: usize,
    /// The bytes are no sequence of WTF-8.
    pub replaced: bool,
}

/// The code point that non-empty `text` starts with. Ill-formed bytes are one U+FFFD per maximal subpart, as `TextDecoder` reads them.
#[inline(always)]
pub fn wtf8_step(text: &[u8]) -> Wtf8Step {
    // Decodes in place: this is the head of the loop that prints every string, and `wtf8_codepoint_at` copies the bytes first.
    debug_assert!(!text.is_empty());
    // `byte ^ 0x80` is under 0x40 for a continuation byte, and is then the six bits it carries.
    let (code_point, len) = match *text {
        [b0 @ ..=0x7F, ..] => (u32::from(b0), 1),
        [b0 @ 0xC2..=0xDF, b1, ..] if b1 ^ 0x80 < 0x40 => {
            ((u32::from(b0) & 0x1F) << 6 | u32::from(b1 ^ 0x80), 2)
        }
        [b0 @ 0xE0..=0xEF, b1, b2, ..] => {
            let (x1, x2) = (u32::from(b1 ^ 0x80), u32::from(b2 ^ 0x80));
            let cp = (u32::from(b0) & 0x0F) << 12 | x1 << 6 | x2;
            // Under U+0800 is an overlong form. Half of a surrogate pair is a sequence here.
            if (x1 | x2) >= 0x40 || cp < 0x800 {
                return wtf8_step_replaced(text);
            }
            (cp, 3)
        }
        [b0 @ 0xF0..=0xF4, b1, b2, b3, ..] => {
            let (x1, x2, x3) = (
                u32::from(b1 ^ 0x80),
                u32::from(b2 ^ 0x80),
                u32::from(b3 ^ 0x80),
            );
            let cp = (u32::from(b0) & 0x07) << 18 | x1 << 12 | x2 << 6 | x3;
            if (x1 | x2 | x3) >= 0x40 || !(0x1_0000..=0x10_FFFF).contains(&cp) {
                return wtf8_step_replaced(text);
            }
            (cp, 4)
        }
        _ => return wtf8_step_replaced(text),
    };
    Wtf8Step {
        code_point,
        len,
        replaced: false,
    }
}

#[cold]
#[inline(never)]
fn wtf8_step_replaced(text: &[u8]) -> Wtf8Step {
    let cut = (text.utf8_chunks().next()).map_or(1, |chunk| chunk.invalid().len());
    Wtf8Step {
        code_point: UNICODE_REPLACEMENT,
        len: cut.max(1),
        replaced: true,
    }
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

/// `text.length` as [`wtf8_decoded_units`] reads `text`.
pub fn wtf8_decoded_len_utf16(text: &[u8]) -> u32 {
    match first_non_ascii(text) {
        None => text.len() as u32,
        // A short text is decoded: the two calls of simdutf cost more.
        Some(_) if text.len() > DECODED_BLOCK && is_valid_utf8(text) => {
            element_length_utf8_into_utf16(text) as u32
        }
        Some(ascii) => match code_unit_at_from(text, ascii as usize, ascii, u32::MAX) {
            Wtf8CodeUnitAt::Past(len) => len,
            Wtf8CodeUnitAt::Unit { .. } => u32::MAX,
        },
    }
}

/// What [`wtf8_code_unit_at`] finds at an index.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Wtf8CodeUnitAt<'t> {
    /// The code unit and the bytes of its code point. No bytes: it is U+FFFD for ill-formed bytes.
    Unit {
        unit: u16,
        sequence: Option<&'t [u8]>,
    },
    /// The text has this many code units, and the index is not less.
    Past(u32),
}

/// `text.charCodeAt(index)` as [`wtf8_decoded_units`] reads `text`. ASCII up to the index is not decoded.
#[inline]
pub fn wtf8_code_unit_at(text: &[u8], index: u32) -> Wtf8CodeUnitAt<'_> {
    let at = index as usize;
    match text.get(..=at) {
        Some(up_to) if first_non_ascii(up_to).is_none() => Wtf8CodeUnitAt::Unit {
            unit: u16::from(text[at]),
            sequence: Some(&text[at..=at]),
        },
        _ => match first_non_ascii(text) {
            None => Wtf8CodeUnitAt::Past(text.len() as u32),
            Some(ascii) => code_unit_at_from(text, ascii as usize, ascii, index),
        },
    }
}

/// The most bytes that [`code_unit_at_from`] decodes one sequence at a time before it counts again.
const DECODED_BLOCK: usize = 16;

/// [`wtf8_code_unit_at`] from the sequence start `at`, which `seen <= index` code units are before.
fn code_unit_at_from(text: &[u8], mut at: usize, mut seen: u32, index: u32) -> Wtf8CodeUnitAt<'_> {
    while at < text.len() {
        // UTF-8 has no more code units than bytes: a block of as many bytes as units are left ends before the index.
        let span = ((index - seen) as usize).min(text.len() - at);
        if span > DECODED_BLOCK {
            let block = &text[at..sequence_start_before(text, at + span)];
            let counted = &block[..simdutf::validate::with_errors::utf8(block).count];
            if counted.len() > DECODED_BLOCK {
                debug_assert!(is_valid_utf8(counted));
                let units = element_length_utf8_into_utf16(counted) as u32;
                (at, seen) = (at + counted.len(), seen + units);
                continue;
            }
        }
        let end = at + span.clamp(1, DECODED_BLOCK);
        while at < end {
            // An ASCII byte is its own code unit in every reading.
            if text[at] < 0x80 {
                if seen == index {
                    let unit = u16::from(text[at]);
                    return Wtf8CodeUnitAt::Unit {
                        unit,
                        sequence: Some(&text[at..=at]),
                    };
                }
                (at, seen) = (at + 1, seen + 1);
                continue;
            }
            let mut decoded = wtf8_decoded_units(&text[at..]);
            let Some(first) = decoded.next() else {
                return Wtf8CodeUnitAt::Past(seen);
            };
            // U+FFFD in the text has three bytes of its own.
            let is_text = first != 0xFFFD || text[at..].starts_with("\u{FFFD}".as_bytes());
            let sequence = is_text.then(|| &text[at..at + decoded.at]);
            for unit in [Some(first), decoded.trail] {
                let Some(unit) = unit else { break };
                if seen == index {
                    return Wtf8CodeUnitAt::Unit { unit, sequence };
                }
                seen += 1;
            }
            at += decoded.at;
        }
    }
    Wtf8CodeUnitAt::Past(seen)
}

/// `end`, or the start of the sequence that the byte at `end` goes on.
fn sequence_start_before(text: &[u8], end: usize) -> usize {
    let is_continuation = |at: usize| text.get(at).is_some_and(|byte| (0x80..0xC0).contains(byte));
    (end.saturating_sub(3)..=end)
        .rev()
        .find(|&at| !is_continuation(at))
        .unwrap_or(end)
}

/// `text.length` of the text of a file, which is read as Go reads it: a byte that is part of no
/// sequence of UTF-8 is one U+FFFD, and so is each of the three of half a surrogate pair.
pub fn utf8_lossy_len_utf16(text: &[u8]) -> u32 {
    match first_non_ascii(text) {
        None => text.len() as u32,
        Some(_) if is_valid_utf8(text) => element_length_utf8_into_utf16(text) as u32,
        Some(_) => {
            let (mut at, mut units) = (0, 0);
            while at < text.len() {
                let (cp, size) = crate::lexer::char_and_size(text, at);
                units += if cp > 0xFFFF { 2 } else { 1 };
                at += size.max(1);
            }
            units
        }
    }
}

/// `text.length` of the text of a file as `TextDecoder` and Node read it: the start of a sequence of
/// UTF-8 that does not go on is one U+FFFD, however many bytes it has. As [`Utf16OffsetTable`] counts.
///
/// [`Utf16OffsetTable`]: super::Utf16OffsetTable
pub fn utf8_decoded_len_utf16(text: &[u8]) -> u32 {
    match first_non_ascii(text) {
        None => text.len() as u32,
        Some(_) if is_valid_utf8(text) => element_length_utf8_into_utf16(text) as u32,
        Some(_) => (text.utf8_chunks())
            .map(|chunk| {
                let valid = element_length_utf8_into_utf16(chunk.valid().as_bytes()) as u32;
                valid + u32::from(!chunk.invalid().is_empty())
            })
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

/// `text.slice(start, end)` for indices that are not negative. An index in the middle of a surrogate pair is taken as the start
/// of the pair, where `slice` has half of it: of `"a😀"`, `(0, 2)` is `"a"` and `(2, 3)` is `"😀"`.
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

/// The UTF-16 code units that JavaScript has for `text`, whatever bytes it is made of. What isn't a valid sequence has become U+FFFD when
/// the file was read, as `TextDecoder` and Node read it: the start of a sequence that does not go on is one, however many bytes it
/// has. [`wtf8_to_utf16`] has one for each byte.
pub(super) fn wtf8_decoded_units(text: &[u8]) -> Wtf8DecodedUnits<'_> {
    Wtf8DecodedUnits {
        text,
        at: 0,
        trail: None,
    }
}

pub(super) struct Wtf8DecodedUnits<'t> {
    text: &'t [u8],
    at: usize,
    /// The second half of the pair whose first half was the last unit.
    trail: Option<u16>,
}

impl Iterator for Wtf8DecodedUnits<'_> {
    type Item = u16;

    fn next(&mut self) -> Option<u16> {
        if let Some(trail) = self.trail.take() {
            return Some(trail);
        }
        let rest = self.text.get(self.at..).filter(|rest| !rest.is_empty())?;
        let step = wtf8_step(rest);
        let cp = step.code_point;
        self.at += step.len;
        if cp > 0xFFFF {
            self.trail = Some(0xDC00 | (cp & 0x3FF) as u16);
            return Some((0xD7C0 + (cp >> 10)) as u16);
        }
        Some(cp as u16)
    }
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
    fn wtf8_step_is_one_replacement_for_the_start_of_a_sequence_that_does_not_go_on() {
        let steps: &[(&[u8], u32, usize, bool)] = &[
            (b"a\xFF", 0x61, 1, false),
            (b"\xC3\xA9", 0xE9, 2, false),
            (b"\xEF\xBF\xBD", 0xFFFD, 3, false),
            (b"\xED\xA0\x80", 0xD800, 3, false),
            (b"\xF0\x9F\x98\x80", 0x1F600, 4, false),
            (b"\xE9 a", 0xFFFD, 1, true),
            (b"\xE2\x82a", 0xFFFD, 2, true),
            (b"\xF0\x9F\x98a", 0xFFFD, 3, true),
            (b"\xF0\x9F\x98", 0xFFFD, 3, true),
            (b"\xED\xA0a", 0xFFFD, 1, true),
            (b"\xC0\xAF", 0xFFFD, 1, true),
            (b"\xF4\x90\x80\x80", 0xFFFD, 1, true),
            (b"\x80", 0xFFFD, 1, true),
            (b"\xFF", 0xFFFD, 1, true),
        ];
        for &(text, code_point, len, replaced) in steps {
            let step = Wtf8Step {
                code_point,
                len,
                replaced,
            };
            assert_eq!(wtf8_step(text), step, "{text:x?}");
        }
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
        assert_eq!(utf8_lossy_len_utf16(text), 7);
        assert_eq!(utf8_lossy_len_utf16("a😀é".as_bytes()), 4);
        assert_eq!(utf8_decoded_len_utf16("a😀é".as_bytes()), 4);
        for (text, go, node) in [
            (&b"a\xF0\x9F\x98b"[..], 5, 3),
            (b"a\xF0\x9Fb", 4, 3),
            (b"a\xE2\x82b", 4, 3),
            (b"a\xED\xA0\x80b", 5, 5),
            (b"a\xFF\xFFb", 4, 4),
            (b"a\xC0\xAFb", 4, 4),
            (b"a\xF4\x90\x80\x80b", 6, 6),
        ] {
            assert_eq!(utf8_lossy_len_utf16(text), go);
            assert_eq!(utf8_decoded_len_utf16(text), node);
        }
    }

    #[test]
    fn a_code_unit_is_the_one_that_the_decoded_text_has() {
        use Wtf8CodeUnitAt::{Past, Unit};
        // "a😀\uD800é€", then a sequence that does not go on, "b", and a byte that starts none.
        let text = b"a\xF0\x9F\x98\x80\xED\xA0\x80\xC3\xA9\xE2\x82\xAC\xE2\x82b\xFF";
        let units: [(u16, Option<&[u8]>); 9] = [
            (0x61, Some(b"a")),
            (0xD83D, Some(b"\xF0\x9F\x98\x80")),
            (0xDE00, Some(b"\xF0\x9F\x98\x80")),
            (0xD800, Some(b"\xED\xA0\x80")),
            (0xE9, Some(b"\xC3\xA9")),
            (0x20AC, Some(b"\xE2\x82\xAC")),
            (0xFFFD, None),
            (0x62, Some(b"b")),
            (0xFFFD, None),
        ];
        for (index, (unit, sequence)) in units.into_iter().enumerate() {
            let found = wtf8_code_unit_at(text, index as u32);
            assert_eq!(found, Unit { unit, sequence }, "{index}");
        }
        assert_eq!(wtf8_code_unit_at(text, 9), Past(9));
        assert_eq!(wtf8_code_unit_at(text, u32::MAX), Past(9));
        assert_eq!(wtf8_decoded_len_utf16(text), 9);
        assert_eq!(wtf8_code_unit_at(b"abc", 3), Past(3));
        assert_eq!(wtf8_code_unit_at(b"", 0), Past(0));
        assert_eq!(wtf8_decoded_len_utf16(b""), 0);
        // The two halves of a pair, each in three bytes, are two units as the pair is.
        assert_eq!(wtf8_decoded_len_utf16(b"\xED\xA0\xBD\xED\xB8\x80"), 2);
    }

    #[test]
    fn a_code_unit_far_into_text_is_the_one_that_a_decode_finds() {
        use Wtf8CodeUnitAt::{Past, Unit};
        // The last two are no sequence: one that does not go on, and a byte that starts none.
        let pieces: [&[u8]; 8] = [
            b"a",
            b"\xC3\xA9",
            b"\xE2\x82\xAC",
            b"\xF0\x9F\x98\x80",
            b"\xED\xA0\xBD",
            b"\xED\xB8\x80",
            b"\xE2\x82",
            b"\xFF",
        ];
        let mut state = 0x9E37_79B9_u32;
        let mut random = move |bound: usize| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 8) as usize % bound
        };
        for round in 0..240 {
            let count = [5, 70, 300, 5000, 9000][round % 5];
            // ASCII and two bytes, then every length, then halves of pairs, then every piece.
            let kinds = [2, 4, 6, 8][round % 4];
            let mut text = Vec::new();
            for _ in 0..count {
                text.extend_from_slice(pieces[random(kinds)]);
            }
            let expected: Vec<u16> = wtf8_decoded_units(&text).collect();
            let len = expected.len() as u32;
            for index in (0..expected.len()).step_by(1 + expected.len() / 64) {
                let Unit { unit, sequence } = wtf8_code_unit_at(&text, index as u32) else {
                    panic!("round {round} index {index}");
                };
                assert_eq!(unit, expected[index], "round {round} index {index}");
                // The bytes are those of the code point that has the unit.
                match sequence {
                    Some(bytes) => assert!(wtf8_decoded_units(bytes).any(|it| it == unit)),
                    None => assert_eq!(unit, 0xFFFD, "round {round} index {index}"),
                }
            }
            for index in [len, len + 1, len.saturating_mul(3), u32::MAX] {
                assert_eq!(wtf8_code_unit_at(&text, index), Past(len), "round {round}");
            }
            assert_eq!(wtf8_decoded_len_utf16(&text), len, "round {round}");
        }
    }

    #[test]
    fn a_code_unit_after_runs_of_utf8_is_the_one_that_a_decode_finds() {
        // Long runs of UTF-8 are counted. Bytes that are not UTF-8 are between them.
        let run = "The caf\u{E9} has \u{20AC}5 cr\u{E8}me br\u{FB}l\u{E9}e \u{1F600}. ".as_bytes();
        let not_utf8: [&[u8]; 3] = [b"\xFF", b"\xE2\x82", b"\xED\xA0\xBD"];
        for every in [1, 2, 7, 40] {
            let mut text = Vec::new();
            for chunk in 0..120 {
                text.extend_from_slice(run);
                if chunk % every == 0 {
                    text.extend_from_slice(not_utf8[chunk % 3]);
                }
            }
            let expected: Vec<u16> = wtf8_decoded_units(&text).collect();
            for index in (0..expected.len()).step_by(37) {
                let Wtf8CodeUnitAt::Unit { unit, .. } = wtf8_code_unit_at(&text, index as u32)
                else {
                    panic!("every {every} index {index}");
                };
                assert_eq!(unit, expected[index], "every {every} index {index}");
            }
            let len = expected.len() as u32;
            assert_eq!(wtf8_code_unit_at(&text, len), Wtf8CodeUnitAt::Past(len));
            assert_eq!(wtf8_decoded_len_utf16(&text), len, "every {every}");
        }
    }

    #[test]
    fn decoded_units_are_those_of_a_lossy_decode_of_utf8() {
        // Every text of up to four of these bytes. Half of a surrogate pair is not UTF-8: a text that starts one is left out.
        let bytes = [
            0x41, 0x7F, 0x80, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0, 0xC2, 0xDF, 0xE0, 0xE1, 0xEC,
            0xED, 0xEE, 0xEF, 0xF0, 0xF1, 0xF4, 0xF5, 0xFF,
        ];
        let mut texts: Vec<Vec<u8>> = vec![Vec::new()];
        for from in [0, 1, 23, 507] {
            let longer: Vec<Vec<u8>> = texts[from..]
                .iter()
                .flat_map(|text| bytes.map(|byte| [&text[..], &[byte]].concat()))
                .collect();
            texts.extend(longer);
        }
        assert_eq!(texts.len(), 1 + 22 + 484 + 10_648 + 234_256);
        for text in &texts {
            if text
                .windows(2)
                .any(|pair| pair[0] == 0xED && pair[1] >= 0xA0)
            {
                continue;
            }
            let lossy: Vec<u16> = String::from_utf8_lossy(text).encode_utf16().collect();
            let decoded: Vec<u16> = wtf8_decoded_units(text).collect();
            assert_eq!(decoded, lossy, "{text:x?}");
        }
    }

    #[test]
    fn decoded_units_are_those_of_a_file_that_javascript_has_read() {
        let texts: &[(&[u8], &[u16])] = &[
            (b"", &[]),
            (b"ab", &[0x61, 0x62]),
            (
                "a😀é\u{FFFD}".as_bytes(),
                &[0x61, 0xD83D, 0xDE00, 0xE9, 0xFFFD],
            ),
            (b"\xF4\x8F\xBF\xBF", &[0xDBFF, 0xDFFF]),
            (b"a\xED\xA0\x80b", &[0x61, 0xD800, 0x62]),
            (b"\xED\xA0\xBD\xED\xB8\x80", &[0xD83D, 0xDE00]),
            (b"a\xF0\x9F\x98b", &[0x61, 0xFFFD, 0x62]),
            (b"a\xF0\x9F\x98", &[0x61, 0xFFFD]),
            (b"a\xF0\x9Fb", &[0x61, 0xFFFD, 0x62]),
            (b"a\xE2\x82b", &[0x61, 0xFFFD, 0x62]),
            (b"\xF0\x9F\xF0\x9F\x98\x80", &[0xFFFD, 0xD83D, 0xDE00]),
            (b"\xED\xA0b", &[0xFFFD, 0xFFFD, 0x62]),
            (b"a\xFF\xFFb", &[0x61, 0xFFFD, 0xFFFD, 0x62]),
            (b"a\xC0\xAFb", &[0x61, 0xFFFD, 0xFFFD, 0x62]),
            (b"\x80\x80", &[0xFFFD, 0xFFFD]),
            (b"\xF4\x90\x80\x80", &[0xFFFD, 0xFFFD, 0xFFFD, 0xFFFD]),
        ];
        for (text, units) in texts {
            let decoded: Vec<u16> = wtf8_decoded_units(text).collect();
            assert_eq!(decoded, *units, "{text:x?}");
        }
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
