//! What the formats of oxlint print a problem from: `Info` of `oxc_diagnostics`.

use super::Meta;
use super::oxlint::{Offsets, code, is_error};
use crate::paths;
use crate::results::FileResult;
use bun_core::strings;
use bun_lint::linter::{LintMessage, RuleId};

/// A line, and a column in bytes, both from 1.
#[derive(Copy, Clone, Default)]
pub(super) struct Position {
    pub(super) line: usize,
    pub(super) column: usize,
}

/// The positions of a problem without a place are 0. oxlint has no message for it either, and calls it a warning.
pub(super) struct Info<'s> {
    pub(super) start: Position,
    /// After the last byte.
    pub(super) end: Position,
    pub(super) filename: &'s [u8],
    pub(super) message: &'s [u8],
    pub(super) is_error: bool,
    /// `eslint(no-var)`
    pub(super) code: Option<Vec<u8>>,
}

/// A file, for the places in it.
pub(super) struct Source<'r> {
    /// [`Info::filename`]
    pub(super) name: Vec<u8>,
    text: &'r [u8],
    offsets: Offsets<'r>,
    /// Where each line starts. Only `\n`, `\r\n` and `\r` end a line.
    lines: Vec<usize>,
}

impl<'r> Source<'r> {
    pub(super) fn new(result: &'r FileResult, meta: &Meta) -> Source<'r> {
        let path = paths::from_native(&result.path);
        // A file outside of the working directory keeps its absolute path. `\` is replaced on every system.
        let name =
            strings::replace_owned(paths::inside(meta.cwd, &path).unwrap_or(&path), b"\\", b"/");
        let text = result.text.as_deref().unwrap_or_default();
        let mut lines = vec![0];
        let mut at = 0;
        while let Some(found) = strings::index_of_any(&text[at..], b"\r\n") {
            at += found;
            at += 1 + usize::from(text[at..].starts_with(b"\r\n"));
            lines.push(at);
        }
        Source {
            name,
            text,
            offsets: Offsets::new(text),
            lines,
        }
    }

    /// `line_column`
    pub(super) fn position(&self, mut offset: usize) -> Position {
        if let Some(before) = offset.checked_sub(1)
            && matches!(self.text.get(before..=offset), Some(b"\r\n"))
        {
            offset = before;
        }
        let line = self.lines.partition_point(|start| *start <= offset);
        Position {
            line,
            column: offset - self.lines[line - 1] + 1,
        }
    }

    /// Where what goes from the line and column `start` to `end` starts and ends, in bytes from the start of the file.
    fn between(&self, start: (u32, u32), end: (u32, u32)) -> (usize, usize) {
        let start = self.offsets.at(start.0, start.1).0;
        (start, self.offsets.at(end.0, end.1).0.max(start))
    }

    /// The same for a label of a rule that is built in. One at the first character that has no length is about the file:
    /// oxlint has it at 0, before a byte order mark, where ESLint has no column.
    pub(super) fn label(&self, start: (u32, u32), end: (u32, u32)) -> (usize, usize) {
        match (start, end) == ((1, 1), (1, 1)) {
            true => (0, 0),
            false => self.between(start, end),
        }
    }

    /// Where the problem starts and where it ends, in bytes from the start of the file. `None`: it has no place.
    pub(super) fn span(&self, message: &LintMessage) -> Option<(usize, usize)> {
        if message.line == 0 {
            return None;
        }
        let start = (message.line, message.column);
        let end = message.end.unwrap_or(start);
        Some(match message.rule_id {
            Some(RuleId::Known(_)) => self.label(start, end),
            // A plugin in JavaScript does not see the mark: its 0 is after it.
            Some(RuleId::Js(_) | RuleId::Unknown(_)) | None => self.between(start, end),
        })
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
