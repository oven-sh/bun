//! Lines and columns.

use crate::ast::{File, Name};
use crate::span::{Position, Span};
use bun_sema::atom::Atom;
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
            self.small
                .resize((at + 1).next_power_of_two().max(1024), None);
        }
        if let Some(place) = self.small.get_mut(at) {
            *place = Some(found);
        }
        found
    }
}

/// Where the lines of a file start.
pub(crate) struct Lines {
    starts: LineStarts,
    /// A bit for each line that has a byte that is not ASCII, from the first. In the others no column needs converting: a byte is
    /// a UTF-16 code unit. Empty if there is no such line.
    not_ascii: Vec<u64>,
    /// For columns far into a line: how many UTF-16 code units the characters have that start before each multiple of
    /// `BLOCK`, and at last all of them. `None` if the text is not valid UTF-8. Made when the first such column is asked for.
    units: OnceCell<Option<Vec<u32>>>,
}

impl Lines {
    fn new(text: &[u8], starts: LineStarts) -> Lines {
        let (mut not_ascii, mut at) = (Vec::new(), 0);
        while let Some(found) = text.get(at..).and_then(bun_core::strings::first_non_ascii) {
            let line = starts.line_at(at as u32 + found).0 as usize;
            not_ascii.resize(starts.starts.len().div_ceil(64), 0u64);
            if let Some(bits) = not_ascii.get_mut((line - 1) / 64) {
                *bits |= 1 << ((line - 1) % 64);
            }
            // On with the next line.
            match starts.starts.get(line) {
                Some(next) => at = *next as usize,
                None => break,
            }
        }
        Lines {
            starts,
            not_ascii,
            units: OnceCell::new(),
        }
    }

    /// The whole text.
    #[inline]
    fn is_ascii(&self) -> bool {
        self.not_ascii.is_empty()
    }

    /// The line `line`, counted from 1.
    #[inline]
    fn is_line_ascii(&self, line: u32) -> bool {
        let bits = self.not_ascii.get((line as usize - 1) / 64);
        bits.is_none_or(|bits| (bits >> ((line - 1) % 64)) & 1 == 0)
    }
}

/// Where the lines of a text start.
pub struct LineStarts {
    starts: Vec<u32>,
    /// The line that was found last, counted from 0. The next one that is asked for is mostly near it.
    last: Cell<u32>,
}

impl LineStarts {
    /// Of `text`, in which a line ends where ECMAScript says so.
    pub fn new(text: &[u8]) -> LineStarts {
        LineStarts::at(line_starts(text, is_plain(text)))
    }

    /// `starts`: ascending, from 0.
    pub fn at(starts: Vec<u32>) -> LineStarts {
        let last = Cell::new(0);
        LineStarts { starts, last }
    }

    /// Where the line `line`, counted from 1, starts.
    #[inline]
    pub fn start_of(&self, line: u32) -> Option<u32> {
        self.starts.get((line as usize).checked_sub(1)?).copied()
    }

    /// The line that `offset` is in, counted from 1, and where it starts.
    #[inline]
    pub fn line_at(&self, offset: u32) -> (u32, u32) {
        let found = self.line_from(self.last.get(), offset);
        self.last.set(found.0 - 1);
        found
    }

    /// The same, looked for from the line `from`, counted from 0.
    #[inline]
    fn line_from(&self, from: u32, offset: u32) -> (u32, u32) {
        let (starts, mut at) = (&self.starts[..], from as usize);
        // That line and the next few, one by one.
        if let Some(mut start) = starts.get(at).copied().filter(|start| *start <= offset) {
            for _ in 0..4 {
                match starts.get(at + 1) {
                    Some(&next) if next <= offset => (at, start) = (at + 1, next),
                    _ => return (at as u32 + 1, start),
                }
            }
        }
        self.line_far_from(at, offset)
    }

