//! `codeFrameColumns` of @babel/code-frame 7, without colors. It prints the lines around a range, each after its line
//! number, and a row of `^` under each line of the range.
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
//! The output matches byte for byte, including the quirks:
//! - A line number is padded by at most one space: in a frame that ends at line 100, line 8 is ` 8`.
//! - An empty line has no space after its `|`.
//! - In a row of `^`, a tab in the line stays a tab, and a character outside the BMP becomes two spaces.
//! - A row that would have no `^` gets one.
//! - The message comes after the `^` of the range's last line. Without a column it's on its own row above the frame.
//! - Lines of any length are printed whole.
//! - Columns are 1-based, and 0 means no column. In a range of several lines, the last line gets as many `^` as its
//!   column number, which is one more than the characters before it. Every line between the first and the last gets as
//!   many as the length of the second line.

use crate::ast::File;
use bun_core::strings::utf8_decoded_len_utf16;
use std::io::Write;
use std::ops::Range;

/// `{ line, column }`: a line counted from 1, and a column in UTF-16 code units.
#[derive(Copy, Clone, Debug)]
pub struct LineColumn {
    pub line: u32,
    pub column: Option<u32>,
}

/// The arguments of `codeFrameColumns` except the text.
pub struct Frame<'m> {
    pub start: LineColumn,
    /// If it's `None` or has no column, `start`'s is used.
    pub end: Option<LineColumn>,
    /// Empty means no message.
    pub message: &'m [u8],
    /// `codeFrameColumns` defaults to 2.
    pub lines_above: u32,
    /// `codeFrameColumns` defaults to 3.
    pub lines_below: u32,
}

/// `text.split(/\r\n|[\n\r\u2028\u2029]/)`
pub trait Lines<'a> {
    fn count(&self) -> u32;
    /// A line by its 1-based number. Empty if it doesn't exist.
    fn line(&self, number: u32) -> &'a [u8];
}

/// Without the byte order mark, like ESLint's `sourceCode.text`.
impl<'a> Lines<'a> for File<'a> {
    fn count(&self) -> u32 {
        self.line_count()
    }

    fn line(&self, number: u32) -> &'a [u8] {
        self.line_text(number)
    }
}

/// V8's maximum string length. `"^".repeat(..)` throws above it.
const LONGEST_STRING: u64 = 0x1FFF_FFE8;

/// Appends the frame, which doesn't end with a line break. Returns `false` and appends nothing where `codeFrameColumns`
/// throws: the range ends before it starts on the same line, it spans several lines but starts past the end of its line
/// or on a line that doesn't exist, or it has middle lines that the text doesn't have.
pub fn write<'a>(out: &mut Vec<u8>, lines: &(impl Lines<'a> + ?Sized), frame: &Frame) -> bool {
    write_rows_of(out, lines, frame, &(0..u32::MAX))
}

/// [`write`], but it only prints the rows of the lines in `visible_lines`. That lets a caller show the start and the
/// end of a long range in time that doesn't depend on the range's length.
pub fn write_rows_of<'a>(
    out: &mut Vec<u8>,
    lines: &(impl Lines<'a> + ?Sized),
    frame: &Frame,
    visible_lines: &Range<u32>,
) -> bool {
    let count = u64::from(lines.count());
    let exists = |line: u64| (1..=count).contains(&line);
    let length = |line: u64| u64::from(utf8_decoded_len_utf16(lines.line(line as u32)));
    let end = frame.end.unwrap_or(frame.start);
    let (first, last) = (u64::from(frame.start.line), u64::from(end.line));
    let (start_column, end_column) = (frame.start.column, end.column.or(frame.start.column));
    let from = u64::from(start_column.unwrap_or(0));
    let to = end_column.map_or(from, u64::from);
    let has_column = from != 0 || (first == last && to != 0);
    let before = from.saturating_sub(1);
    // The number of `^` on the first line, and on each line between the first and the last if that's the same for all
    // of them.
    let (mut on_first, mut between) = (0, None);
    if has_column && first == last {
        if exists(first) && (to < from || to - from > LONGEST_STRING) {
            return false;
        }
        on_first = to.saturating_sub(from);
    } else if has_column && first < last {
        let has_middle = last - first >= 2;
        if !exists(first) || (has_middle && !exists(first + 1)) {
            return false;
        }
        let Some(rest) = length(first).checked_sub(before) else {
            return false;
        };
        if exists(last) && to > LONGEST_STRING {
            return false;
        }
        on_first = rest;
        between = has_middle.then(|| length(first + 1));
    }

    let top = first.saturating_sub(u64::from(frame.lines_above) + 1) + 1;
    let bottom = count.min(last + u64::from(frame.lines_below));
    let width = bun_core::fmt::digit_count(bottom);
    if !frame.message.is_empty() && start_column.is_none() && u64::from(visible_lines.start) <= top
    {
        out.resize(out.len() + width + 1, b' ');
        out.extend_from_slice(frame.message);
        out.push(b'\n');
    }
    let top = top.max(u64::from(visible_lines.start));
    for number in top..(bottom + 1).min(u64::from(visible_lines.end)) {
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
        let (padding, carets) = if number == first {
            (before, on_first)
        } else if number == last {
            (0, to)
        } else {
            (
                0,
                between.unwrap_or_else(|| u64::from(utf8_decoded_len_utf16(text))),
            )
        };
        out.push(b'\n');
        out.resize(out.len() + 2 + gutter, b' ');
        out.extend_from_slice(b" | ");
        write_padding(out, text, padding);
        out.resize(out.len() + carets.max(1) as usize, b'^');
        if number == last && !frame.message.is_empty() {
            out.push(b' ');
            out.extend_from_slice(frame.message);
        }
    }
    true
}

/// `line.slice(0, units).replace(/[^\t]/g, " ")`
fn write_padding(out: &mut Vec<u8>, line: &[u8], units: u64) {
    let (mut at, mut units_written) = (0, 0);
    while units_written < units {
        let (c, size) = bun_core::lexer::char_and_size(line, at);
        if size == 0 {
            break;
        }
        out.push(if c == i32::from(b'\t') { b'\t' } else { b' ' });
        if c > 0xFFFF && units_written + 1 < units {
            out.push(b' ');
        }
        units_written += if c > 0xFFFF { 2 } else { 1 };
        at += size;
    }
}
