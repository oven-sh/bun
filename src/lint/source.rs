//! Lines and columns.

use crate::ast::{File, Name};
use crate::span::{Position, Span};
use bun_sema::atom::Atom;
pub use bun_sema::hir::mention_bit;
use rustc_hash::FxHashMap;
use std::cell::{Cell, OnceCell};

/// Caches what a rule computed for each name in a file. It's for rules that ask the same question about every
/// identifier, since a file has many times more identifiers than distinct names. A lookup is one load.
pub struct ByName<T> {
    /// Indexed by the name's atom number. When a file is linted on its own, its names have small numbers.
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
    /// Returns the cached value for `name`, calling `compute` on the first lookup.
    #[inline]
    pub fn get_or_insert_with(&mut self, name: Name<'_>, compute: impl FnOnce() -> T) -> T {
        match self.small.get(name.atom().0 as usize) {
            Some(Some(known)) => *known,
            _ => self.insert(name.atom().0, compute()),
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
        if let Some(slot) = self.small.get_mut(at) {
            *slot = Some(found);
        }
        found
    }
}

/// A file's line starts, plus what it takes to convert byte columns to UTF-16 columns.
pub(crate) struct Lines {
    starts: LineStarts,
    /// One bit per line, set if the line has a non-ASCII byte. Columns in the other lines need no conversion, since
    /// there a byte is a UTF-16 code unit. Empty if every line is ASCII.
    non_ascii_lines: Vec<u64>,
    /// For columns far into a line: the number of UTF-16 code units in the characters that start before each multiple
    /// of `BLOCK`, followed by the total. `None` if the text isn't valid UTF-8. Built the first time such a column is
    /// requested.
    units: OnceCell<Option<Vec<u32>>>,
}

impl Lines {
    fn new(text: &[u8], starts: LineStarts) -> Lines {
        let (mut non_ascii_lines, mut at) = (Vec::new(), 0);
        while let Some(found) = text.get(at..).and_then(bun_core::strings::first_non_ascii) {
            let line = starts.line_at(at as u32 + found).0 as usize;
            non_ascii_lines.resize(starts.starts.len().div_ceil(64), 0u64);
            if let Some(bits) = non_ascii_lines.get_mut((line - 1) / 64) {
                *bits |= 1 << ((line - 1) % 64);
            }
            match starts.starts.get(line) {
                Some(next) => at = *next as usize,
                None => break,
            }
        }
        Lines {
            starts,
            non_ascii_lines,
            units: OnceCell::new(),
        }
    }

    /// True if the whole text is ASCII.
    #[inline]
    fn is_ascii(&self) -> bool {
        self.non_ascii_lines.is_empty()
    }

    /// True if line `line` (1-based) is ASCII.
    #[inline]
    fn is_line_ascii(&self, line: u32) -> bool {
        let bits = self.non_ascii_lines.get((line as usize - 1) / 64);
        bits.is_none_or(|bits| (bits >> ((line - 1) % 64)) & 1 == 0)
    }
}

/// Which sequences count as a line break. It depends on the language.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum LineBreaks {
    /// `\n`, `\r\n`, `\r`, U+2028 and U+2029.
    #[default]
    EcmaScript,
    /// `\n`, `\r\n` and `\r`.
    Newlines,
}

impl LineBreaks {
    /// Returns true if `\n` is the only line break in `text`.
    fn is_plain(self, text: &[u8]) -> bool {
        use bun_core::strings::{contains, contains_char};
        !contains_char(text, b'\r')
            && match self {
                LineBreaks::EcmaScript => {
                    !contains_char(text, 0xE2)
                        || !contains(text, "\u{2028}".as_bytes())
                            && !contains(text, "\u{2029}".as_bytes())
                }
                LineBreaks::Newlines => true,
            }
    }

    /// Returns the start offset of each line in `text`.
    fn starts(self, text: &[u8], is_plain: bool) -> Vec<u32> {
        let ends: &[u8] = match self {
            // `\n` is the only line break, as in nearly every file.
            _ if is_plain => return bun_core::strings::line_starts(text),
            LineBreaks::EcmaScript => return bun_sema::check::compute_ecma_line_starts(text),
            LineBreaks::Newlines => b"\r\n",
        };
        let (mut starts, mut at) = (vec![0], 0);
        while let Some(found) = text
            .get(at..)
            .and_then(|rest| bun_core::strings::index_of_any(rest, ends))
        {
            at += found + 1 + usize::from(text[at + found..].starts_with(b"\r\n"));
            starts.push(at as u32);
        }
        starts
    }

    pub fn line_starts(self, text: &[u8]) -> LineStarts {
        LineStarts::at(self.starts(text, self.is_plain(text)))
    }

    /// Returns the line and column of `offset` in `text`. It scans the whole text, so it's only for things that are
    /// reported once per file.
    pub fn position(self, text: &[u8], offset: usize) -> Position {
        let offset = offset.min(text.len());
        let (line, start) = self.line_starts(text).line_at(offset as u32);
        let before = &text[start as usize..offset];
        let column = bun_core::strings::utf8_decoded_len_utf16(before);
        Position { line, column }
    }
}

