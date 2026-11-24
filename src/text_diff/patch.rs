//! Unified diffs: a port of `structuredPatch`, `formatPatch`, `parsePatch` and `applyPatch` of the package `diff` 9.0.0.
//! https://github.com/kpdecker/jsdiff/tree/v9.0.0/src/patch
//!
// jsdiff is Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>,
// licensed under the BSD 3-Clause License.

use core::cell::{Cell, OnceCell};
use core::ops::Range;
use std::io::Write as _;

use bun_core::strings::{
    contains_char, is_js_line_terminator, is_js_whitespace, to_utf16_alloc_for_real,
};
use bun_core::{UnwrapOrOom as _, slice_as_bytes};

use crate::tokens::{Edit, Split, Unit, count_newlines, for_each_line_end, is, line_start};

/// A start is the first line of the range, from 1. If the range is empty, it is the line after it.
pub struct PatchHunk<Line> {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<Line>,
}

fn extend_ascii<T: Unit>(out: &mut Vec<T>, ascii: &[u8]) {
    out.extend(ascii.iter().map(|&byte| T::from_u8(byte)));
}

// ───────────────────────────── create ─────────────────────────────

pub const NO_NEWLINE: &[u8] = b"\\ No newline at end of file";

pub enum Line<'a, T> {
    /// ` `, `-` or `+`, and the line without its `\n`.
    Text(u8, &'a [T]),
    NoNewline,
}

impl<T: Unit> Line<'_, T> {
    fn write(&self, out: &mut Vec<T>) {
        match *self {
            Line::Text(operation, text) => {
                out.push(T::from_u8(operation));
                out.extend_from_slice(text);
            }
            Line::NoNewline => extend_ascii(out, NO_NEWLINE),
        }
    }
}

fn push_line<'a, T: Unit>(lines: &mut Vec<Line<'a, T>>, operation: u8, line: &'a [T]) {
    match line.strip_suffix(&[T::from_u8(b'\n')]) {
        Some(line) => lines.push(Line::Text(operation, line)),
        None => lines.extend([Line::Text(operation, line), Line::NoNewline]),
    }
}

/// `text` has `count` lines.
fn push_lines<'a, T: Unit>(
    lines: &mut Vec<Line<'a, T>>,
    operation: u8,
    mut text: &'a [T],
    count: usize,
) {
    // One pass over the text is faster than a search for each line only if there are many.
    if count > 16 {
        let mut at = 0;
        for_each_line_end(text, |end| {
            lines.push(Line::Text(operation, &text[at..end - 1]));
            at = end;
        });
        text = &text[at..];
    } else {
        for _ in 1..count {
            let line;
            (line, text) = text.split_at(Split::Lines.end(text, 0));
            push_line(lines, operation, line);
        }
    }
    if !text.is_empty() {
        push_line(lines, operation, text);
    }
}

/// `edits` are by [`Split::Lines`]. The lines that are kept are those of `b`.
pub fn hunks<'a, T: Unit>(
    a: &'a [T],
    b: &'a [T],
    edits: &'a [Edit],
    context: usize,
) -> impl Iterator<Item = PatchHunk<Line<'a, T>>> {
    let reach = context.saturating_mul(2);
    let groups = edits.chunk_by(move |one, next| next.tokens.a_lo - one.tokens.a_hi <= reach);
    groups.map(move |group| {
        let first = &group[0];
        let before = context.min(first.tokens.a_lo);
        let mut at = (0..before).fold(first.units.b_lo, |at, _| line_start(b, at - 1));
        let (start_a, start_b) = (first.tokens.a_lo - before, first.tokens.b_lo - before);
        let last = &group[group.len() - 1];
        let inserted: usize = group.iter().map(|edit| edit.tokens.inserted()).sum();
        // With room for a usual context after the last edit, and two markers.
        let mut lines =
            Vec::with_capacity(last.tokens.a_hi - start_a + inserted + context.min(8) + 2);
        let mut line = start_a;
        for &Edit { units, tokens } in group {
            let (deleted, inserted) = (&a[units.a_lo..units.a_hi], &b[units.b_lo..units.b_hi]);
            push_lines(&mut lines, b' ', &b[at..units.b_lo], tokens.a_lo - line);
            push_lines(&mut lines, b'-', deleted, tokens.deleted());
            push_lines(&mut lines, b'+', inserted, tokens.inserted());
            (at, line) = (units.b_hi, tokens.a_hi);
        }
        let mut after = 0;
        while after < context && at < b.len() {
            let end = Split::Lines.end(b, at);
            push_line(&mut lines, b' ', &b[at..end]);
            (at, after) = (end, after + 1);
        }
        PatchHunk {
            old_start: start_a + 1,
            old_lines: last.tokens.a_hi - start_a + after,
            new_start: start_b + 1,
            new_lines: last.tokens.b_hi - start_b + after,
            lines,
        }
    })
}

