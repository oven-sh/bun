//! Lines and columns.

use crate::ast::File;
use crate::span::{Position, Span};

/// Where the lines of a file start.
pub(crate) struct Lines {
    starts: Vec<u32>,
    /// No column needs converting: a byte is a UTF-16 code unit.
    is_ascii: bool,
}

impl<'a> File<'a> {
    fn lines_index(&self) -> &Lines {
        self.lazy.lines.get_or_init(|| Lines {
            starts: bun_sema::check::compute_ecma_line_starts(self.text()),
            is_ascii: bun_core::strings::first_non_ascii(self.text()).is_none(),
        })
    }

    /// ESLint's `sourceCode.lines.length`.
    pub fn line_count(&self) -> u32 {
        self.lines_index().starts.len() as u32
    }

    /// The line that `offset` is in, counted from 1.
    pub fn line_of(&self, offset: u32) -> u32 {
        self.lines_index().starts.partition_point(|&start| start <= offset) as u32
    }

    /// Where the line `line`, counted from 1, starts and where it ends, before its line break.
    pub fn line_span(&self, line: u32) -> Span {
        let (starts, text) = (&self.lines_index().starts, self.text());
        let Some(&start) = starts.get((line as usize).wrapping_sub(1)) else {
            return Span::empty(text.len() as u32);
        };
        let mut end = starts.get(line as usize).map_or(text.len(), |&next| next as usize);
        if starts.get(line as usize).is_some() {
            let before = &text[start as usize..end];
            end -= match before {
                [.., b'\r', b'\n'] => 2,
                [.., 0xE2, 0x80, 0xA8 | 0xA9] => 3,
                _ => 1,
            };
        }
        Span::new(start, end as u32)
    }

    /// ESLint's `sourceCode.lines[line - 1]`.
    #[inline]
    pub fn line_text(&self, line: u32) -> &'a [u8] {
        self.slice(self.line_span(line))
    }

    /// ESLint's `getLocFromIndex`. An offset inside a character of four bytes is the position between its two UTF-16 code units.
    pub fn position(&self, offset: u32) -> Position {
        let text = self.text();
        let offset = offset.min(text.len() as u32);
        let line = self.line_of(offset);
        let start = self.lines_index().starts[line as usize - 1];
        if self.lines_index().is_ascii {
            return Position { line, column: offset - start };
        }
        let mut character = offset;
        while character > start && text.get(character as usize).is_some_and(|byte| byte & 0xC0 == 0x80) {
            character -= 1;
        }
        let is_between_surrogates = character < offset && text.get(character as usize).is_some_and(|&byte| byte >= 0xF0);
        let column = utf16_len(self.slice(Span::new(start, character))) + u32::from(is_between_surrogates);
        Position { line, column }
    }

    /// ESLint's `getIndexFromLoc`. The position between the two UTF-16 code units of a character is its offset plus 2.
    pub fn offset(&self, position: Position) -> u32 {
        let line = self.line_span(position.line);
        if self.lines_index().is_ascii {
            return line.start + position.column;
        }
        let (mut at, mut units) = (line.start, 0);
        let text = self.text();
        while units < position.column && (at as usize) < text.len() {
            let (c, size) = bun_core::lexer::char_and_size(text, at as usize);
            if c > 0xFFFF && units + 1 == position.column {
                return at + 2;
            }
            units += if c > 0xFFFF { 2 } else { 1 };
            at += size as u32;
        }
        at
    }

    /// Whether `a` and `b` start on the same line.
    #[inline]
    pub fn is_on_same_line(&self, a: u32, b: u32) -> bool {
        self.line_of(a) == self.line_of(b)
    }
}

/// `text.length` in JavaScript.
pub fn utf16_len(text: &[u8]) -> u32 {
    let (mut at, mut units) = (0, 0);
    while at < text.len() {
        let (c, size) = bun_core::lexer::char_and_size(text, at);
        units += if c > 0xFFFF { 2 } else { 1 };
        at += size.max(1);
    }
    units
}
