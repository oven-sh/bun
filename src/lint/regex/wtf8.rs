//! Reading text that is UTF-8 (or WTF-8: lone surrogates as three bytes) the way JavaScript reads
//! its UTF-16 strings.
//!
//! A position is a byte offset. Without the `u` and `v` flags JavaScript sees a character outside
//! the BMP as two code units. Such a character is four bytes here: the first two stand for the
//! lead surrogate and the last two for the trail surrogate, so the position between the two code
//! units is the offset of the character plus 2. That makes byte offsets and UTF-16 indices
//! correspond one to one.
//!
//! A byte that is not part of a well-formed sequence reads as U+FFFD, one byte long.

const REPLACEMENT: u32 = 0xFFFD;

#[inline]
fn continuation(s: &[u8], i: usize) -> Option<u32> {
    let b = *s.get(i)?;
    (b & 0xC0 == 0x80).then_some(u32::from(b & 0x3F))
}

/// The code point that starts at `i` and its length in bytes. `i` must be less than `s.len()`.
#[inline]
pub(crate) fn code_point_at(s: &[u8], i: usize) -> (u32, usize) {
    let b = s.get(i).copied().unwrap_or(0);
    if b < 0x80 {
        return (u32::from(b), 1);
    }
    multibyte_at(s, i, b)
}

fn multibyte_at(s: &[u8], i: usize, b: u8) -> (u32, usize) {
    match b {
        0xC2..=0xDF => {
            if let Some(c1) = continuation(s, i + 1) {
                return ((u32::from(b & 0x1F) << 6) | c1, 2);
            }
        }
        0xE0..=0xEF => {
            if let (Some(c1), Some(c2)) = (continuation(s, i + 1), continuation(s, i + 2)) {
                let cp = (u32::from(b & 0x0F) << 12) | (c1 << 6) | c2;
                if cp >= 0x800 {
                    return (cp, 3);
                }
            }
        }
        0xF0..=0xF4 => {
            if let (Some(c1), Some(c2), Some(c3)) = (
                continuation(s, i + 1),
                continuation(s, i + 2),
                continuation(s, i + 3),
            ) {
                let cp = (u32::from(b & 0x07) << 18) | (c1 << 12) | (c2 << 6) | c3;
                if (0x10000..=0x10FFFF).contains(&cp) {
                    return (cp, 4);
                }
            }
        }
        _ => {}
    }
    (REPLACEMENT, 1)
}

/// Where the code point starts that `i` is in the middle of. `i` itself if it is not.
pub(crate) fn code_point_start(s: &[u8], i: usize) -> usize {
    (1..=3)
        .filter_map(|back| i.checked_sub(back))
        .find(|start| code_point_at(s, *start).1 > i - start)
        .unwrap_or(i)
}

#[inline]
pub(crate) fn lead_surrogate(cp: u32) -> u32 {
    0xD800 + ((cp - 0x10000) >> 10)
}

#[inline]
pub(crate) fn trail_surrogate(cp: u32) -> u32 {
    0xDC00 + ((cp - 0x10000) & 0x3FF)
}

/// Whether `i` is between the two halves of a four-byte character, and if so that character.
#[inline]
fn astral_around(s: &[u8], i: usize) -> Option<u32> {
    let start = i.checked_sub(2)?;
    let lead = *s.get(start)?;
    if lead < 0xF0 {
        return None;
    }
    match multibyte_at(s, start, lead) {
        (cp, 4) => Some(cp),
        _ => None,
    }
}

/// The UTF-16 code unit that starts at `i` and its length in bytes.
#[inline]
pub(crate) fn unit_at(s: &[u8], i: usize) -> (u32, usize) {
    let b = s.get(i).copied().unwrap_or(0);
    if b < 0x80 {
        return (u32::from(b), 1);
    }
    if b & 0xC0 == 0x80 {
        return match astral_around(s, i) {
            Some(cp) => (trail_surrogate(cp), 2),
            None => (REPLACEMENT, 1),
        };
    }
    match multibyte_at(s, i, b) {
        (cp, 4) => (lead_surrogate(cp), 2),
        other => other,
    }
}

