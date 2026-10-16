//! Reads the reports that src/jsc/bindings/LintReport.cpp writes.
//!
//! All numbers are little-endian. A number that a rule gave is an `f64`, and NaN if it gave something else. A string is its length
//! in bytes as a `u32`, then UTF-8, in which an unpaired surrogate has three bytes.
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

/// What is left to read.
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

    /// `None` in `Some`: it isn't valid UTF-8.
    fn name(&mut self) -> Option<Option<Box<str>>> {
        Some(std::str::from_utf8(self.string()?).ok().map(Into::into))
    }

    /// `None` in `Some`: its range isn't made of numbers.
    fn fix(&mut self, offsets: &Utf16OffsetTable) -> Option<Option<Fix>> {
        let (start, end, text) = (self.number()?, self.number()?, self.string()?);
        // The byte order mark is at -1.
        let at = |it: f64| match it < 0.0 {
            true => Some(0),
            false => Some(offsets.to_bytes(whole(it)?)),
        };
        Some(at(start).zip(at(end)).map(|(start, end)| Fix {
            span: Span::new(start, end),
            text: text.to_vec(),
        }))
    }

    /// `None` in `Some`: its fix is none.
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
            line: whole(line),
            column: whole(column),
            end: whole(end.0).zip(whole(end.1)),
            fix,
            suggestions: suggested,
        })
    }
}

/// A line, a column or an index. `None`: NaN or infinite, which JSON doesn't have either.
fn whole(number: f64) -> Option<u32> {
    match number {
        _ if !number.is_finite() => None,
        // A column of -1, which ESLint has, is `u32::MAX`.
        _ if number < 0.0 => Some((number as i64) as u32),
        _ => Some(number as u32),
    }
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
