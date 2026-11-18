//! Where the lines of a source start.

use core::ops::Range;

use bun_engine_text::{AllocError, Text};

use crate::source::narrow;

const LINES_PER_CHAPTER: u32 = 64;
const UNITS_AT_ONCE: usize = 1 << 16;
const MAX_LENGTH_BYTES: usize = 5;

/// Lines and columns count from zero. Damaged bytes give wrong answers, and nothing worse.
#[derive(Clone, Copy, Default)]
pub struct LineTable<'a> {
    /// Of each line but the last, in seven bits a byte.
    lengths: &'a [u8],
    /// For each but the first, where it starts in the text and in `lengths`.
    chapters: &'a [[[u8; 4]; 2]],
}

fn line_starts(text: Text<'_>, bytes: &[u8]) -> Vec<u32> {
    if bun_highway::index_of_char(bytes, b'\r').is_none() {
        return bun_highway::line_starts(bytes);
    }
    let mut starts = vec![0];
    let mut offset = 0;
    while let Some(length) = bun_highway::index_of_any_char(&bytes[offset..], b"\n\r") {
        offset += length + 1;
        if bytes[offset - 1] == b'\r' && text.get(offset) == Some(0x0a) {
            offset += 1;
        }
        starts.push(offset as u32);
    }
    starts
}

impl<'a> LineTable<'a> {
    /// What is shorter is read again if a line is asked for.
    pub const SHORTEST_TEXT_TO_PREPARE: usize = 1024;

    /// The lengths, the chapters and their number.
    pub fn encode(text: Text<'_>) -> Result<Vec<u8>, AllocError> {
        let (mut lengths, mut chapters, mut narrowed) = (Vec::new(), Vec::new(), Vec::new());
        let (mut from, mut last, mut line) = (0, 0, 0);
        while from < text.len() {
            let mut to = text.len().min(from + UNITS_AT_ONCE);
            to += usize::from(text.at(to - 1) == 0x0d && text.get(to) == Some(0x0a));
            let part = text.slice(from..to);
            let starts = match part {
                Text::Latin1(bytes) => line_starts(part, bytes),
                Text::Utf16(units) => {
                    narrow(units, 0..units.len(), &mut narrowed);
                    line_starts(part, &narrowed[..units.len()])
                }
            };
            let most_chapters = starts.len() / LINES_PER_CHAPTER as usize + 1;
            (lengths.try_reserve(MAX_LENGTH_BYTES * starts.len()))
                .and_then(|()| chapters.try_reserve(most_chapters))
                .map_err(|_| AllocError)?;
            for start in starts[1..].iter().map(|start| from as u32 + start) {
                let mut length = start - core::mem::replace(&mut last, start);
                while length >= 0x80 {
                    lengths.push(length as u8 | 0x80);
                    length >>= 7;
                }
                lengths.push(length as u8);
                line += 1;
                if line % LINES_PER_CHAPTER == 0 {
                    chapters.push([start, lengths.len() as u32].map(u32::to_le_bytes));
                }
            }
            from = to;
        }
        let count = (chapters.len() as u32).to_le_bytes();
        let parts = [&lengths, chapters.as_flattened().as_flattened(), &count];
        let mut bytes = Vec::new();
        (bytes.try_reserve_exact(parts.iter().map(|it| it.len()).sum())).map_err(|_| AllocError)?;
        parts.iter().for_each(|it| bytes.extend_from_slice(it));
        Ok(bytes)
    }

    pub fn read(bytes: &'a [u8]) -> Option<LineTable<'a>> {
        let (rest, count) = bytes.split_last_chunk()?;
        let size = (u32::from_le_bytes(*count) as usize).checked_mul(2 * size_of::<u32>())?;
        let (lengths, chapters) = rest.split_at(rest.len().checked_sub(size)?);
        let chapters = chapters.as_chunks().0.as_chunks().0;
        Some(LineTable { lengths, chapters })
    }

    /// Of the lines of the chapter, and of the one after them.
    fn starts_in(self, chapter: usize) -> Option<impl Iterator<Item = u32>> {
        let [start, at] = match chapter.checked_sub(1) {
            Some(index) => self.chapters.get(index)?.map(u32::from_le_bytes),
            None => [0, 0],
        };
        let mut digits = self.lengths.get(at as usize..)?.iter();
        let next = move |&start: &u32| {
            let mut length = 0;
            for place in 0..MAX_LENGTH_BYTES {
                let digit = *digits.next()?;
                length |= u32::from(digit & 0x7f) << (7 * place);
                if digit < 0x80 {
                    return start.checked_add(length);
                }
            }
            None
        };
        Some(core::iter::successors(Some(start), next).take(LINES_PER_CHAPTER as usize + 1))
    }

    /// An offset past the end is on the last line.
    pub fn line_and_column(self, offset: u32) -> (u32, u32) {
        let chapter = (self.chapters).partition_point(|it| u32::from_le_bytes(it[0]) <= offset);
        let starts = self.starts_in(chapter).into_iter().flatten();
        let first = (chapter as u32).wrapping_mul(LINES_PER_CHAPTER);
        let begun = (0..).zip(starts).take_while(|&(_, start)| start <= offset);
        let (line, start) = begun.last().unwrap_or((0, offset));
        (first.wrapping_add(line), offset - start)
    }

    /// Without what ends it. `text` is the one that the table was made for.
    pub fn range_of(self, text: Text<'_>, line: u32) -> Option<Range<u32>> {
        let mut starts = self.starts_in((line / LINES_PER_CHAPTER) as usize)?;
        let end_of_text = text.len() as u32;
        let start = (starts.nth((line % LINES_PER_CHAPTER) as usize)?).min(end_of_text);
        let Some(next) = starts.next().filter(|it| start < *it && *it <= end_of_text) else {
            return Some(start..end_of_text);
        };
        let is_pair = next - start >= 2
            && text.at(next as usize - 1) == 0x0a
            && text.at(next as usize - 2) == 0x0d;
        Some(start..next - 1 - u32::from(is_pair))
    }

    /// A column past the end of its line is that end, and so is a line past the end of the text.
    pub fn offset_of(self, text: Text<'_>, line: u32, column: u32) -> u32 {
        self.range_of(text, line)
            .map_or(text.len() as u32, |range| {
                range.start.saturating_add(column).min(range.end)
            })
    }
}
