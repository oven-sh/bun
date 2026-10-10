//! Offsets in a text as two sides count them: in bytes of UTF-8 here, in UTF-16 code units in
//! JavaScript.

use super::first_non_ascii;

/// Converts between the two, for offsets where a character starts. Costs nothing for ASCII.
pub struct Utf16OffsetTable {
    /// For each character that takes a different number of units in the two encodings: the offset
    /// after it in bytes, and by how much the offsets differ from there on.
    shifts: Vec<(u32, u32)>,
}

impl Utf16OffsetTable {
    /// A byte order mark is a character as any other.
    pub fn new(text: &[u8]) -> Utf16OffsetTable {
        Self::from(text, 0)
    }

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
        let mut shifts = Vec::new();
        let Some(first) = first_non_ascii(text) else {
            return Utf16OffsetTable { shifts };
        };
        let (mut at, mut shift) = (first as usize, 0u32);
        if bom > 0 {
            (at, shift) = (bom as usize, bom);
            shifts.push((bom, bom));
        }
        while let Some(&byte) = text.get(at) {
            let (bytes, units) = match byte {
                0xF0.. => (4, 2),
                0xE0.. => (3, 1),
                0xC0.. => (2, 1),
                // ASCII, or a stray continuation byte.
                _ => (1, 1),
            };
            at += bytes;
            if bytes != units {
                shift += (bytes - units) as u32;
                shifts.push((at as u32, shift));
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

#[cfg(test)]
mod tests {
    use super::*;

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
                    false => Utf16OffsetTable::new(text.as_bytes()),
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
}