    #[inline(never)]
    fn line_far_from(&self, from: usize, offset: u32) -> (u32, u32) {
        let starts = &self.starts[..];
        let starts_by = |at: usize| starts.get(at).is_some_and(|&start| start <= offset);
        // The line is one from `low` to before `high`. The steps away from `from` double.
        let (mut low, mut high) = (from, starts.len());
        let mut step = 1;
        if starts_by(low) {
            while starts_by(low + step) {
                low += step;
                step *= 2;
            }
            high = high.min(low + step);
        } else {
            loop {
                high = low;
                low = low.saturating_sub(step);
                if low == 0 || starts_by(low) {
                    break;
                }
                step *= 2;
            }
        }
        let between = starts.get(low + 1..high).unwrap_or_default();
        let at = low + between.partition_point(|&start| start <= offset);
        (at as u32 + 1, starts.get(at).copied().unwrap_or(0))
    }
}

/// A column is counted from the start of its line if that is no further away.
const FAR: u32 = 512;
const BLOCK: usize = 1024;

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
    /// How many lines there are.
    count: OnceCell<u32>,
}

/// Whether only `\n` ends a line of `text`.
fn is_plain(text: &[u8]) -> bool {
    use bun_core::strings::{contains, contains_char};
    !contains_char(text, b'\r')
        && (!contains_char(text, 0xE2)
            || !contains(text, "\u{2028}".as_bytes()) && !contains(text, "\u{2029}".as_bytes()))
}

impl<'a> File<'a> {
    /// Whether only `\n` ends a line.
    fn is_plain(&self) -> bool {
        let nearby = &self.by_kind().nearby_line;
        *nearby.is_plain.get_or_init(|| is_plain(self.text()))
    }

    /// The line that `offset` is in, counted from 1, and where it starts, if that takes less than to find all lines.
    fn nearby_line(&self, offset: u32) -> Option<(u32, u32)> {
        if self.lazy.lines.get().is_some() || !self.is_plain() {
            return None;
        }
        let (text, nearby) = (self.text(), &self.by_kind().nearby_line);
        let (known, lines_before) = nearby.known.get();
        let between = text.get(known.min(offset) as usize..known.max(offset) as usize)?;
        // To count is many times faster than to note where each line starts.
        let looked_at = nearby.looked_at.get() + between.len() + 256;
        if looked_at > 4 * text.len() {
            return None;
        }
        nearby.looked_at.set(looked_at);
        let breaks = bun_core::strings::count_char(between, b'\n') as u32;
        let lines_before = if offset >= known {
            lines_before + breaks
        } else {
            lines_before - breaks
        };
        nearby.known.set((offset, lines_before));
        let start = bun_core::strings::last_index_of_char(&text[..offset as usize], b'\n')
            .map_or(0, |at| at as u32 + 1);
        // The line has been looked at up to here, and is once more for the column. The 256 above stand for a line of ordinary length.
        nearby
            .looked_at
            .set(looked_at + (2 * (offset - start) as usize).saturating_sub(256));
        Some((lines_before + 1, start))
    }

