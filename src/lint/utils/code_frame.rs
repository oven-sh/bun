//! `codeFrameColumns` of @babel/code-frame, without colors: the lines around a range, each after its number, and a row of `^`
//! under each line of the range.
//!
//! ```text
//!   1 | function Component() {
//! > 2 |   const Foo = () => {
//!     |               ^^^^^^^
//! > 3 |   };
//!     | ^^^^ The component is created here
//!   4 |   return <Foo />;
//! ```
//!
//! Byte for byte, so with what one would not write again:
//! - A number is moved to the right by one blank at most: in a frame that ends at line 100, line 8 is ` 8`.
//! - A line without text has no blank after its `|`.
//! - In a row of `^`, a tab of the line stays a tab, and a character outside the BMP is two blanks.
//! - Where there would be no `^`, there is one.
//! - The message is after the `^` of the last line of the range. Without a column it is a row of its own, above the frame.
//! - Lines of any length are printed whole.

use crate::ast::File;
use crate::source::utf16_len;
use std::io::Write;
use std::ops::Range;

/// The major version of @babel/code-frame.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Version {
    /// Columns are counted from 1, and 0 is as good as none. In a range of several lines, the last has as many `^` as its column
    /// says, which is one more than the characters before it, and all between the first and the last have as many as the second
    /// is long.
    Seven,
    /// Columns are counted from 0.
    Eight,
}

/// `{ line, column }`: a line counted from 1, and a column in UTF-16 code units.
#[derive(Copy, Clone, Debug)]
pub struct Place {
    pub line: u32,
    pub column: Option<u32>,
}

/// The arguments of `codeFrameColumns` but for the text.
pub struct Frame<'m> {
    pub version: Version,
    pub start: Place,
    /// Without one, or without a column, it has that of `start`.
    pub end: Option<Place>,
    /// Empty for none.
    pub message: &'m [u8],
    /// 2 unless the caller of `codeFrameColumns` says otherwise.
    pub lines_above: u32,
    /// 3 likewise.
    pub lines_below: u32,
}

/// `text.split(/\r\n|[\n\r\u2028\u2029]/)`
pub trait Lines<'a> {
    fn count(&self) -> u32;
    /// A line, counted from 1. Empty if there is none.
    fn line(&self, number: u32) -> &'a [u8];
}

/// Without the byte order mark, as ESLint's `sourceCode.text` is.
impl<'a> Lines<'a> for File<'a> {
    fn count(&self) -> u32 {
        self.line_count()
    }

    fn line(&self, number: u32) -> &'a [u8] {
        self.line_text(number)
    }
}

/// What [`lines`](super::text::lines) gives.
impl<'a> Lines<'a> for [&'a [u8]] {
    fn count(&self) -> u32 {
        self.len() as u32
    }

    fn line(&self, number: u32) -> &'a [u8] {
        let line = (number as usize).checked_sub(1).and_then(|at| self.get(at));
        line.copied().unwrap_or_default()
    }
}

/// V8 has no longer string: `"^".repeat(..)` throws.
const LONGEST_STRING: u64 = 0x1FFF_FFE8;

/// Appends the frame, which does not end with a line break. `false`, and nothing is appended, where `codeFrameColumns` throws:
/// the range ends before it starts in a line, starts behind the end of its line or in no line and goes on in another, or has
/// lines in the middle that the text does not have.
pub fn write<'a>(out: &mut Vec<u8>, lines: &(impl Lines<'a> + ?Sized), frame: &Frame) -> bool {
    write_rows_of(out, lines, frame, &(0..u32::MAX))
}