/// `--- name` or `+++ name`, and after a tab `header`, which is one line.
pub fn write_file_header<T: Unit>(out: &mut Vec<T>, marker: &[u8], name: &[u8], header: &[T]) {
    extend_ascii(out, marker);
    extend_ascii(out, &quote(name));
    // Without the tab, GNU patch ends the name at a space.
    if !header.is_empty() || contains_char(name, b' ') {
        out.push(T::from_u8(b'\t'));
        out.extend_from_slice(header);
    }
    out.push(T::from_u8(b'\n'));
}

pub fn write_hunk<T: Unit>(out: &mut Vec<T>, hunk: &PatchHunk<Line<'_, T>>) {
    // The header of an empty range names the line before it.
    let header = format!(
        "@@ -{},{} +{},{} @@\n",
        hunk.old_start - usize::from(hunk.old_lines == 0),
        hunk.old_lines,
        hunk.new_start - usize::from(hunk.new_lines == 0),
        hunk.new_lines,
    );
    extend_ascii(out, header.as_bytes());
    for line in &hunk.lines {
        line.write(out);
        out.push(T::from_u8(b'\n'));
    }
}

const ESCAPES: [(u8, u8); 9] = [
    (0x07, b'a'),
    (0x08, b'b'),
    (b'\t', b't'),
    (b'\n', b'n'),
    (0x0B, b'v'),
    (0x0C, b'f'),
    (b'\r', b'r'),
    (b'"', b'"'),
    (b'\\', b'\\'),
];

/// As Git and GNU diff quote a file name in UTF-8. The result is ASCII.
fn quote(name: &[u8]) -> Vec<u8> {
    let is_plain = |byte: u8| matches!(byte, 0x20..=0x7E) && !matches!(byte, b'"' | b'\\');
    let is_padded = name.starts_with(b" ") || name.ends_with(b" ");
    if !is_padded && name.iter().all(|&byte| is_plain(byte)) {
        return name.to_vec();
    }
    let mut out = vec![b'"'];
    for &byte in name {
        if is_plain(byte) {
            out.push(byte);
        } else if let Some(&(_, letter)) = ESCAPES.iter().find(|escape| escape.0 == byte) {
            out.extend([b'\\', letter]);
        } else {
            let _ = write!(out, "\\{byte:03o}");
        }
    }
    out.push(b'"');
    out
}

// ───────────────────────────── parse ─────────────────────────────

/// UTF-16.
pub type Name = Vec<u16>;

#[derive(Default)]
pub struct FilePatch {
    pub index: Option<Name>,
    pub old_file_name: Option<Name>,
    pub old_header: Option<Name>,
    pub new_file_name: Option<Name>,
    pub new_header: Option<Name>,
    pub old_mode: Option<Name>,
    pub new_mode: Option<Name>,
    pub is_git: bool,
    pub is_rename: bool,
    pub is_copy: bool,
    pub is_create: bool,
    pub is_delete: bool,
    pub is_binary: bool,
    /// A line is its place in the patch.
    pub hunks: Vec<PatchHunk<Range<usize>>>,
}

/// `at` is the line of the hunk's header, from 1.
pub enum ParseError {
    MissingFileHeader {
        marker: &'static str,
        name: Name,
    },
    InvalidHunkHeader {
        at: usize,
    },
    InvalidLine {
        at: usize,
        line: Name,
    },
    AddedCount {
        at: usize,
    },
    RemovedCount {
        at: usize,
    },
    ExtraLines {
        at: usize,
        old_lines: usize,
        new_lines: usize,
    },
}

/// How much of the patch a message repeats.
const MAX_QUOTED: usize = 256;

impl core::fmt::Display for ParseError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let text = |text: &'_ Name| {
            bun_core::EncodedSlice::utf16(&text[..text.len().min(MAX_QUOTED)]).to_string()
        };
        match self {
            Self::MissingFileHeader { marker, name } => {
                write!(f, "Missing \"{marker} ...\" file header for {}", text(name))
            }
            Self::InvalidHunkHeader { at } => write!(
                f,
                "Hunk at line {at} does not start with \"@@ -start,lines +start,lines @@\""
            ),
            Self::InvalidLine { at, line } => {
                write!(f, "Hunk at line {at} contained invalid line {}", text(line))
            }
            Self::AddedCount { at } => {
                write!(f, "Added line count did not match for hunk at line {at}")
            }
            Self::RemovedCount { at } => {
                write!(f, "Removed line count did not match for hunk at line {at}")
            }
            Self::ExtraLines {
                at,
                old_lines,
                new_lines,
            } => write!(
                f,
                "Hunk at line {at} has more lines than expected (expected {old_lines} old lines and {new_lines} new lines)"
            ),
        }
    }
}

fn widen<T: Unit>(text: &[T]) -> Name {
    text.iter().map(|&unit| unit.into() as u16).collect()
}

fn strip<'a, T: Unit>(text: &'a [T], prefix: &[u8]) -> Option<&'a [T]> {
    let (start, rest) = text.split_at_checked(prefix.len())?;
    let same = start.iter().zip(prefix).all(|(a, &b)| *a == T::from_u8(b));
    same.then_some(rest)
}

fn split_while<T: Unit>(text: &[T], matches: impl Fn(u32) -> bool) -> (&[T], &[T]) {
    text.split_at(
        text.iter()
            .take_while(|&&unit| matches(unit.into()))
            .count(),
    )
}