    fn lines_index(&self) -> &Lines {
        self.lazy.lines.get_or_init(|| {
            let starts = LineStarts::at(line_starts(self.text(), self.is_plain()));
            Lines::new(self.text(), starts)
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
                    units.push(
                        units.last().copied().unwrap_or(0)
                            + bun_core::strings::element_length_utf8_into_utf16(block) as u32,
                    );
                }
                units
            })
        });
        let block = offset as usize / BLOCK;
        Some(
            units.as_ref()?.get(block)?
                + bun_core::strings::element_length_utf8_into_utf16(
                    text.get(block * BLOCK..offset as usize)?,
                ) as u32,
        )
    }

    /// `text.length` in JavaScript of what is from `start` to `end`, both of which are where a character starts.
    fn units_between(&self, start: u32, end: u32) -> u32 {
        // While the lines are counted, so is what is looked at for a column.
        if end - start > FAR
            && self.lazy.lines.get().is_some()
            && let (Some(before_start), Some(before_end)) =
                (self.units_before(start), self.units_before(end))
        {
            return before_end - before_start;
        }
        bun_core::strings::utf8_decoded_len_utf16(self.slice(Span::new(start, end)))
    }

    /// Where ESLint's text starts: it has no byte order mark. So a line and a column do not count it either.
    #[inline]
    fn start_of_text(&self) -> u32 {
        if self.has_bom() { 3 } else { 0 }
    }

    /// Where the lines start, if that has been looked for: what [`LineStarts::at`] takes.
    pub fn known_line_starts(&self) -> Option<&[u32]> {
        Some(&self.lazy.lines.get()?.starts.starts)
    }

    /// ESLint's `sourceCode.lines.length`.
    pub fn line_count(&self) -> u32 {
        if self.lazy.lines.get().is_some() || !self.is_plain() {
            return self.lines_index().starts.starts.len() as u32;
        }
        let count = || bun_core::strings::count_char(self.text(), b'\n') as u32 + 1;
        *self.by_kind().nearby_line.count.get_or_init(count)
    }

    /// The line that `offset` is in, counted from 1.
    pub fn line_of(&self, offset: u32) -> u32 {
        if let Some((line, _)) = self.nearby_line(offset.min(self.text().len() as u32)) {
            return line;
        }
        self.lines_index().starts.line_at(offset).0
    }

    /// Where the line `line`, counted from 1, starts and where it ends, before its line break. The first starts after a byte
    /// order mark.
    pub fn line_span(&self, line: u32) -> Span {
        // The last is found without the others.
        let is_counted = self.lazy.lines.get().is_none() && self.is_plain();
        if line > 1 && is_counted && line == self.line_count() {
            let text = self.text();
            let start = bun_core::strings::last_index_of_char(text, b'\n').map_or(0, |at| at + 1);
            return Span::new(start as u32, text.len() as u32);
        }
        let (starts, text) = (&self.lines_index().starts.starts, self.text());
        let Some(&start) = starts.get((line as usize).wrapping_sub(1)) else {
            return Span::empty(text.len() as u32);
        };
        let start = start.max(self.start_of_text());
        let mut end = starts
            .get(line as usize)
            .map_or(text.len(), |&next| next as usize);
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
        let offset = offset.min(self.text().len() as u32);
        match self.nearby_line(offset) {
            Some((line, start)) => self.position_in_line(line, start, offset, false),
            None => {
                let lines = self.lines_index();
                let (line, start) = lines.starts.line_at(offset);
                self.position_in_line(line, start, offset, lines.is_line_ascii(line))
            }
        }
    }

    /// The positions of `count` spans are about to be asked for. If that is many for a text of this length, where the lines start
    /// is found at once. It takes about as long as to find the lines of a dozen spans one by one in 25,000 bytes.
    pub(crate) fn expect_positions(&self, count: usize) {
        if count.saturating_mul(2048) >= self.text().len() {
            self.lines_index();
        }
    }

    /// [`File::position`] of the start and of the end of `span`. Fast if the spans are asked for in the order of their starts.
    pub fn positions(&self, span: Span) -> (Position, Position) {
        let Some(lines) = self.lazy.lines.get() else {
            return (self.position(span.start), self.position(span.end));
        };
        let len = self.text().len() as u32;
        let (from, to) = (span.start.min(len), span.end.min(len));
        let (line, start) = lines.starts.line_at(from);
        let (end_line, end_start) = lines.starts.line_from(line - 1, to);
        let (is_ascii, is_end_ascii) = (lines.is_line_ascii(line), lines.is_line_ascii(end_line));
        if is_ascii && is_end_ascii {
            let (column, end_column) = (from - start, to - end_start);
            let end = Position {
                line: end_line,
                column: end_column,
            };
            return (Position { line, column }, end);
        }
        (
            self.position_in_line(line, start, from, is_ascii),
            self.position_in_line(end_line, end_start, to, is_end_ascii),
        )
    }

    /// The position of `offset`, which is in the line `line`, which starts at `start`. `is_ascii`: the line is known to be.
    #[inline]
    fn position_in_line(&self, line: u32, start: u32, offset: u32, is_ascii: bool) -> Position {
        let text = self.text();
        let start = match start {
            0 => self.start_of_text(),
            start => start,
        };
        let offset = offset.max(start);
        let is_ascii = is_ascii
            || offset - start <= FAR
                && self.slice(Span::new(start, offset)).is_ascii()
                && (text.get(offset as usize)).is_none_or(|byte| byte & 0xC0 != 0x80);
        if is_ascii {
            return Position {
                line,
                column: offset - start,
            };
        }
        let mut character = offset;
        while character > start
            && text
                .get(character as usize)
                .is_some_and(|byte| byte & 0xC0 == 0x80)
        {
            character -= 1;
        }
        let is_between_surrogates = character < offset
            && text
                .get(character as usize)
                .is_some_and(|&byte| byte >= 0xF0);
        let column = self.units_between(start, character) + u32::from(is_between_surrogates);
        Position { line, column }
    }

    /// ESLint's `getIndexFromLoc`. The position between the two UTF-16 code units of a character is its offset plus 2.
    pub fn offset(&self, position: Position) -> u32 {
        let line = self.line_span(position.line);
        if self.lines_index().is_ascii() {
            return line.start + position.column;
        }
        let (mut at, mut units) = (line.start, 0);
        let text = self.text();
        // Far into a line, it starts at the last block that begins before the column.
        if position.column > FAR
            && let Some(before_line) = self.units_before(line.start)
            && let Some(Some([blocks @ .., _])) =
                self.lines_index().units.get().map(Option::as_deref)
        {
            let block = blocks
                .partition_point(|&before| before <= before_line + position.column)
                .saturating_sub(1);
            let mut first = (block * BLOCK) as u32;
            while text
                .get(first as usize)
                .is_some_and(|byte| byte & 0xC0 == 0x80)
            {
                first += 1;
            }
            if first > line.start
                && let Some(&before) = blocks.get(block)
            {
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
        self.mentions_bit(mention_bit_without_loop(text.as_bytes()))
    }

    /// [`File::mentions`] for a text whose [`mention_bit`] is known: a rule that looks for hundreds of names, which are not constants
    /// of the program, computes their bits once, in [`Rule::new`](crate::rule::Rule::new).
    #[inline]
    pub fn mentions_bit(&self, bit: u32) -> bool {
        self.hir
            .mentioned
            .get(bit as usize / 64)
            .is_none_or(|word| word >> (bit % 64) & 1 != 0)
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

    /// [`File::name_of`], if the file [mentions](File::mentions) `text`. Where the file is linted on its own that is exact:
    /// `None` unless `text` is one of the texts that `mentions` is about. For [`Rule::register`](crate::rule::Rule::register):
    /// `let name = file.find_name("text")?;`
    pub fn find_name(&'a self, text: &str) -> Option<Name<'a>> {
        if !self.mentions(text) {
            return None;
        }
        match self.hir.mentioned.is_empty() {
            // The names are those of many files.
            true => Some(self.name_of(text)),
            false => self.atoms.find(text.as_bytes()).map(|it| self.name(it)),
        }
    }

    /// Every text that [`File::mentions`] is about, once, in no particular order. Among them are names that every file knows,
    /// whether this one has them or not. `None` where the names are those of many files. For a rule that looks for a
    /// prefix or a pattern, or without regard to case: a file has a tenth as many texts as nodes.
    pub fn own_names(&'a self) -> Option<impl Iterator<Item = Name<'a>> + 'a> {
        let texts = self.texts;
        let is_own = move |atom: &Atom| texts.span_of(*atom).is_some();
        (!self.hir.mentioned.is_empty() && is_own(&Atom(0))).then(|| {
            (0..)
                .map(Atom)
                .take_while(is_own)
                .map(|atom| self.name(atom))
        })
    }

    /// Whether the file [mentions](File::mentions) one of `texts`.
    #[inline]
    pub fn mentions_any(&self, texts: &[&str]) -> bool {
        texts.iter().any(|text| self.mentions(text))
    }
}

/// [`mention_bit`]. Of a literal this is a constant of the program, which a loop over its bytes is not always.
#[inline(always)]
fn mention_bit_without_loop(text: &[u8]) -> u32 {
    let mut first = [0; 16];
    let len = text.len().min(first.len());
    first[..len].copy_from_slice(&text[..len]);
    let first = u128::from_le_bytes(first);
    bun_sema::hir::mention_bit_of([first as u64, (first >> 64) as u64], text.len())
}

/// Where the lines of `text` start.
fn line_starts(text: &[u8], is_plain: bool) -> Vec<u32> {
    match is_plain {
        // Only `\n` ends a line, as in nearly every file.
        true => bun_core::strings::line_starts(text),
        false => bun_sema::check::compute_ecma_line_starts(text),
    }
}
