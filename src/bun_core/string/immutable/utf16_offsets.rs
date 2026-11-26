//! Offsets in a text as two sides count them: in bytes of UTF-8 here, in UTF-16 code units in
//! JavaScript.

use super::first_non_ascii;
use std::simd::prelude::*;

/// Converts between the two, for offsets where a character starts. Costs nothing for ASCII.
pub struct Utf16OffsetTable {
    /// For each character that takes a different number of units in the two encodings: the offset
    /// after it in bytes, and by how much the offsets differ from there on.
    shifts: Vec<(u32, u32)>,
}

impl Utf16OffsetTable {
    /// For a side that does not have the byte order mark that `text` may start with: what is in it
    /// is at 0 there.
    pub fn without_bom(text: &[u8]) -> Utf16OffsetTable {
        Self::from(
            text,
            if text.starts_with(b"\xEF\xBB\xBF") {
                3
            } else {
                0
            },
        )
    }

    fn from(text: &[u8], bom: u32) -> Utf16OffsetTable {
        Self::from_valid(text, bom).unwrap_or_else(|| Self::from_lossy(text, bom))
    }

    /// `None` if what follows the first non-ASCII byte (or the byte order mark) is not UTF-8.
    /// Validates in the same pass as it finds the characters that matter.
    fn from_valid(text: &[u8], bom: u32) -> Option<Utf16OffsetTable> {
        let mut shifts = Vec::new();
        let Some(first) = first_non_ascii(text) else {
            return Some(Utf16OffsetTable { shifts });
        };
        let (mut start, mut shift) = (first as usize, 0u32);
        if bom > 0 {
            (start, shift) = (bom as usize, bom);
            shifts.push((bom, bom));
        }
        let rest = &text[start..];
        let mut carry = 0;
        for base in (0..rest.len()).step_by(BLOCK) {
            scan_block(rest, base, &mut carry, |after, saves| {
                shift += saves;
                shifts.push(((start + after) as u32, shift));
            })?;
        }
        // A character that goes on past the end.
        if carry != 0 {
            return None;
        }
        Some(Utf16OffsetTable { shifts })
    }

    fn from_lossy(text: &[u8], bom: u32) -> Utf16OffsetTable {
        let mut shifts = Vec::new();
        let Some(first) = first_non_ascii(text) else {
            return Utf16OffsetTable { shifts };
        };
        let (mut at, mut shift) = (first as usize, 0u32);
        if bom > 0 {
            (at, shift) = (bom as usize, bom);
            shifts.push((bom, bom));
        }
        let rest = &text[at..];
        let mut passes = |bytes: usize, units: usize| {
            at += bytes;
            if bytes != units {
                shift += (bytes - units) as u32;
                shifts.push((at as u32, shift));
            }
        };
        for chunk in rest.utf8_chunks() {
            let mut valid = chunk.valid().as_bytes();
            while let Some(&byte) = valid.first() {
                let (bytes, units) = match byte {
                    0xF0.. => (4, 2),
                    0xE0.. => (3, 1),
                    0xC0.. => (2, 1),
                    _ => (1, 1),
                };
                passes(bytes, units);
                valid = &valid[bytes..];
            }
            // As `TextDecoder` reads it: one U+FFFD for the start of a sequence that does not go on.
            if !chunk.invalid().is_empty() {
                passes(chunk.invalid().len(), 1);
            }
        }
        Utf16OffsetTable { shifts }
    }

    #[inline]
    pub fn to_utf16(&self, offset: u32) -> u32 {
        if self.shifts.is_empty() {
            return offset;
        }
        match self.shifts.partition_point(|it| it.0 <= offset) {
            // Before the first of them, or in it.
            0 => offset.min(self.shifts[0].0 - self.shifts[0].1),
            after => offset - self.shifts[after - 1].1,
        }
    }

    pub fn to_bytes(&self, units: u32) -> u32 {
        match self.shifts.partition_point(|it| it.0 - it.1 <= units) {
            0 => units,
            after => units.saturating_add(self.shifts[after - 1].1),
        }
    }
}

const BLOCK: usize = 32;

/// The 32 bytes of `rest` at `at`, as many as there are and zeros after.
#[inline(always)]
fn load(rest: &[u8], at: usize) -> u8x32 {
    match rest.get(at..at + BLOCK) {
        Some(block) => u8x32::from_slice(block),
        None => u8x32::load_or_default(rest.get(at..).unwrap_or(&[])),
    }
}