pub(crate) fn trim<T: Unit>(text: &[T]) -> &[T] {
    let (_, text) = split_while(text, is_js_whitespace);
    let trailing = text.iter().rev();
    &text[..text.len()
        - trailing
            .take_while(|&&unit| is_js_whitespace(unit.into()))
            .count()]
}

fn without_cr<T: Unit>(line: &[T]) -> &[T] {
    line.strip_suffix(&[T::from_u8(b'\r')]).unwrap_or(line)
}

fn is_digit(unit: u32) -> bool {
    matches!(unit, 0x30..=0x39)
}

fn starts_with_space<T: Unit>(text: &[T]) -> bool {
    text.first()
        .is_some_and(|&unit| is_js_whitespace(unit.into()))
}

/// What follows `marker`, which starts with a space.
fn after_marker<'a, T: Unit>(line: &'a [T], marker: &[u8]) -> Option<&'a [T]> {
    strip(line, marker).filter(|rest| starts_with_space(rest))
}

fn is_file_header<T: Unit>(line: &[T]) -> bool {
    after_marker(line, b"---").is_some() || after_marker(line, b"+++").is_some()
}

fn is_hunk_header<T: Unit>(line: &[T]) -> bool {
    strip(line, b"@@").is_some_and(|rest| rest.is_empty() || starts_with_space(rest))
}

/// `Index: name`, or Mercurial's `diff -r 9117c6561b0b -r 273ce12ad8f1 name`.
fn index_name<T: Unit>(line: &[T]) -> Option<&[T]> {
    if let Some(name) = after_marker(line, b"Index:") {
        return Some(name);
    }
    let is_word = |unit: u32| unit < 0x80 && (unit == 0x5F || (unit as u8).is_ascii_alphanumeric());
    let (mut rest, mut name) = (strip(line, b"diff")?, None);
    while let Some((revision, after)) = strip(rest, b" -r ").map(|it| split_while(it, is_word))
        && !revision.is_empty()
        && starts_with_space(after)
    {
        (rest, name) = (after, Some(after));
    }
    name
}

const GIT_HEADER: &[u8] = b"diff --git ";

fn is_diff_header<T: Unit>(line: &[T]) -> bool {
    strip(line, GIT_HEADER).is_some() || index_name(line).is_some()
}

fn is_rule<T: Unit>(line: &[T]) -> bool {
    strip(line, &[b'='; 67]).is_some()
}

/// The name that `text` starts with in quotes, and what follows it.
fn unquote<T: Unit>(text: &[T]) -> Option<(Name, &[T])> {
    let mut rest = strip(text, b"\"")?;
    let (mut name, mut bytes) = (Name::new(), Vec::new());
    loop {
        if let Some(escape) = strip(rest, b"\\")
            && let Some((digits, after)) = escape.split_first_chunk::<3>()
            && digits.iter().all(|&it| matches!(it.into(), 0x30..=0x37))
            && digits[0].into() <= 0x33
        {
            let value = digits.iter().fold(0, |n, &it| n * 8 + it.into() - 0x30);
            bytes.push(value as u8);
            rest = after;
            continue;
        }
        if !bytes.is_empty() {
            name.extend(to_utf16_alloc_for_real(&bytes, false, false).unwrap_or_oom());
            bytes.clear();
        }
        let (&unit, after) = rest.split_first()?;
        rest = after;
        if unit == T::from_u8(b'"') {
            return Some((name, rest));
        }
        if unit == T::from_u8(b'\\') {
            let (&letter, after) = rest.split_first()?;
            let escape = ESCAPES.iter().find(|it| T::from_u8(it.1) == letter)?;
            name.push(u16::from(escape.0));
            rest = after;
        } else {
            name.push(unit.into() as u16);
        }
    }
}

fn unquote_if_quoted<T: Unit>(text: &[T]) -> Name {
    unquote(text).map_or_else(|| widen(text), |(name, _)| name)
}

/// `a/old b/new`
fn git_header_names<T: Unit>(names: &[T]) -> Option<(Name, Name)> {
    match T::index_of_unit(names, T::from_u8(b'"')) {
        Some(0) => {
            let (old, rest) = unquote(names)?;
            let new = rest.get(1..).unwrap_or_default();
            let is_quoted = is(new.first(), b'"');
            Some((
                old,
                if is_quoted {
                    unquote(new)?.0
                } else {
                    widen(new)
                },
            ))
        }
        Some(quote) => Some((widen(&names[..quote - 1]), unquote(&names[quote..])?.0)),
        None => {
            strip(names, b"a/")?;
            // A name can have ` b/` in it. Unless the names are the same, a later line has them, and if they are, it
            // is the one in the middle that is between them.
            let splits = || (1..names.len()).filter(|&at| strip(&names[at..], b" b/").is_some());
            let split = splits().nth(splits().count() / 2)?;
            Some((widen(&names[..split]), widen(&names[split + 1..])))
        }
    }
}

