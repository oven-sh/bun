//! Lines and columns.

use crate::ast::{File, Name};
use crate::span::{Position, Span};
pub use bun_sema::hir::mention_bit;
use rustc_hash::FxHashMap;
use std::cell::{Cell, OnceCell};

/// What a rule has found out about each name of a file, for a rule that asks the same of every identifier: a file has many times
/// as many identifiers as names. Looking a name up is a load.
pub struct ByName<T> {
    /// By the number of the name. The names of a file that is linted on its own have small numbers.
    small: Vec<Option<T>>,
    others: FxHashMap<u32, T>,
}

impl<T> Default for ByName<T> {
    fn default() -> Self {
        ByName {
            small: Vec::new(),
            others: FxHashMap::default(),
        }
    }
}

impl<T: Copy> ByName<T> {
    /// What is known about `name`. `find_out` is called the first time.
    #[inline]
    pub fn get_or_insert_with(&mut self, name: Name<'_>, find_out: impl FnOnce() -> T) -> T {
        match self.small.get(name.atom().0 as usize) {
            Some(Some(known)) => *known,
            _ => self.insert(name.atom().0, find_out()),
        }
    }

    #[inline(never)]
    fn insert(&mut self, number: u32, found: T) -> T {
        const SMALL: usize = 1 << 14;
        let at = number as usize;
        if at >= SMALL {
            return *self.others.entry(number).or_insert(found);
        }
        if at >= self.small.len() {
            self.small.resize((at + 1).next_power_of_two().max(1024), None);
        }
        if let Some(place) = self.small.get_mut(at) {
            *place = Some(found);
        }
        found
    }
}

/// Where the lines of a file start.
pub(crate) struct Lines {
    starts: Vec<u32>,
    /// No column needs converting: a byte is a UTF-16 code unit.
    is_ascii: bool,
    /// For columns far into a line: how many UTF-16 code units the characters have that start before each multiple of
    /// `BLOCK`, and at last all of them. `None` if the text is not valid UTF-8. Made when the first such column is asked for.
    units: OnceCell<Option<Vec<u32>>>,
}

/// A column is counted from the start of its line if that is no further away.
const FAR: u32 = 512;
const BLOCK: usize = 1024;

/// How many UTF-16 code units the characters of valid UTF-8 have that start in `bytes`.
fn units_of_characters_starting_in(bytes: &[u8]) -> u32 {
    bytes.iter().map(|&byte| u32::from(byte & 0xC0 != 0x80) + u32::from(byte >= 0xF0)).sum()
}

/// For the line of an offset in a file of which few are asked for: then the lines in between are counted, and the starts of
/// all the lines are not looked for.
#[derive(Default)]
pub(crate) struct NearbyLine {
    /// Only `\n` ends a line.
    is_plain: OnceCell<bool>,
    /// An offset, and how many lines end before it.
    known: Cell<(u32, u32)>,
    /// How many bytes have been looked at.
    looked_at: Cell<usize>,
}

/// Whether only `\n` ends a line of `text`.
fn is_plain(text: &[u8]) -> bool {
    use bun_core::strings::{contains, contains_char};
    !contains_char(text, b'\r')
        && (!contains_char(text, 0xE2) || !contains(text, "\u{2028}".as_bytes()) && !contains(text, "\u{2029}".as_bytes()))
}

impl<'a> File<'a> {
    /// The line that `offset` is in, counted from 1, and where it starts, if that takes less than to find all lines.
    fn nearby_line(&self, offset: u32) -> Option<(u32, u32)> {
        if self.lazy.lines.get().is_some() {
            return None;
        }
        let (text, nearby) = (self.text(), &self.by_kind().nearby_line);
        if !*nearby.is_plain.get_or_init(|| is_plain(text)) {
            return None;
        }
        let (known, lines_before) = nearby.known.get();
        let between = text.get(known.min(offset) as usize..known.max(offset) as usize)?;
        // To count is many times faster than to note where each line starts.
        let looked_at = nearby.looked_at.get() + between.len() + 256;
        if looked_at > 4 * text.len() {
            return None;
        }
        nearby.looked_at.set(looked_at);
        let breaks = bun_core::strings::count_char(between, b'\n') as u32;
        let lines_before = if offset >= known { lines_before + breaks } else { lines_before - breaks };
        nearby.known.set((offset, lines_before));
        let start = bun_core::strings::last_index_of_char(&text[..offset as usize], b'\n').map_or(0, |at| at as u32 + 1);
        // The line has been looked at up to here, and is once more for the column. The 256 above stand for a line of ordinary length.
        nearby.looked_at.set(looked_at + (2 * (offset - start) as usize).saturating_sub(256));
        Some((lines_before + 1, start))
    }

    fn lines_index(&self) -> &Lines {
        self.lazy.lines.get_or_init(|| Lines {
            starts: line_starts(self.text()),
            is_ascii: bun_core::strings::first_non_ascii(self.text()).is_none(),
            units: OnceCell::new(),
        })
    }

