//! What the formats of oxlint print a problem from: `Info` of `oxc_diagnostics`.

use super::Meta;
use super::oxlint::{Offsets, code, is_error};
use crate::paths;
use crate::results::FileResult;
use bun_core::strings;
use bun_lint::linter::{LintMessage, RuleId};
use bun_lint::rule::Plugin;

/// A line, and a column in bytes, both from 1.
#[derive(Copy, Clone, Default)]
pub(super) struct Position {
    pub(super) line: usize,
    pub(super) column: usize,
}

/// Of a problem without a place only `code` and `filename` are known: the positions are 0, the message is empty, and it is
/// a warning.
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
    pub(super) offsets: Offsets<'r>,
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

    /// Where the problem starts and where it ends, in bytes from the start of the file. `None`: it has no place.
    pub(super) fn span(&self, message: &LintMessage) -> Option<(usize, usize)> {
        if message.line == 0 {
            return None;
        }
        // This rule alone points before a byte order mark, where ESLint has no column.
        if matches!(
            &message.rule_id,
            Some(RuleId::Known(rule)) if rule.plugin == Plugin::Eslint && rule.name == "unicode-bom"
        ) {
            return Some((0, 0));
        }
        let start = self.offsets.at(message.line, message.column).0;
        let end = message
            .end
            .map_or(start, |(line, column)| self.offsets.at(line, column).0);
        Some((start, end.max(start)))
    }

    pub(super) fn info<'s>(&'s self, message: &'s LintMessage) -> Info<'s> {
        let code = code(message);
        let Some((start, end)) = self.span(message) else {
            return Info {
                start: Position::default(),
                end: Position::default(),
                filename: &self.name,
                message: b"",
                is_error: false,
                code,
            };
        };
        Info {
            start: self.position(start),
            end: self.position(end),
            filename: &self.name,
            message: &message.message,
            is_error: is_error(message),
            code,
        }
    }
}