/// [`write`], but only the rows of the lines in `shown`: for what shows the start and the end of a long range, in time that does
/// not depend on its length.
pub fn write_rows_of<'a>(
    out: &mut Vec<u8>,
    lines: &(impl Lines<'a> + ?Sized),
    frame: &Frame,
    shown: &Range<u32>,
) -> bool {
    let count = u64::from(lines.count());
    let exists = |line: u64| (1..=count).contains(&line);
    let length = |line: u64| u64::from(utf16_len(lines.line(line as u32)));
    let is_seven = frame.version == Version::Seven;
    let end = frame.end.unwrap_or(frame.start);
    let (first, last) = (u64::from(frame.start.line), u64::from(end.line));
    let (start_column, end_column) = (frame.start.column, end.column.or(frame.start.column));
    let from = u64::from(start_column.unwrap_or(0));
    let to = end_column.map_or(from, u64::from);
    let has_column = match frame.version {
        Version::Seven => from != 0 || (first == last && to != 0),
        Version::Eight => start_column.is_some() || (first == last && end_column.is_some()),
    };
    let before = if is_seven {
        from.saturating_sub(1)
    } else {
        from
    };
    // How many `^` the first line has, and each between the first and the last if that is the same for all.
    let (mut on_first, mut between) = (0, None);
    if has_column && first == last {
        if exists(first) && (to < from || to - from > LONGEST_STRING) {
            return false;
        }
        on_first = to.saturating_sub(from);
    } else if has_column && first < last {
        let has_middle = last - first >= 2;
        let looked_at = if is_seven { first + 1 } else { last - 1 };
        if !exists(first) || (has_middle && !exists(looked_at)) {
            return false;
        }
        let Some(rest) = length(first).checked_sub(before) else {
            return false;
        };
        if exists(last) && to > LONGEST_STRING {
            return false;
        }
        on_first = rest;
        between = (is_seven && has_middle).then(|| length(first + 1));
    }

    let top = first.saturating_sub(u64::from(frame.lines_above) + 1) + 1;
    let bottom = count.min(last + u64::from(frame.lines_below));
    let width = bun_core::fmt::digit_count(bottom);
    if !frame.message.is_empty() && start_column.is_none() && u64::from(shown.start) <= top {
        out.resize(out.len() + width + 1, b' ');
        out.extend_from_slice(frame.message);
        out.push(b'\n');
    }
    let top = top.max(u64::from(shown.start));
    for number in top..(bottom + 1).min(u64::from(shown.end)) {
        if number > top {
            out.push(b'\n');
        }
        let text = lines.line(number as u32);
        let is_in_range = (first..=last).contains(&number);
        let digits = bun_core::fmt::digit_count(number);
        let gutter = digits + usize::from(digits < width);
        out.push(if is_in_range { b'>' } else { b' ' });
        let _ = write!(out, " {number:>gutter$} |");
        if !text.is_empty() {
            out.push(b' ');
            out.extend_from_slice(text);
        }
        if !is_in_range || !has_column {
            continue;
        }
        let (blanks, carets) = if number == first {
            (before, on_first)
        } else if number == last {
            (0, to)
        } else {
            (0, between.unwrap_or_else(|| u64::from(utf16_len(text))))
        };
        out.push(b'\n');
        out.resize(out.len() + 2 + gutter, b' ');
        out.extend_from_slice(b" | ");
        write_blanks(out, text, blanks);
        out.resize(out.len() + carets.max(1) as usize, b'^');
        if number == last && !frame.message.is_empty() {
            out.push(b' ');
            out.extend_from_slice(frame.message);
        }
    }
    true
}

/// `line.slice(0, units).replace(/[^\t]/g, " ")`
fn write_blanks(out: &mut Vec<u8>, line: &[u8], units: u64) {
    let (mut at, mut written) = (0, 0);
    while written < units {
        let (c, size) = bun_core::lexer::char_and_size(line, at);
        if size == 0 {
            break;
        }
        out.push(if c == i32::from(b'\t') { b'\t' } else { b' ' });
        if c > 0xFFFF && written + 1 < units {
            out.push(b' ');
        }
        written += if c > 0xFFFF { 2 } else { 1 };
        at += size;
    }
}
