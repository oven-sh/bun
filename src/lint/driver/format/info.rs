//! `Info` from `oxc_diagnostics`, which oxlint's formats print a problem from.

use super::oxlint::{Offsets, code, is_error};
use super::{Meta, display_position};
use crate::paths;
use crate::results::FileResult;
use bun_core::strings;
use bun_lint::linter::{LintMessage, RuleId};
use bun_lint::rule::Plugin;
use bun_lint::source::LineStarts;

/// A line and a column in bytes, both 1-based.
#[derive(Copy, Clone, Default)]
pub(super) struct Position {
    pub(super) line: usize,
    pub(super) column: usize,
}

/// A problem without a location has positions of 0. oxlint also drops its message and calls it a warning. Here it keeps
/// its message and severity.
pub(super) struct Info<'s> {
    pub(super) start: Position,
    /// Just past the last byte.
    pub(super) end: Position,
    pub(super) filename: &'s [u8],
    pub(super) message: &'s [u8],
    pub(super) is_error: bool,
    /// `eslint(no-var)`
    pub(super) code: Option<Vec<u8>>,
}

/// A file, for converting locations in it.
pub(super) struct Source<'r> {
    /// [`Info::filename`]
    pub(super) name: Vec<u8>,
    /// True if the problems are about a file at all, even one without a name.
    pub(super) is_about_a_file: bool,
    text: &'r [u8],
    offsets: Offsets<'r>,
    /// Line starts where only `\n`, `\r\n` and `\r` end a line. `None` if they're the same as in `offsets`.
    lines: Option<LineStarts>,
    /// [`Meta::is_oxlint`]
    is_oxlint: bool,
}

impl<'r> Source<'r> {
    pub(super) fn new(result: &'r FileResult, meta: &Meta) -> Source<'r> {
        let path = paths::from_native(&result.path);
        // A file outside the working directory keeps its absolute path. `\` is replaced on every system.
        let name =
            strings::replace_owned(paths::inside(meta.cwd, &path).unwrap_or(&path), b"\\", b"/");
        let text = result.text.as_deref().unwrap_or_default();
        let offsets = Offsets::new(text, result.lines());
        // U+2028 and U+2029 start with the same two bytes.
        let has_separator = || {
            let mut rest = text;
            while let Some(at) = strings::index_of(rest, b"\xE2\x80") {
                if matches!(rest.get(at + 2), Some(0xA8 | 0xA9)) {
                    return true;
                }
                rest = &rest[at + 2..];
            }
            false
        };
        let lines = (!offsets.is_ascii && has_separator()).then(|| {
            let mut lines = vec![0];
            let mut at = 0;
            while let Some(found) = strings::index_of_any(&text[at..], b"\r\n") {
                at += found;
                at += 1 + usize::from(text[at..].starts_with(b"\r\n"));
                lines.push(at as u32);
            }
            LineStarts::at(lines)
        });
        Source {
            name,
            is_about_a_file: !result.path.is_empty() || result.text.is_some(),
            text,
            offsets,
            lines,
            is_oxlint: meta.is_oxlint,
        }
    }

    /// `line_column`
    pub(super) fn position(&self, mut offset: usize) -> Position {
        if let Some(before) = offset.checked_sub(1)
            && matches!(self.text.get(before..=offset), Some(b"\r\n"))
        {
            offset = before;
        }
        let lines = self.lines.as_ref().unwrap_or(&self.offsets.lines);
        let (line, start) = lines.line_at(offset as u32);
        Position {
            line: line as usize,
            column: offset - start as usize + 1,
        }
    }

    /// Converts the range from line and column `start` to `end` to byte offsets from the start of the file.
    fn between(&self, start: (u32, u32), end: (u32, u32)) -> (usize, usize) {
        let start = self.offsets.at(start.0, start.1).0;
        (start, self.offsets.at(end.0, end.1).0.max(start))
    }

    /// Same, for a built-in rule's label. An empty label at the first character is about the whole file. oxlint puts it
    /// at 0, before a byte order mark, where ESLint has no column.
    pub(super) fn label(&self, start: (u32, u32), end: (u32, u32)) -> (usize, usize) {
        match (start, end) == ((1, 1), (1, 1)) {
            true => (0, 0),
            false => self.between(start, end),
        }
    }

    /// Returns the problem's start and end as byte offsets from the start of the file. `None` if it has no location.
    pub(super) fn span(&self, message: &LintMessage) -> Option<(usize, usize)> {
        let start = display_position(message, self.is_oxlint);
        if start.0 == 0 {
            return None;
        }
        let end = message.end.unwrap_or(start);
        Some(match message.rule_id {
            // oxlint's rule labels the program, which starts before a byte order mark, and caps the label at 100 bytes.
            Some(RuleId::Known(rule))
                if rule.plugin == Plugin::Unicorn && rule.name == "no-empty-file" =>
            {
                (0, self.between(start, end).1.min(100))
            }
            Some(RuleId::Known(_) | RuleId::Named(..)) => self.label(start, end),
            // A JavaScript plugin doesn't see the mark, so its offset 0 is after it.
            Some(RuleId::Js(_) | RuleId::Unknown(_)) | None => self.between(start, end),
        })
    }

    /// [`Info::start`]
    #[inline]
    pub(super) fn start(&self, message: &LintMessage) -> Position {
        // Fast path. The line is ESLint's and the column comes with the offset, as long as the location is before the
        // end of its line and not in the first line, which may start with a byte order mark. A column can be past the
        // end of its line.
        if message.line as i32 > 1 && self.lines.is_none() {
            let (at, column) = self.offsets.at(message.line, message.column);
            let next_line = self.offsets.lines.start_of(message.line + 1);
            let is_in_line = at < next_line.map_or(usize::MAX, |it| it as usize);
            if is_in_line && self.text.get(at).is_some_and(|it| *it != b'\n') {
                let line = message.line as usize;
                return Position { line, column };
            }
        }
        self.start_by_offset(message)
    }

    #[cold]
    fn start_by_offset(&self, message: &LintMessage) -> Position {
        (self.span(message)).map_or_else(Default::default, |it| self.position(it.0))
    }

    pub(super) fn info<'s>(&'s self, message: &'s LintMessage) -> Info<'s> {
        let (start, end) = self.span(message).map_or_else(Default::default, |it| {
            (self.position(it.0), self.position(it.1))
        });
        Info {
            start,
            end,
            filename: &self.name,
            message: &message.message,
            is_error: is_error(message),
            code: code(message),
        }
    }
}