impl FilePatch {
    fn is_empty(&self) -> bool {
        !self.is_git
            && self.index.is_none()
            && self.old_file_name.is_none()
            && self.hunks.is_empty()
    }

    fn read_git_extended_header<T: Unit>(&mut self, line: &[T]) {
        let name = |prefix: &[u8], side: u8| {
            let (name, _) = split_while(strip(line, prefix)?, |unit| !is_js_line_terminator(unit));
            let side = [u16::from(side), u16::from(b'/')];
            Some([&side[..], &unquote_if_quoted(name)].concat())
        };
        let mode = |prefix: &[u8]| {
            let (digits, _) = split_while(strip(line, prefix)?, is_digit);
            (!digits.is_empty()).then(|| widen(digits))
        };
        if let Some(name) = name(b"rename from ", b'a') {
            (self.old_file_name, self.is_rename) = (Some(name), true);
        } else if let Some(name) = name(b"rename to ", b'b') {
            (self.new_file_name, self.is_rename) = (Some(name), true);
        } else if let Some(name) = name(b"copy from ", b'a') {
            (self.old_file_name, self.is_copy) = (Some(name), true);
        } else if let Some(name) = name(b"copy to ", b'b') {
            (self.new_file_name, self.is_copy) = (Some(name), true);
        } else if let Some(mode) = mode(b"new file mode ") {
            (self.new_mode, self.is_create) = (Some(mode), true);
        } else if let Some(mode) = mode(b"deleted file mode ") {
            (self.old_mode, self.is_delete) = (Some(mode), true);
        } else if let Some(mode) = mode(b"old mode ") {
            self.old_mode = Some(mode);
        } else if let Some(mode) = mode(b"new mode ") {
            self.new_mode = Some(mode);
        } else if strip(line, b"Binary files ").is_some()
            || strip(line, b"GIT binary patch").is_some()
        {
            self.is_binary = true;
        }
    }

    fn read_file_header<T: Unit>(&mut self, line: &[T]) {
        let tab = T::from_u8(b'\t');
        let mut fields = trim(&line[3..]).split(|&unit| unit == tab);
        let name = fields.next().unwrap_or_default();
        let header = widen(trim(fields.next().unwrap_or_default()));
        let name = if is(name.first(), b'"') {
            unquote_if_quoted(name)
        } else {
            let (mut rest, mut unescaped) = (name, Name::with_capacity(name.len()));
            while let Some((&unit, after)) = rest.split_first() {
                unescaped.push(unit.into() as u16);
                rest = strip(rest, b"\\\\").unwrap_or(after);
            }
            unescaped
        };
        if is(line.first(), b'-') {
            (self.old_file_name, self.old_header) = (Some(name), Some(header));
        } else {
            (self.new_file_name, self.new_header) = (Some(name), Some(header));
        }
    }
}

/// `start,lines` or `start`, and what follows it. No string has more lines than `i32::MAX`.
fn hunk_range<T: Unit>(text: &[T]) -> Option<(usize, usize, &[T])> {
    fn number<T: Unit>(text: &[T]) -> Option<(usize, &[T])> {
        let (digits, rest) = split_while(text, is_digit);
        let value = digits.iter().try_fold(0i32, |n, &digit| {
            n.checked_mul(10)?.checked_add(digit.into() as i32 - 0x30)
        })?;
        (!digits.is_empty()).then_some((value as usize, rest))
    }
    let (start, rest) = number(text)?;
    let (lines, rest) = match strip(rest, b",") {
        Some(rest) => number(rest)?,
        None => (1, rest),
    };
    Some((start + usize::from(lines == 0), lines, rest))
}

fn hunk_header<T: Unit>(line: &[T]) -> Option<PatchHunk<Range<usize>>> {
    let (old_start, old_lines, rest) = hunk_range(strip(line, b"@@ -")?)?;
    let (new_start, new_lines, rest) = hunk_range(strip(rest, b" +")?)?;
    strip(rest, b" @@")?;
    Some(PatchHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: Vec::new(),
    })
}

/// `text.split("\n")`, one at a time.
struct Parser<'a, T> {
    text: &'a [T],
    /// `None` after the last.
    line: Option<Range<usize>>,
    /// From 1.
    number: usize,
    next_header: NextHeader,
}

/// The line that starts a hunk or a section, seen from the last `---` or `+++` that looked for it.
#[derive(Clone, Copy, Default)]
struct NextHeader {
    number: usize,
    is_git: bool,
}

impl<'a, T: Unit> Parser<'a, T> {
    fn line_from(text: &[T], start: usize) -> Range<usize> {
        let length = T::index_of_unit(&text[start..], T::from_u8(b'\n'));
        start..length.map_or(text.len(), |length| start + length)
    }

