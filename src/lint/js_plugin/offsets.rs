//! Offsets in the text of a file as the two sides count them: in bytes of UTF-8 here, in UTF-16
//! code units without the byte order mark in JavaScript.

/// Converts between the two. Costs nothing for ASCII.
pub(super) struct Offsets {
    /// For each character that takes a different number of units in the two encodings: the offset
    /// after it in bytes, and by how much the offsets differ from there on.
    shifts: Vec<(u32, u32)>,
}

impl Offsets {
    pub(super) fn new(text: &[u8]) -> Offsets {
        let mut shifts = Vec::new();
        let Some(first) = bun_core::strings::first_non_ascii(text) else {
            return Offsets { shifts };
        };
        let (mut at, mut shift) = (first as usize, 0u32);
        if text.starts_with(b"\xEF\xBB\xBF") {
            (at, shift) = (3, 3);
            shifts.push((3, 3));
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
        Offsets { shifts }
    }

    #[inline]
    pub(super) fn to_utf16(&self, offset: u32) -> u32 {
        if self.shifts.is_empty() {
            return offset;
        }
        match self.shifts.partition_point(|it| it.0 <= offset) {
            // In the byte order mark.
            0 => offset.min(self.shifts[0].0 - self.shifts[0].1),
            after => offset - self.shifts[after - 1].1,
        }
    }

    pub(super) fn to_bytes(&self, units: u32) -> u32 {
        match self.shifts.partition_point(|it| it.0 - it.1 <= units) {
            0 => units,
            after => units.saturating_add(self.shifts[after - 1].1),
        }
    }
}