/// A text's line starts.
pub struct LineStarts {
    starts: Vec<u32>,
    /// The last line found (0-based). The next lookup is usually near it.
    last: Cell<u32>,
}

impl LineStarts {
    /// `starts` must be ascending and begin with 0.
    pub fn at(starts: Vec<u32>) -> LineStarts {
        let last = Cell::new(0);
        LineStarts { starts, last }
    }

    /// Returns the start of line `line` (1-based).
    #[inline]
    pub fn start_of(&self, line: u32) -> Option<u32> {
        self.starts.get((line as usize).checked_sub(1)?).copied()
    }

    /// Returns the 1-based line that contains `offset`, and that line's start.
    #[inline]
    pub fn line_at(&self, offset: u32) -> (u32, u32) {
        let found = self.line_from(self.last.get(), offset);
        self.last.set(found.0 - 1);
        found
    }

    /// Like `line_at`, but starts the search at line `from` (0-based).
    #[inline]
    fn line_from(&self, from: u32, offset: u32) -> (u32, u32) {
        let (starts, mut at) = (&self.starts[..], from as usize);
        // Try that line and the next few one by one.
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
        // The line is in `low..high`. Gallop away from `from`, doubling the step, then binary search.
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

/// Columns up to this many bytes into a line are counted from the line's start.
const FAR: u32 = 512;
const BLOCK: usize = 1024;

/// Finds an offset's line in a file where only a few offsets are looked up. It counts the line breaks between lookups
/// instead of indexing every line start.
#[derive(Default)]
pub(crate) struct NearbyLine {
    /// True if `\n` is the only line break.
    is_plain: OnceCell<bool>,
    /// An offset and the number of line breaks before it.
    known: Cell<(u32, u32)>,
    /// Bytes scanned so far.
    bytes_scanned: Cell<usize>,
    /// The file's line count.
    count: OnceCell<u32>,
}

impl<'a> File<'a> {
    /// True if `\n` is the only line break in the file.
    fn is_plain(&self) -> bool {
        let nearby = &self.by_kind().nearby_line;
        *nearby
            .is_plain
            .get_or_init(|| self.line_breaks().is_plain(self.text()))
    }

    /// Returns the 1-based line that contains `offset` and that line's start, or `None` once indexing every line is
    /// cheaper.
    fn nearby_line(&self, offset: u32) -> Option<(u32, u32)> {
        if self.lazy.lines.get().is_some() || !self.is_plain() {
            return None;
        }
        let (text, nearby) = (self.text(), &self.by_kind().nearby_line);
        let (known, lines_before) = nearby.known.get();
        let between = text.get(known.min(offset) as usize..known.max(offset) as usize)?;
        // Counting line breaks is many times faster than recording every line start.
        let bytes_scanned = nearby.bytes_scanned.get() + between.len() + 256;
        if bytes_scanned > 4 * text.len() {
            return None;
        }
        nearby.bytes_scanned.set(bytes_scanned);
        let breaks = bun_core::strings::count_char(between, b'\n') as u32;
        let lines_before = if offset >= known {
            lines_before + breaks
        } else {
            lines_before - breaks
        };
        nearby.known.set((offset, lines_before));
        let start = bun_core::strings::last_index_of_char(&text[..offset as usize], b'\n')
            .map_or(0, |at| at as u32 + 1);
        // The line was scanned back to its start, and it's scanned again for the column. The 256 added above covers a
        // line of ordinary length.
        nearby
            .bytes_scanned
            .set(bytes_scanned + (2 * (offset - start) as usize).saturating_sub(256));
        Some((lines_before + 1, start))
    }

    fn lines_index(&self) -> &Lines {
        self.lazy.lines.get_or_init(|| {
            let starts = self.line_breaks().starts(self.text(), self.is_plain());
            let starts = LineStarts::at(starts);
            Lines::new(self.text(), starts)
        })
    }

    /// Returns the number of UTF-16 code units before `offset`, which must be a character boundary. `None` if the text
    /// isn't valid UTF-8.
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

    /// Returns the JavaScript `length` of the text from `start` to `end`. Both must be character boundaries.
    fn units_between(&self, start: u32, end: u32) -> u32 {
        // `nearby_line` already budgets for this scan, so the index isn't built just for a column.
        if end - start > FAR
            && self.lazy.lines.get().is_some()
            && let (Some(before_start), Some(before_end)) =
                (self.units_before(start), self.units_before(end))
        {
            return before_end - before_start;
        }
        bun_core::strings::utf8_decoded_len_utf16(self.slice(Span::new(start, end)))
    }

    /// Where ESLint's text starts. ESLint strips the byte order mark, so lines and columns don't count it.
    #[inline]
    fn start_of_text(&self) -> u32 {
        if self.has_bom() { 3 } else { 0 }
    }

    /// Returns the line starts if they've been computed, in the form [`LineStarts::at`] takes.
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

    /// Returns the 1-based line that contains `offset`.
    pub fn line_of(&self, offset: u32) -> u32 {
        if let Some((line, _)) = self.nearby_line(offset.min(self.text().len() as u32)) {
            return line;
        }
        self.lines_index().starts.line_at(offset).0
    }

    /// Returns the span of line `line` (1-based), without its line break. The first line starts after a byte order
    /// mark.
    pub fn line_span(&self, line: u32) -> Span {
        // The last line can be found without indexing the others.
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

    /// ESLint's `getLocFromIndex`. An offset inside a four-byte character maps to the position between its two UTF-16
    /// code units.
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

    /// Call this before looking up the positions of `count` spans. If that's a lot for a text of this length, it
    /// indexes the line starts up front. Indexing costs about as much as finding a dozen spans' lines one by one in
    /// 25,000 bytes.
    pub(crate) fn expect_positions(&self, count: usize) {
        if count.saturating_mul(2048) >= self.text().len() {
            self.lines_index();
        }
    }

    /// [`File::position`] of `span`'s start and end. Fast if spans are looked up in order of their starts.
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

    /// Returns the position of `offset`, which is in line `line`, which starts at `start`. Pass `is_ascii` if the line
    /// is known to be ASCII.
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

    /// ESLint's `getIndexFromLoc`. The position between a character's two UTF-16 code units maps to its offset plus 2.
    pub fn offset(&self, position: Position) -> u32 {
        let line = self.line_span(position.line);
        if self.lines_index().is_ascii() {
            return line.start + position.column;
        }
        let (mut at, mut units) = (line.start, 0);
        let text = self.text();
        // Far into a line, start counting at the last block that begins before the column.
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

    /// True if offsets `a` and `b` are on the same line.
    #[inline]
    pub fn is_on_same_line(&self, a: u32, b: u32) -> bool {
        self.line_of(a) == self.line_of(b)
    }
}

impl<'a> File<'a> {
    /// True if the file may mention `text` as an identifier, a property name, a key, a name in a type, a string, a
    /// template chunk or JSX text, however it's spelled. `false` is certain, `true` isn't. Doesn't cover private names.
    ///
    /// For [`Rule::register`](crate::rule::Rule::register): a rule about `eval` or `hasOwnProperty` doesn't need
    /// listeners in a file that never mentions it. This check costs next to nothing, unlike a listener that's called
    /// for every call or member access in the file.
    #[inline]
    pub fn mentions(&self, text: &str) -> bool {
        self.mentions_bit(mention_bit_without_loop(text.as_bytes()))
    }

    /// [`File::mentions`] for a text whose [`mention_bit`] is already known. A rule that looks for hundreds of names
    /// that aren't compile-time constants computes their bits once, in [`Rule::new`](crate::rule::Rule::new).
    #[inline]
    pub fn mentions_bit(&self, bit: u32) -> bool {
        self.hir
            .mentioned
            .get(bit as usize / 64)
            .is_none_or(|word| word >> (bit % 64) & 1 != 0)
    }

    /// True if the file may [mention](File::mentions) `use`, or a text that starts with `use` followed by an ASCII
    /// capital or digit, which is what React treats as a hook name.
    #[inline]
    pub fn mentions_hook_name(&self) -> bool {
        self.mentions_bit(bun_sema::hir::HOOK_MENTION_BIT)
    }

    /// Interns `text` as a name of this file, for comparing against many nodes' names. `name == wanted` compares two
    /// numbers, while `name.is("text")` looks up the name's text and compares that. Call it in
    /// [`Rule::register`](crate::rule::Rule::register) and store the result in the rule's state.
    pub fn name_of(&'a self, text: &str) -> Name<'a> {
        self.intern(text.as_bytes())
    }

    /// [`File::name_of`], if the file [mentions](File::mentions) `text`. When the file is linted on its own the answer
    /// is exact: `None` unless `text` is one of the texts `mentions` covers. For
    /// [`Rule::register`](crate::rule::Rule::register): `let name = file.find_name("text")?;`
    pub fn find_name(&'a self, text: &str) -> Option<Name<'a>> {
        if !self.mentions(text) {
            return None;
        }
        match self.hir.mentioned.is_empty() {
            // The name table is shared by many files.
            true => Some(self.name_of(text)),
            false => self.atoms.find(text.as_bytes()).map(|it| self.name(it)),
        }
    }

    /// Returns every text that [`File::mentions`] covers, once each, in no particular order. That includes names
    /// predefined for every file, whether or not this one uses them. `None` if the name table is shared by many files.
    /// For a rule that matches a prefix, a pattern or case-insensitively: a file has a tenth as many texts as nodes.
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

    /// True if the file [mentions](File::mentions) any of `texts`.
    #[inline]
    pub fn mentions_any(&self, texts: &[&str]) -> bool {
        texts.iter().any(|text| self.mentions(text))
    }
}

/// [`mention_bit`] without a loop. For a literal this always folds to a compile-time constant. A loop over the bytes
/// doesn't always.
#[inline(always)]
fn mention_bit_without_loop(text: &[u8]) -> u32 {
    let mut first = [0; 16];
    let len = text.len().min(first.len());
    first[..len].copy_from_slice(&text[..len]);
    let first = u128::from_le_bytes(first);
    bun_sema::hir::mention_bit_of([first as u64, (first >> 64) as u64], text.len())
}