    /// Without its `\r`, which only the lines of a hunk keep.
    fn peek(&self) -> Option<&'a [T]> {
        Some(without_cr(&self.text[self.line.clone()?]))
    }

    fn advance(&mut self) {
        let before_last = self.line.take().filter(|line| line.end < self.text.len());
        self.line = before_last.map(|line| Self::line_from(self.text, line.end + 1));
        self.number += 1;
    }

    /// A commit message can have a line like `--- Original Message ---`. It is alone, and `diff --git` follows it.
    fn is_at_file_header(&mut self) -> bool {
        let Some(line) = self.peek().filter(|line| is_file_header(line)) else {
            return false;
        };
        let mut ahead = Parser {
            line: self.line.clone(),
            ..*self
        };
        ahead.advance();
        let next = ahead.peek().unwrap_or_default();
        if is(line.first(), b'-')
            && (after_marker(next, b"+++").is_some() || self.is_in_header(next))
        {
            return true;
        }
        if self.number >= self.next_header.number {
            while let Some(line) = ahead.peek()
                && !is_diff_header(line)
                && strip(line, b"@@").is_none()
            {
                ahead.advance();
            }
            self.next_header = NextHeader {
                number: ahead.number,
                is_git: ahead
                    .peek()
                    .is_some_and(|it| strip(it, GIT_HEADER).is_some()),
            };
        }
        !self.next_header.is_git
    }

    /// The lines before this one, from the nearest.
    fn before(&self) -> impl Iterator<Item = &'a [T]> {
        let (text, mut start) = (self.text, self.line.as_ref().map_or(0, |line| line.start));
        core::iter::from_fn(move || {
            let end = start.checked_sub(1)?;
            start = line_start(text, end);
            Some(without_cr(&text[start..end]))
        })
    }

    fn is_after_rule_of_index(&self) -> bool {
        let mut before = self.before();
        before.next().is_some_and(is_rule) && before.next().and_then(index_name).is_some()
    }

    /// After `Index:` or its rule, or between `*** name` and the stars that start a hunk of `diff -c`.
    fn is_in_header(&self, next: &[T]) -> bool {
        let last = self.before().next().unwrap_or_default();
        index_name(last).is_some()
            || self.is_after_rule_of_index()
            || after_marker(last, b"***").is_some() && strip(next, &[b'*'; 15]).is_some()
    }

    fn file(&mut self) -> Result<FilePatch, ParseError> {
        let mut file = FilePatch::default();
        let mut has_diff_header = false;
        while let Some(line) = self.peek()
            && !self.is_at_file_header()
            && !is_hunk_header(line)
        {
            // `svn diff --git` writes `Index:`, the rule and `diff --git`.
            let is_svn_git = strip(line, GIT_HEADER).is_some() && self.is_after_rule_of_index();
            if is_diff_header(line) && core::mem::replace(&mut has_diff_header, true) && !is_svn_git
            {
                return Ok(file);
            }
            if file.is_git {
                file.read_git_extended_header(line);
            } else if let Some(names) = strip(line, GIT_HEADER) {
                file.is_git = true;
                (file.old_file_name, file.new_file_name) = git_header_names(names).unzip();
            } else if let Some(name) = index_name(line) {
                file.index = Some(widen(trim(name)));
            }
            self.advance();
        }

        for _ in 0..2 {
            if let Some(line) = self.peek().filter(|line| is_file_header(line)) {
                file.read_file_header(line);
                self.advance();
            }
        }
        match (&mut file.old_file_name, &mut file.new_file_name) {
            (Some(name), None) => {
                let (marker, name) = ("+++", core::mem::take(name));
                return Err(ParseError::MissingFileHeader { marker, name });
            }
            (None, Some(name)) => {
                let (marker, name) = ("---", core::mem::take(name));
                return Err(ParseError::MissingFileHeader { marker, name });
            }
            _ => {}
        }

        while let Some(line) = self.peek()
            && !is_diff_header(line)
            && !self.is_at_file_header()
            && !is_rule(line)
        {
            if is_hunk_header(line) {
                file.hunks.push(self.hunk(line)?);
            } else {
                // `Only in dir: file` of `diff -r`, `Property changes on:` of `svn diff`, the rest of an email.
                self.advance();
            }
        }
        Ok(file)
    }

    fn hunk(&mut self, header: &[T]) -> Result<PatchHunk<Range<usize>>, ParseError> {
        let at = self.number;
        let mut hunk = hunk_header(header).ok_or(ParseError::InvalidHunkHeader { at })?;
        self.advance();

        let (mut added, mut removed) = (0, 0);
        while let Some(place) = self.line.clone() {
            let line = without_cr(&self.text[place.clone()]);
            if removed >= hunk.old_lines && added >= hunk.new_lines && !is(line.first(), b'\\') {
                break;
            }
            let is_after_last_newline = line.is_empty() && place.end == self.text.len();
            match Operation::of(line).filter(|_| !is_after_last_newline) {
                Some(Operation::Add) => added += 1,
                Some(Operation::Remove) => removed += 1,
                Some(Operation::Keep) => (added, removed) = (added + 1, removed + 1),
                Some(Operation::NoNewline) => {}
                None => {
                    let line = widen(&line[..line.len().min(MAX_QUOTED)]);
                    return Err(ParseError::InvalidLine { at, line });
                }
            }
            hunk.lines.push(place);
            self.advance();
        }

        if added == 0 && hunk.new_lines == 1 {
            hunk.new_lines = 0;
        }
        if removed == 0 && hunk.old_lines == 1 {
            hunk.old_lines = 0;
        }
        if added != hunk.new_lines {
            return Err(ParseError::AddedCount { at });
        }
        if removed != hunk.old_lines {
            return Err(ParseError::RemovedCount { at });
        }
        if let Some(next) = self.peek()
            && next
                .first()
                .is_some_and(|&it| matches!(it.into(), 0x20 | 0x2B | 0x2D))
            && !self.is_at_file_header()
            // The signature that `git format-patch` ends a message with.
            && strip(trim(next), b"--") != Some(&[])
        {
            return Err(ParseError::ExtraLines {
                at,
                old_lines: hunk.old_lines,
                new_lines: hunk.new_lines,
            });
        }
        Ok(hunk)
    }
}

