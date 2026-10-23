//! Reads the reports that src/jsc/bindings/LintReport.cpp writes.
//!
//! All numbers are little-endian. A number that comes from a rule is an `f64`, or NaN if the rule passed something
//! else. A string is its byte length as a `u32`, then UTF-8 in which an unpaired surrogate takes three bytes.
//!
//! - A report: `u32` rule, `u32` flags, `f64` line, column, endLine and endColumn, `u32` number of suggestions, the message, the
//!   `messageId` if [`HAS_ID`], the fix if [`HAS_FIX`], the suggestions.
//! - A fix: `f64` start and end, the text.
//! - A suggestion: `u32` flags, `desc`, the `messageId` if [`HAS_ID`], `data` as JSON if [`HAS_DATA`], the fix.

use super::host::{Report, Suggested};
use crate::fix::Fix;
use crate::span::Span;
use bun_core::strings::Utf16OffsetTable;

const HAS_ID: u32 = 1;
const HAS_FIX: u32 = 2;
const HAS_DATA: u32 = 4;

/// The bytes left to read.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let (taken, rest) = self.0.split_at_checked(len)?;
        self.0 = rest;
        Some(taken)
    }

    fn word(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn number(&mut self) -> Option<f64> {
        Some(f64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        let len = self.word()?;
        self.take(len as usize)
    }

    /// `Some(None)` means it isn't valid UTF-8.
    fn name(&mut self) -> Option<Option<Box<str>>> {
        Some(std::str::from_utf8(self.string()?).ok().map(Into::into))
    }

    /// `Some(None)` means its range isn't two numbers.
    fn fix(&mut self, offsets: &Utf16OffsetTable) -> Option<Option<Fix>> {
        let (start, end, text) = (self.number()?, self.number()?, self.string()?);
        // The byte order mark is at -1.
        let at = |it: f64| match it < 0.0 {
            true => Some(0),
            false => Some(offsets.to_bytes(finite_index(it)?)),
        };
        Some(at(start).zip(at(end)).map(|(start, end)| Fix {
            span: Span::new(start, end),
            text: text.to_vec(),
        }))
    }

    /// `Some(None)` means it has no valid fix.
    fn suggestion(&mut self, offsets: &Utf16OffsetTable) -> Option<Option<Suggested>> {
        let flags = self.word()?;
        let message = self.string()?.to_vec();
        let message_id = match flags & HAS_ID {
            0 => None,
            _ => self.name()?,
        };
        let data = match flags & HAS_DATA {
            0 => None,
            _ => Some(self.string()?.to_vec()),
        };
        Some(self.fix(offsets)?.map(|fix| Suggested {
            message_id,
            message,
            data,
            fix,
        }))
    }

    fn report(&mut self, offsets: &Utf16OffsetTable) -> Option<Report> {
        let (rule, flags) = (self.word()?, self.word()?);
        let (line, column) = (self.number()?, self.number()?);
        let end = (self.number()?, self.number()?);
        let suggestions = self.word()?;
        let message = self.string()?.to_vec();
        let message_id = match flags & HAS_ID {
            0 => None,
            _ => self.name()?,
        };
        let fix = match flags & HAS_FIX {
            0 => None,
            _ => self.fix(offsets)?,
        };
        let mut suggested = Vec::new();
        for _ in 0..suggestions {
            suggested.extend(self.suggestion(offsets)?);
        }
        Some(Report {
            rule,
            message,
            message_id,
            line: line_or_column(line),
            column: line_or_column(column),
            end: line_or_column(end.0).zip(line_or_column(end.1)),
            fix,
            suggestions: suggested,
        })
    }
}

/// An index. `None` for NaN and infinities, which JSON can't represent either.
fn finite_index(number: f64) -> Option<u32> {
    number.is_finite().then_some(number as u32)
}

/// A line or a column. ESLint passes negative ones through, so they're stored as an `i32` in the `u32`. See
/// [`LintMessage::line`](crate::linter::LintMessage::line).
fn line_or_column(number: f64) -> Option<u32> {
    number.is_finite().then_some(number as i32 as u32)
}

/// Appends the reports in `bytes` to `reports`.
pub(super) fn read(bytes: &[u8], offsets: &Utf16OffsetTable, reports: &mut Vec<Report>) {
    let mut reader = Reader(bytes);
    while !reader.0.is_empty() {
        match reader.report(offsets) {
            Some(report) => reports.push(report),
            None => break,
        }
    }
}