    /// How many UTF-16 code units are before `offset`, which is where a character starts. `None` if that is not kept.
    fn units_before(&self, offset: u32) -> Option<u32> {
        let text = self.text();
        let units = self.lines_index().units.get_or_init(|| {
            bun_core::strings::is_valid_utf8(text).then(|| {
                let mut units = Vec::with_capacity(text.len() / BLOCK + 2);
                units.push(0);
                for block in text.chunks(BLOCK) {
                    units.push(units.last().copied().unwrap_or(0) + units_of_characters_starting_in(block));
                }
                units
            })
        });
        let block = offset as usize / BLOCK;
        Some(units.as_ref()?.get(block)? + units_of_characters_starting_in(text.get(block * BLOCK..offset as usize)?))
    }

    /// `text.length` in JavaScript of what is from `start` to `end`, both of which are where a character starts.
    fn units_between(&self, start: u32, end: u32) -> u32 {
        // While the lines are counted, so is what is looked at for a column.
        if end - start > FAR
            && self.lazy.lines.get().is_some()
            && let (Some(before_start), Some(before_end)) = (self.units_before(start), self.units_before(end))
        {
            return before_end - before_start;
        }
        utf16_len(self.slice(Span::new(start, end)))
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
        if let Some((line, _)) = self.nearby_line(offset.min(self.text().len() as u32)) {
            return line;
        }
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
        let (line, start, is_ascii) = match self.nearby_line(offset) {
            Some((line, start)) => (line, start, false),
            None => {
                let (line, lines) = (self.line_of(offset), self.lines_index());
                (line, lines.starts[line as usize - 1], lines.is_ascii)
            }
        };
        let start = start.max(self.start_of_text());
        let offset = offset.max(start);
        if is_ascii {
            return Position { line, column: offset - start };
        }
        let mut character = offset;
        while character > start && text.get(character as usize).is_some_and(|byte| byte & 0xC0 == 0x80) {
            character -= 1;
        }
        let is_between_surrogates = character < offset && text.get(character as usize).is_some_and(|&byte| byte >= 0xF0);
        let column = self.units_between(start, character) + u32::from(is_between_surrogates);
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
        // Far into a line, it starts at the last block that begins before the column.
        if position.column > FAR
            && let Some(before_line) = self.units_before(line.start)
            && let Some(Some([blocks @ .., _])) = self.lines_index().units.get().map(Option::as_deref)
        {
            let block = blocks.partition_point(|&before| before <= before_line + position.column).saturating_sub(1);
            let mut first = (block * BLOCK) as u32;
            while text.get(first as usize).is_some_and(|byte| byte & 0xC0 == 0x80) {
                first += 1;
            }
            if first > line.start && let Some(&before) = blocks.get(block) {
                (at, units) = (first, before - before_line);
            }
        }
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
    /// Whether the file may mention `text`: as an identifier, the name of a property, a key, a name in a type, a string, a piece
    /// of a template or text in JSX, however it is spelled. `false` is certain, `true` is not. Not for private names.
    ///
    /// For [`Rule::register`](crate::rule::Rule::register): a rule that is about `eval` or `hasOwnProperty` has nothing to listen
    /// for in a file that does not mention it. That costs next to nothing, unlike a listener that is called with every call or
    /// every member access of the file.
    #[inline]
    pub fn mentions(&self, text: &str) -> bool {
        let bit = bun_sema::hir::mention_bit(text.as_bytes()) as usize;
        self.hir.mentioned.get(bit / 64).is_none_or(|word| word >> (bit % 64) & 1 != 0)
    }

    /// [`File::mentions`] for a text whose [`mention_bit`] is known: a rule that looks for hundreds of names, which are not constants
    /// of the program, computes their bits once, in [`Rule::new`](crate::rule::Rule::new).
    #[inline]
    pub fn mentions_bit(&self, bit: u32) -> bool {
        self.hir.mentioned.get(bit as usize / 64).is_none_or(|word| word >> (bit % 64) & 1 != 0)
    }

    /// Whether the file may [mention](File::mentions) `use`, or a text that starts with `use` and an ASCII capital or digit: what
    /// React takes for the name of a hook.
    #[inline]
    pub fn mentions_name_of_hook(&self) -> bool {
        self.mentions_bit(bun_sema::hir::MENTION_OF_A_HOOK)
    }

    /// `text` as a name of this file, to compare the names of many nodes with: `name == wanted` compares two numbers, where
    /// `name.is("text")` looks the text of the name up and compares that. For [`Rule::register`](crate::rule::Rule::register),
    /// which keeps it in the state of the rule.
    pub fn name_of(&'a self, text: &str) -> Name<'a> {
        self.intern(text.as_bytes())
    }

    /// Whether the file [mentions](File::mentions) one of `texts`.
    pub fn mentions_any(&self, texts: &[&str]) -> bool {
        texts.iter().any(|text| self.mentions(text))
    }
}

/// Where the lines of `text` start.
fn line_starts(text: &[u8]) -> Vec<u32> {
    if !is_plain(text) {
        return bun_sema::check::compute_ecma_line_starts(text);
    }
    // Only `\n` ends a line, as in nearly every file: 8 bytes are tested at a time.
    const ONES: u64 = 0x0101_0101_0101_0101;
    let mut starts = Vec::with_capacity(text.len() / 32 + 1);
    starts.push(0);
    let (words, tail) = text.as_chunks::<8>();
    let rest = text.len() - tail.len();
    for (i, word) in words.iter().enumerate() {
        let others = u64::from_le_bytes(*word) ^ (ONES * b'\n' as u64);
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