/// At least one file.
pub fn parse<T: Unit>(text: &[T]) -> Result<Vec<FilePatch>, ParseError> {
    let mut parser = Parser {
        text,
        line: Some(Parser::line_from(text, 0)),
        number: 1,
        next_header: NextHeader::default(),
    };
    let mut files = Vec::new();
    while parser.line.is_some() {
        let file = parser.file()?;
        // A rule in the footer of an email starts no file.
        if files.is_empty() || !file.is_empty() {
            files.push(file);
        }
    }
    Ok(files)
}

// ───────────────────────────── apply ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Operation {
    Keep,
    Remove,
    Add,
    NoNewline,
}

impl Operation {
    fn of<T: Unit>(line: &[T]) -> Option<Self> {
        // Mail clients and editors strip the space of an empty line that is kept.
        match line.first().map_or(0x20, |&unit| unit.into()) {
            0x20 => Some(Self::Keep),
            0x2D => Some(Self::Remove),
            0x2B => Some(Self::Add),
            0x5C => Some(Self::NoNewline),
            _ => None,
        }
    }
}

/// `lines[line]` of `hunks[hunk]` starts with none of ` `, `-`, `+` and `\`.
pub struct InvalidOperation {
    pub hunk: usize,
    pub line: usize,
}

pub struct HunkToApply<'a, T> {
    pub old_start: u32,
    pub lines: Vec<&'a [T]>,
}

struct Step<'a, T> {
    operation: Operation,
    text: &'a [T],
    /// The `\r` after `text`.
    cr: Option<T>,
    /// Neither `\ No newline at end of file` nor the line that says it of.
    has_line_ending: bool,
}

impl<T> Step<'_, T> {
    fn len(&self) -> usize {
        self.text.len() + self.cr.as_slice().len()
    }
}

fn steps_of<'a, T: Unit>(lines: &[&'a [T]]) -> Result<Vec<Step<'a, T>>, usize> {
    let is_marker = |at: usize| lines.get(at).is_some_and(|line| is(line.first(), b'\\'));
    let step = |(at, &line): (usize, &&'a [T])| {
        let cr = line.last().copied().filter(|unit| is(Some(unit), b'\r'));
        let line = &line[..line.len() - cr.as_slice().len()];
        // No tool writes `\r` after the marker, so the patch was converted, and this line got one too.
        let is_converted = is_marker(at + 1) && is(lines[at + 1].last(), b'\r');
        Ok(Step {
            operation: Operation::of(line).ok_or(at)?,
            text: line.get(1..).unwrap_or_default(),
            cr: cr.filter(|_| !is_converted),
            has_line_ending: !is_marker(at) && !is_marker(at + 1),
        })
    };
    lines.iter().enumerate().map(step).collect()
}

