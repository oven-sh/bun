use core::ops::Range;

use bun_core::strings;
use bun_sema::check::spans::compute_ecma_line_starts;

const BLOCK: usize = 64;

/// Lines and columns as source maps and Babel count them.
pub(crate) struct Positions<'a> {
    text: &'a [u8],
    line_starts: Vec<u32>,
    /// The line that each block of the text starts in.
    lines_of_blocks: Vec<u32>,
    /// The UTF-16 code units before each block. Empty for ASCII.
    units_before_blocks: Vec<u32>,
}

fn units_from(byte: u8) -> u32 {
    u32::from(byte & 0xC0 != 0x80) + u32::from(byte >= 0xF0)
}

fn count_units(text: &[u8]) -> u32 {
    text.iter().map(|&it| units_from(it)).sum()
}

impl<'a> Positions<'a> {
    pub(crate) fn new(text: &'a [u8]) -> Positions<'a> {
        let line_starts = compute_ecma_line_starts(text);
        let mut lines_of_blocks = Vec::with_capacity(text.len() / BLOCK + 1);
        for (&start, line_before) in line_starts[1..].iter().zip(0..) {
            lines_of_blocks.resize((start as usize).div_ceil(BLOCK), line_before);
        }
        lines_of_blocks.resize(text.len() / BLOCK + 1, line_starts.len() as u32 - 1);
        let mut units_before_blocks = Vec::new();
        if !strings::is_all_ascii(text) {
            let mut units = 0;
            for block in text.chunks(BLOCK) {
                units_before_blocks.push(units);
                units += count_units(block);
            }
            units_before_blocks.push(units);
        }
        Positions {
            text,
            line_starts,
            lines_of_blocks,
            units_before_blocks,
        }
    }

    pub(crate) fn line_count(&self) -> usize {
        self.line_starts.len()
    }

    /// From 0.
    pub(crate) fn line_of(&self, offset: u32) -> usize {
        let Some(&line) = self.lines_of_blocks.get(offset as usize / BLOCK) else {
            return self.line_starts.len() - 1;
        };
        let later = self.line_starts[line as usize + 1..].iter();
        line as usize + later.take_while(|&&start| start <= offset).count()
    }

    /// The end of the text if there is no such line.
    pub(crate) fn start_of_line(&self, line: usize) -> u32 {
        (self.line_starts.get(line).copied()).unwrap_or(self.text.len() as u32)
    }

    pub(crate) fn units_before(&self, offset: u32) -> u32 {
        let offset = offset.min(self.text.len() as u32);
        let block = offset as usize / BLOCK;
        match self.units_before_blocks.get(block) {
            Some(units) => units + count_units(&self.text[block * BLOCK..offset as usize]),
            None => offset,
        }
    }

    fn offset_after(&self, units: u32) -> u32 {
        let blocks = (self.units_before_blocks).partition_point(|&it| it <= units);
        let Some(block) = blocks.checked_sub(1) else {
            return units;
        };
        let bytes = self.text.get(block * BLOCK..).unwrap_or_default().iter();
        let left = bytes.scan(units - self.units_before_blocks[block], |left, &it| {
            left.checked_sub(units_from(it)).map(|it| *left = it)
        });
        (block * BLOCK + left.count()) as u32
    }

    /// Without the newline.
    pub(crate) fn line(&self, line: usize) -> Range<u32> {
        let start = self.start_of_line(line);
        let text = &self.text[start as usize..self.start_of_line(line + 1) as usize];
        start..start + strings::trim_right(text, b"\r\n").len() as u32
    }

    /// esbuild maps the space before a token. Vue counts columns on past the end of a line.
    pub(crate) fn token_at(&self, (line, column): (usize, u32)) -> u32 {
        let units = self.units_before(self.start_of_line(line));
        let rest = (self.text).get(self.offset_after(units.saturating_add(column)) as usize..);
        (self.text.len() - strings::trim_left(rest.unwrap_or_default(), b" \t").len()) as u32
    }

    /// Both from 0.
    pub(crate) fn line_and_column_of(&self, offset: u32) -> (usize, u32) {
        let line = self.line_of(offset);
        let column = self.units_before(offset) - self.units_before(self.line_starts[line]);
        (line, column)
    }
}
