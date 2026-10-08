//! Lines and columns.

use crate::ast::{File, Name};
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
            starts: line_starts(self.text()),
            is_ascii: bun_core::strings::first_non_ascii(self.text()).is_none(),
        })
    }

    /// Where ESLint's text starts: it has no byte order mark. So a line and a column do not count it either.
    #[inline]
    fn start_of_text(&self) -> u32 {
        if self.has_bom() { 3 } else { 0 }
    }

    /// ESLint's `sourceCode.lines.length`.
    pub fn line_count(&self) -> u32 {
        self.lines_index().starts.len() as u32
    }

    /// The line that `offset` is in, counted from 1.
    pub fn line_of(&self, offset: u32) -> u32 {
        self.lines_index().starts.partition_point(|&start| start <= offset) as u32
    }

    /// Where the line `line`, counted from 1, starts and where it ends, before its line break. The first starts after a byte
    /// order mark.
    pub fn line_span(&self, line: u32) -> Span {
        let (starts, text) = (&self.lines_index().starts, self.text());
        let Some(&start) = starts.get((line as usize).wrapping_sub(1)) else {
            return Span::empty(text.len() as u32);
        };
        let start = start.max(self.start_of_text());
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
        let start = self.lines_index().starts[line as usize - 1].max(self.start_of_text());
        let offset = offset.max(start);
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

impl<'a> File<'a> {
    /// Whether a name or a string of the file may be `text`: an identifier, the name of a property, a key, a string, a template
    /// without substitutions. `false` is certain, `true` is not.
    ///
    /// For [`Rule::register`](crate::rule::Rule::register): a rule that is about `eval` or `hasOwnProperty` has nothing to listen
    /// for in a file that does not mention it. It costs one search of the text, which is far less than a listener that is
    /// called with every call or every member access of the file.
    pub fn mentions(&self, text: &str) -> bool {
        bun_core::strings::contains(self.text(), text.as_bytes()) || self.has_other_spellings()
    }

    /// `text` as a name of this file, to compare the names of many nodes with: `name == wanted` compares two numbers, where
    /// `name.is("text")` looks the text of the name up and compares that. For [`Rule::register`](crate::rule::Rule::register),
    /// which keeps it in the state of the rule.
    pub fn name_of(&'a self, text: &str) -> Name<'a> {
        self.intern(text.as_bytes())
    }

    /// Whether the file [mentions](File::mentions) one of `texts`.
    pub fn mentions_any(&self, texts: &[&str]) -> bool {
        texts.iter().any(|text| bun_core::strings::contains(self.text(), text.as_bytes())) || self.has_other_spellings()
    }

    /// Whether a name or a string may be written otherwise than it reads: with `\u0061`, `\x61`, `\141`, a `\` before a line
    /// break, or `&#97;` in JSX.
    fn has_other_spellings(&self) -> bool {
        *self.by_kind().has_other_spellings.get_or_init(|| {
            let text = self.text();
            if !self.hir.jsx.is_empty() && bun_core::strings::contains_char(text, b'&') {
                return true;
            }
            let mut at = 0;
            while let Some(found) = bun_core::strings::index_of_char_usize(&text[at..], b'\\') {
                if matches!(text.get(at + found + 1), Some(b'u' | b'x' | b'0'..=b'9' | b'\r' | b'\n' | 0xE2)) {
                    return true;
                }
                at = (at + found + 2).min(text.len());
            }
            false
        })
    }
}

/// Where the lines of `text` start.
fn line_starts(text: &[u8]) -> Vec<u32> {
    if bun_core::strings::index_of_any(text, b"\r\xE2").is_some() {
        return bun_sema::check::compute_ecma_line_starts(text);
    }
    // Only `\n` ends a line, as in nearly every file: 8 bytes are tested at a time.
    const ONES: u64 = 0x0101_0101_0101_0101;
    let mut starts = Vec::with_capacity(text.len() / 32 + 1);
    starts.push(0);
    let words = text.chunks_exact(8);
    let rest = text.len() - words.remainder().len();
    for (i, word) in words.enumerate() {
        let others = u64::from_le_bytes(word.try_into().unwrap_or_default()) ^ (ONES * b'\n' as u64);
        // The high bit of each byte that is a `\n`.
        let mut found = !(((others & (ONES * 0x7F)) + ONES * 0x7F) | others) & (ONES * 0x80);
        while found != 0 {
            starts.push((i * 8) as u32 + found.trailing_zeros() / 8 + 1);
            found &= found - 1;
        }
    }
    for (i, &byte) in text[rest..].iter().enumerate() {
        if byte == b'\n' {
            starts.push((rest + i + 1) as u32);
        }
    }
    starts
}

/// `text.length` in JavaScript.
pub fn utf16_len(text: &[u8]) -> u32 {
    if text.is_ascii() {
        return text.len() as u32;
    }
    let (mut at, mut units) = (0, 0);
    while at < text.len() {
        let (c, size) = bun_core::lexer::char_and_size(text, at);
        units += if c > 0xFFFF { 2 } else { 1 };
        at += size.max(1);
    }
    units
}