/// Appends `cp`, which may be a surrogate.
pub(crate) fn push_code_point(out: &mut Vec<u8>, cp: u32) {
    match cp {
        0..=0x7F => out.push(cp as u8),
        0x80..=0x7FF => out.extend_from_slice(&[0xC0 | (cp >> 6) as u8, 0x80 | (cp & 0x3F) as u8]),
        0x800..=0xFFFF => out.extend_from_slice(&[
            0xE0 | (cp >> 12) as u8,
            0x80 | ((cp >> 6) & 0x3F) as u8,
            0x80 | (cp & 0x3F) as u8,
        ]),
        _ => out.extend_from_slice(&[
            0xF0 | ((cp >> 18) & 0x07) as u8,
            0x80 | ((cp >> 12) & 0x3F) as u8,
            0x80 | ((cp >> 6) & 0x3F) as u8,
            0x80 | (cp & 0x3F) as u8,
        ]),
    }
}

/// Appends `bytes` to a string. What is not a Unicode scalar value becomes U+FFFD.
pub(crate) fn push_lossy(out: &mut String, bytes: &[u8]) {
    let mut i = 0;
    while i < bytes.len() {
        let (cp, len) = code_point_at(bytes, i);
        out.push(char::from_u32(cp).unwrap_or(char::REPLACEMENT_CHARACTER));
        i += len;
    }
}

/// The index in the UTF-16 form of `s` that the byte offset `offset` corresponds to.
pub fn utf16_index(s: &[u8], offset: usize) -> usize {
    let offset = offset.min(s.len());
    let head = s.get(..offset).unwrap_or_default();
    let Some(first) = bun_core::strings::first_non_ascii(head) else {
        return offset;
    };
    let mut i = first as usize;
    let mut units = i;
    while i < offset {
        let (_, len) = unit_at(s, i);
        units += 1;
        i += len;
    }
    units
}

/// For [`utf16_index`] of many offsets in one text.
#[derive(Debug)]
pub(crate) struct Utf16Index {
    /// Up to here a byte is a code unit.
    ascii: usize,
    /// After that, for every `Utf16Index::STEP` bytes: the first offset from there on where a code unit starts, and its index.
    marks: Vec<(u32, u32)>,
}

impl Utf16Index {
    const STEP: usize = 128;

    pub(crate) fn new(s: &[u8]) -> Self {
        let ascii = bun_core::strings::first_non_ascii(s).map_or(s.len(), |i| i as usize);
        let mut marks = Vec::with_capacity((s.len() - ascii) / Self::STEP + 1);
        let (mut i, mut units) = (ascii, ascii);
        while i < s.len() {
            if i >= ascii + marks.len() * Self::STEP {
                marks.push((i as u32, units as u32));
            }
            units += 1;
            i += unit_at(s, i).1;
        }
        Utf16Index { ascii, marks }
    }

    /// `utf16_index(s, offset)` for the `s` that it was made of.
    pub(crate) fn of(&self, s: &[u8], offset: usize) -> usize {
        let offset = offset.min(s.len());
        if offset <= self.ascii {
            return offset;
        }
        let after = ((offset - self.ascii) / Self::STEP + 1).min(self.marks.len());
        let mark = self
            .marks
            .get(..after)
            .unwrap_or_default()
            .iter()
            .rev()
            .find(|it| it.0 as usize <= offset);
        let (mut i, mut units) = mark.map_or((self.ascii, self.ascii), |it| {
            (it.0 as usize, it.1 as usize)
        });
        while i < offset {
            units += 1;
            i += unit_at(s, i).1;
        }
        units
    }
}

/// The byte offset in `s` that the index `index` in its UTF-16 form corresponds to.
pub fn byte_offset(s: &[u8], index: usize) -> usize {
    let ascii = bun_core::strings::first_non_ascii(s).map_or(s.len(), |i| i as usize);
    if index <= ascii {
        return index;
    }
    let mut i = ascii;
    let mut units = ascii;
    while i < s.len() && units < index {
        let (_, len) = unit_at(s, i);
        units += 1;
        i += len;
    }
    i
}