/// A patch with only `\n` gets `\r\n` for a source with only `\r\n`, and the other way round.
fn convert_line_endings<T: Unit>(source: &[T], hunks: &mut [Vec<Step<'_, T>>]) {
    let terminated = &source[..line_start(source, source.len())];
    let Some((_, terminated)) = terminated.split_last() else {
        return;
    };
    let has_cr = || split(terminated).map(|line| is(line.last(), b'\r'));
    let steps = || hunks.iter().flatten();
    if steps().all(|step| step.cr.is_none() || step.operation == Operation::NoNewline)
        && has_cr().all(|it| it)
    {
        let steps = hunks.iter_mut().flatten();
        steps.for_each(|step| step.cr = step.has_line_ending.then(|| T::from_u8(b'\r')));
    } else if steps().all(|step| step.cr.is_some() || !step.has_line_ending)
        // On a line without a newline it is text.
        && steps().any(|step| {
            step.cr.is_some() && (step.has_line_ending || step.operation == Operation::NoNewline)
        })
        && !has_cr().any(|it| it)
    {
        let steps = hunks.iter_mut().flatten();
        steps.for_each(|step| step.cr = None);
    }
}

/// `text.split("\n")`
fn split<T: Unit>(text: &[T]) -> impl Iterator<Item = &[T]> {
    let mut rest = Some(text);
    core::iter::from_fn(move || {
        let (line, after) = rest?.split_at(Parser::line_from(rest?, 0).end);
        rest = after.get(1..);
        Some(line)
    })
}

/// Where a line of `source.split("\n")` starts, counting a newline after each line, even the last.
#[derive(Clone, Copy, Default)]
struct Place {
    line: usize,
    unit: usize,
}

impl Place {
    /// The next line, if this one has `length` units.
    fn after(self, length: usize) -> Self {
        let (line, unit) = (self.line + 1, self.unit + length + 1);
        Self { line, unit }
    }
}

/// A last newline makes an empty last line. `end` moves by that line if `last_hunk` adds or removes the newline.
/// False if the source does not end as `last_hunk` says.
fn change_last_newline<T: Unit>(
    end: &mut Place,
    has_newline: bool,
    last_hunk: &[Step<'_, T>],
) -> bool {
    let lacks_newline = |side: Operation| {
        let mut pairs = last_hunk.array_windows();
        pairs.any(|[one, next]| one.operation == side && next.operation == Operation::NoNewline)
    };
    match (
        lacks_newline(Operation::Remove),
        lacks_newline(Operation::Add),
    ) {
        (false, false) => return true,
        (true, _) if has_newline => return false,
        (true, true) => {}
        (true, false) => *end = end.after(0),
        (false, true) if has_newline => (end.line, end.unit) = (end.line - 1, end.unit - 1),
        (false, true) => return false,
    }
    true
}

const HASH_BASE: u64 = 0x9E37_79B9_7F4A_7C15;

/// `hash` of some lines, extended by `line` and `cr`. A last `\r` counts the same in either.
fn roll<T: Unit>(hash: u64, line: &[T], cr: Option<T>) -> u64 {
    let text = if cr.is_some() { line } else { without_cr(line) };
    let has_cr = cr.is_some() || text.len() < line.len();
    let line = bun_wyhash::hash_with_seed(has_cr.into(), slice_as_bytes(text));
    hash.wrapping_mul(HASH_BASE).wrapping_add(line)
}

struct Source<'a, T> {
    text: &'a [T],
    end: Place,
    index: OnceCell<Index>,
    /// What is left for trying places, in all hunks together.
    work: Cell<usize>,
}

/// Hunks can be made to each search the whole source, or to have its hash everywhere.
const WORK: usize = 1 << 22;
const WORK_PER_UNIT: usize = 16;

/// Entry `n` is for the first `n` lines.
struct Index {
    /// Trying a place takes one step, however much of the hunk matches there.
    hashes: Vec<u64>,
    /// With their newlines. A JS string has at most `i32::MAX` units.
    lengths: Vec<u32>,
}

impl<'a, T: Unit> Source<'a, T> {
    fn text_from(&self, unit: usize) -> &'a [T] {
        self.text.get(unit..).unwrap_or_default()
    }

    /// The lines from `unit` on, then empty lines forever.
    fn lines(&self, unit: usize) -> impl Iterator<Item = &'a [T]> {
        split(self.text_from(unit)).chain(core::iter::repeat(&[][..]))
    }

    /// Where `line` starts. It is not before `before`.
    fn place(&self, line: usize, before: Place) -> Place {
        if let Some(index) = self.index.get() {
            let unit = index.lengths[line] as usize;
            return Place { line, unit };
        }
        // Counting the newlines of a block is faster than finding each. Only the last block is read line by line.
        let (mut left, mut unit) = (line - before.line, before.unit);
        let mut blocks = self.text_from(unit).chunks(512);
        while left > 0
            && let Some(block) = blocks.next()
            && let newlines = count_newlines(block)
            && newlines < left
        {
            (left, unit) = (left - newlines, unit + block.len());
        }
        let rest = self.lines(unit).take(left);
        let unit = rest.fold(unit, |unit, line| unit + line.len() + 1);
        Place { line, unit }
    }

    /// Appends the units from `from` to `to`. Past the end of the text they are the newlines that [`Place`] counts.
    fn copy(&self, out: &mut Vec<T>, from: Place, to: Place) {
        let (text, length) = (self.text_from(from.unit), to.unit - from.unit);
        let end = out.len() + length;
        out.extend_from_slice(&text[..text.len().min(length)]);
        out.resize(end, T::from_u8(b'\n'));
    }

    /// The place from `first` on, nearest to `wanted`, that has what the hunk keeps and removes.
    fn locate(&self, steps: &[Step<'_, T>], wanted: isize, first: Place) -> Option<Place> {
        let old = || {
            let steps = steps.iter();
            steps.filter(|step| matches!(step.operation, Operation::Keep | Operation::Remove))
        };
        let old_lines = old().count();
        let (min, max) = (first.line, self.end.line.checked_sub(old_lines)?);
        if old_lines == 0 {
            let wanted = usize::try_from(wanted).ok();
            let wanted = wanted.filter(|at| (min..=max).contains(at));
            return wanted.map(|at| self.place(at, first));
        }
        if min > max {
            return None;
        }
        // `fits` would match such a line across two lines of the source.
        if old().any(|step| T::index_of_unit(step.text, T::from_u8(b'\n')).is_some()) {
            return None;
        }
        let fits = |mut at: Place| {
            old().all(|step| {
                let rest = self.text_from(at.unit).strip_prefix(step.text);
                let rest = rest.and_then(|rest| rest.strip_prefix(step.cr.as_slice()));
                at = at.after(step.len());
                rest.is_some_and(|rest| rest.is_empty() || is(rest.first(), b'\n'))
            })
        };
        let nearest = wanted.clamp(min as isize, max as isize) as usize;
        let place = |line: usize| self.place(line, first);
        let at = place(nearest);
        if fits(at) {
            return Some(at);
        }

        let Index { hashes, .. } = self.index.get_or_init(|| {
            let lines = self.lines(0).take(self.end.line);
            let rolled = lines.scan((0, 0), |(hash, length), line| {
                (*hash, *length) = (roll(*hash, line, None), *length + line.len() as u32 + 1);
                Some((*hash, *length))
            });
            let count = self.end.line + 1;
            let mut index = (Vec::with_capacity(count), Vec::with_capacity(count));
            index.extend(core::iter::once((0, 0)).chain(rolled));
            let (hashes, lengths) = index;
            Index { hashes, lengths }
        });
        let hash = old().fold(0, |hash, step| roll(hash, step.text, step.cr));
        let shift = HASH_BASE.wrapping_pow(old_lines as u32);
        let around = (1..=(max - nearest).max(nearest - min)).flat_map(|distance| {
            let later = Some(nearest + distance).filter(|&at| at <= max);
            let earlier = nearest.checked_sub(distance).filter(|&at| at >= min);
            later.into_iter().chain(earlier)
        });
        let units: usize = old().map(|step| step.len() + 1).sum();
        let mut work = self.work.get();
        for at in around {
            if hashes[at + old_lines].wrapping_sub(hashes[at].wrapping_mul(shift)) == hash {
                let at = place(at);
                if fits(at) {
                    self.work.set(work);
                    return Some(at);
                }
                work = work.checked_sub(units)?;
            }
            work = work.checked_sub(1)?;
        }
        None
    }
}

