//! Where the parsers take things to be.
//!
//! `@handlebars/parser` counts lines and columns. After a token with a line break in it, the column is the length of
//! what follows the last line break, which it finds with `/(?:\r\n?|\n).*/g`: up to the first U+2028 or U+2029. So
//! behind one of these all columns are too small, until the next token with a line break. `@glimmer/syntax` makes
//! offsets of them, and Prettier takes text from there.

use crate::text::utf16_len;
use bun_core::strings;

#[derive(Default)]
pub(crate) struct Positions {
    /// From which offset on the columns are too small by how many UTF-16 code units. In the order of the offsets.
    /// Empty: never.
    deficits: Vec<(u32, u32)>,
    /// For each byte of the text and its end, how many UTF-16 code units are before it. Empty if `deficits` is.
    units: Vec<u32>,
    /// For each UTF-16 code unit of the text and its end, where the character starts that it is of.
    offsets: Vec<u32>,
}

/// Where the first U+2028 or U+2029 is in `text`.
fn index_of_separator(text: &[u8]) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = strings::index_of(&text[from..], b"\xE2\x80") {
        from += found;
        if matches!(text.get(from + 2), Some(0xA8 | 0xA9)) {
            return Some(from);
        }
        from += 2;
    }
    None
}

impl Positions {
    pub(crate) fn clear(&mut self) {
        self.deficits.clear();
        self.units.clear();
        self.offsets.clear();
    }

    /// Whether there is anything in `text` that makes a column too small.
    pub(crate) fn can_be_wrong(text: &[u8]) -> bool {
        index_of_separator(text).is_some()
    }

    /// The lexer has matched `text[start..end]`.
    pub(crate) fn add_match(&mut self, text: &[u8], start: usize, end: usize) {
        let Some(line_break) = strings::last_index_of_char(&text[start..end], b'\n') else {
            return;
        };
        let last_line = &text[start + line_break + 1..end];
        let deficit = index_of_separator(last_line).map_or(0, |at| utf16_len(&last_line[at..]));
        if deficit != self.deficits.last().map_or(0, |last| last.1) {
            self.deficits.push((end as u32, deficit));
        }
    }

    /// After the last match.
    pub(crate) fn finish(&mut self, text: &[u8]) {
        if self.deficits.is_empty() {
            return;
        }
        for (offset, &byte) in text.iter().enumerate() {
            self.units.push(self.offsets.len() as u32);
            if byte & 0xC0 != 0x80 {
                self.offsets.push(offset as u32);
            }
            if byte >= 0xF0 {
                self.offsets.push(offset as u32);
            }
        }
        self.units.push(self.offsets.len() as u32);
        self.offsets.push(text.len() as u32);
    }

    /// By how many UTF-16 code units the column of the token that starts or ends at `offset` is too small.
    pub(crate) fn deficit_at(&self, offset: usize) -> u32 {
        let after = self
            .deficits
            .partition_point(|change| change.0 as usize <= offset);
        after
            .checked_sub(1)
            .map_or(0, |index| self.deficits[index].1)
    }

    /// `offset` in `text`, moved by so many UTF-16 code units: where the character starts that is there. Where no
    /// column is too small, it is moved by a few.
    pub(crate) fn moved(&self, text: &[u8], offset: usize, by: i64) -> Option<usize> {
        let Some(&unit) = self.units.get(offset) else {
            let (mut at, mut left) = (offset, by.unsigned_abs());
            while left > 0 && by < 0 {
                at = at.checked_sub(1)?;
                while at > 0 && text.get(at).is_some_and(|byte| byte & 0xC0 == 0x80) {
                    at -= 1;
                }
                left = left.saturating_sub(if text.get(at).is_some_and(|byte| *byte >= 0xF0) {
                    2
                } else {
                    1
                });
            }
            while left > 0 {
                let (len, units) = match *text.get(at)? {
                    0xF0.. => (4, 2),
                    0xE0.. => (3, 1),
                    0xC0.. => (2, 1),
                    _ => (1, 1),
                };
                if units > left {
                    break;
                }
                (at, left) = (at + len, left - units);
            }
            return Some(at);
        };
        let unit = usize::try_from(i64::from(unit) + by).ok()?;
        self.offsets.get(unit).map(|offset| *offset as usize)
    }

    /// Where the parser takes the token to start or end that does so at `offset`.
    pub(crate) fn of_token(&self, text: &[u8], offset: usize) -> usize {
        match self.deficit_at(offset) {
            0 => offset,
            deficit => self
                .moved(text, offset, -i64::from(deficit))
                .unwrap_or(offset),
        }
    }
}