/// Handles the characters that start in the `BLOCK` of `rest` at `base`: calls
/// `found(offset after the character, how many fewer units than bytes it has)` for each of the ones
/// that are longer than a byte. `None` if what is there is not UTF-8.
/// `carry` has the bytes that the characters of the blocks before ask for after the end of them.
#[inline(always)]
fn scan_block(
    rest: &[u8],
    base: usize,
    carry: &mut u64,
    mut found: impl FnMut(usize, u32),
) -> Option<()> {
    let bytes = load(rest, base);
    let at_least = |byte: u8| bytes.simd_ge(u8x32::splat(byte)).to_bitmask();
    let non_ascii = at_least(0x80);
    if non_ascii == 0 && *carry == 0 {
        return Some(());
    }
    let starts = at_least(0xC0);
    let starts_3_or_4 = at_least(0xE0);
    // C0 and C1 would be overlong, and F5 and above go past U+10FFFF.
    let never_valid = (bytes & u8x32::splat(0xFE)).simd_eq(u8x32::splat(0xC0))
        | bytes.simd_ge(u8x32::splat(0xF5));
    if never_valid.any() {
        return None;
    }
    let starts_4 = if starts_3_or_4 != 0 {
        at_least(0xF0)
    } else {
        0
    };
    // The continuation bytes have to be the ones that the starts ask for, and no other.
    let asked_for = *carry | starts << 1 | starts_3_or_4 << 2 | starts_4 << 3;
    if asked_for as u32 as u64 != non_ascii & !starts {
        return None;
    }
    *carry = asked_for >> BLOCK;
    if starts_3_or_4 != 0 {
        // These leave less of the range for the byte after them.
        let next = load(rest, base + 1);
        let (a0, x90) = (u8x32::splat(0xA0), u8x32::splat(0x90));
        let narrowed = (bytes.simd_eq(u8x32::splat(0xE0)) & next.simd_lt(a0))
            | (bytes.simd_eq(u8x32::splat(0xED)) & next.simd_ge(a0))
            | (bytes.simd_eq(u8x32::splat(0xF0)) & next.simd_lt(x90))
            | (bytes.simd_eq(u8x32::splat(0xF4)) & next.simd_ge(x90));
        if narrowed.any() {
            return None;
        }
    }
    let mut starts = starts;
    while starts != 0 {
        let i = starts.trailing_zeros() as usize;
        starts &= starts - 1;
        let (len, saves) = match bytes[i] {
            0xF0.. => (4, 2),
            0xE0.. => (3, 2),
            _ => (2, 1),
        };
        found(base + i + len, saves);
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_no_utf8_is_as_long_as_what_it_is_replaced_with() {
        let parts: [&[u8]; 11] = [
            b"\xE9",
            b"\xF0\x9F",
            b"\xF0\x9F\x98",
            b"\xC3",
            b"\xED\xA0\x80",
            b"\x80",
            b"\xE2\x82",
            b"\xF5",
            b"\xC0\xAF",
            "😀".as_bytes(),
            "é".as_bytes(),
        ];
        let mut text = Vec::new();
        for part in parts {
            text.extend_from_slice(part);
            text.push(b'.');
            let units = String::from_utf8_lossy(&text).encode_utf16().count() as u32;
            let offsets = Utf16OffsetTable::from(&text, 0);
            assert_eq!(offsets.to_utf16(text.len() as u32), units, "{text:?}");
            assert_eq!(offsets.to_bytes(units), text.len() as u32, "{text:?}");
        }
    }

    #[test]
    fn both_ways_at_every_start_of_a_character() {
        for (text, has_bom) in [
            ("a😀é日b", false),
            ("\u{FEFF}a😀é", true),
            ("ab", false),
            ("", false),
        ] {
            for without_bom in [false, true] {
                let offsets = match without_bom {
                    true => Utf16OffsetTable::without_bom(text.as_bytes()),
                    false => Utf16OffsetTable::from(text.as_bytes(), 0),
                };
                let skipped = u32::from(has_bom && without_bom);
                let mut units = 0;
                for (at, c) in text.char_indices().chain([(text.len(), 'x')]) {
                    let expected = u32::saturating_sub(units, skipped);
                    assert_eq!(offsets.to_utf16(at as u32), expected, "{text:?} {at}");
                    if at > 0 || skipped == 0 {
                        assert_eq!(offsets.to_bytes(expected), at as u32, "{text:?} {at}");
                    }
                    units += c.len_utf16() as u32;
                }
            }
        }
    }

    #[test]
    fn same_as_reading_it_lossily_for_what_is_and_is_not_utf8() {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let bytes: [u8; 16] = [
            b'a', 0x80, 0xBF, 0xC0, 0xC2, 0xDF, 0xE0, 0xED, 0xEF, 0xF0, 0xF4, 0xF5, 0xFF, 0xA0,
            0x9F, 0x90,
        ];
        let chars = [
            'a',
            'é',
            '日',
            '\u{D7FF}',
            '\u{E000}',
            '😀',
            '\u{10FFFF}',
            '\u{800}',
            '\u{80}',
        ];
        for round in 0..20_000 {
            let len = (next() % 100) as usize;
            let mut text: Vec<u8> = if round % 2 == 0 {
                (0..len).map(|_| bytes[(next() % 16) as usize]).collect()
            } else {
                let mut text = String::new();
                while text.len() < len {
                    text.push(chars[(next() % 9) as usize]);
                    if next() % 3 == 0 {
                        text.push('x');
                    }
                }
                text.into_bytes()
            };
            if round % 4 == 3 && !text.is_empty() {
                let at = next() as usize % text.len();
                text[at] = bytes[(next() % 16) as usize];
            }
            let valid = first_non_ascii(&text)
                .map_or(true, |at| std::str::from_utf8(&text[at as usize..]).is_ok());
            let fast = Utf16OffsetTable::from_valid(&text, 0);
            assert_eq!(fast.is_some(), valid, "{text:02x?}");
            if let Some(fast) = fast {
                assert_eq!(
                    fast.shifts,
                    Utf16OffsetTable::from_lossy(&text, 0).shifts,
                    "{text:02x?}"
                );
            }
            assert_eq!(
                Utf16OffsetTable::from(&text, 0).shifts,
                Utf16OffsetTable::from_lossy(&text, 0).shifts,
                "{text:02x?}"
            );
        }
    }
}