/// `None`: a hunk does not fit.
pub fn apply<T: Unit>(
    source: &[T],
    hunks: &[HunkToApply<'_, T>],
) -> Result<Option<Vec<T>>, InvalidOperation> {
    let mut steps = Vec::with_capacity(hunks.len());
    for (hunk, HunkToApply { lines, .. }) in hunks.iter().enumerate() {
        steps.push(steps_of(lines).map_err(|line| InvalidOperation { hunk, line })?);
    }

    convert_line_endings(source, &mut steps);
    // Without the empty one after the last newline.
    let line_count = Split::Lines.count(source);
    let has_newline = source.is_empty() || is(source.last(), b'\n');
    let mut end = Place {
        line: line_count + usize::from(has_newline),
        unit: source.len() + 1,
    };
    if let Some(last_hunk) = steps.last()
        && !change_last_newline(&mut end, has_newline, last_hunk)
    {
        return Ok(None);
    }

    let units = |operation: Operation| -> usize {
        let steps = steps.iter().flatten();
        let steps = steps.filter(|step| step.operation == operation);
        steps.map(|step| step.len() + 1).sum()
    };
    let growth = units(Operation::Add).saturating_sub(units(Operation::Remove));
    // A hunk may not fit, so no more than twice the source is reserved.
    let mut out = Vec::with_capacity(end.unit + growth.min(source.len()));
    let source = Source {
        text: source,
        end,
        index: OnceCell::new(),
        work: Cell::new(WORK + WORK_PER_UNIT * source.len()),
    };
    // Lines that a hunk keeps after its last change are not copied yet: the next hunk can start among them.
    let mut copied = Place::default();
    let mut offset = 0;
    for (hunk, steps) in hunks.iter().zip(&steps) {
        let declared = hunk.old_start as isize - 1;
        let Some(mut at) = source.locate(steps, declared + offset, copied) else {
            return Ok(None);
        };
        offset = at.line as isize - declared;
        source.copy(&mut out, copied, at);
        copied = at;
        let mut has_last_line = false;
        for step in steps {
            has_last_line |= !step.has_line_ending
                && matches!(step.operation, Operation::Add | Operation::Remove);
            let next = at.after(step.len());
            match step.operation {
                Operation::Keep => at = next,
                Operation::Remove => {
                    source.copy(&mut out, copied, at);
                    (at, copied) = (next, next);
                }
                Operation::Add => {
                    source.copy(&mut out, copied, at);
                    copied = at;
                    out.extend_from_slice(step.text);
                    out.extend(step.cr);
                    out.push(T::from_u8(b'\n'));
                }
                Operation::NoNewline => {}
            }
        }
        if copied.line > line_count || (has_last_line && at.line < line_count) {
            return Ok(None);
        }
    }
    source.copy(&mut out, copied, end);
    out.pop();
    // Half of a line ending, unless a line without a newline had it.
    if is(out.last(), b'\r') && !is(source.text.last(), b'\r') {
        let mut steps = steps.iter().flatten();
        let last_added = steps.rfind(|step| step.operation == Operation::Add);
        if last_added.is_none_or(|step| step.has_line_ending) {
            return Ok(None);
        }
    }
    Ok(Some(out))
}
