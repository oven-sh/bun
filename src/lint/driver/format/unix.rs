//! `eslint-formatter-unix`, and oxlint's `unix`.

use super::Meta;
use super::info::Source;
use super::oxlint::{code, is_error};
use crate::results::FileResult;
use bun_core::fmt::{ItoaBuf, itoa};
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, RuleId};
use bun_sema::util::FxHashMap;
use std::io::Write;

/// `:1:2: `
fn write_position(out: &mut Vec<u8>, line: i64, column: i64) {
    out.push(b':');
    out.extend_from_slice(itoa(&mut ItoaBuf::new(), line));
    out.push(b':');
    out.extend_from_slice(itoa(&mut ItoaBuf::new(), column));
    out.extend_from_slice(b": ");
}

pub(super) fn write(out: &mut Vec<u8>, results: &[FileResult]) {
    let mut total = 0;
    for result in results {
        total += result.messages.len();
        for message in &result.messages {
            out.extend_from_slice(&result.path);
            let (line, column) = (message.line as i32, message.column as i32);
            write_position(out, line.into(), column.into());
            out.extend_from_slice(&message.message);
            let is_error = message.is_fatal || message.severity == Severity::Error;
            match is_error {
                true => out.extend_from_slice(b" [Error"),
                false => out.extend_from_slice(b" [Warning"),
            }
            if let Some(id) = &message.rule_id {
                out.push(b'/');
                id.write_to(out);
            }
            out.extend_from_slice(b"]\n");
        }
    }
    if total > 0 {
        let _ = write!(
            out,
            "\n{total} problem{}",
            if total == 1 { "" } else { "s" }
        );
    }
}

/// Writes ` [Warning/eslint(no-debugger)]` and the newline.
fn write_end(out: &mut Vec<u8>, message: &LintMessage) {
    out.extend_from_slice(match is_error(message) {
        true => b" [Error",
        false => b" [Warning",
    });
    if let Some(code) = code(message) {
        out.push(b'/');
        out.extend_from_slice(&code);
    }
    out.extend_from_slice(b"]\n");
}

/// Caches [`write_end`]'s output per built-in rule and severity.
#[derive(Default)]
struct Ends {
    /// All the cached outputs, concatenated.
    text: Vec<u8>,
    /// Keyed by the address of the rule's `Meta`, plus 1 for an error. The value is the output's start and end in
    /// `text`.
    ranges: FxHashMap<usize, (u32, u32)>,
}

impl Ends {
    fn write(&mut self, out: &mut Vec<u8>, message: &LintMessage) {
        let Some(RuleId::Known(meta)) = &message.rule_id else {
            return write_end(out, message);
        };
        let key = std::ptr::from_ref(*meta).addr() + usize::from(is_error(message));
        let (start, end) = match self.ranges.get(&key) {
            Some(range) => *range,
            None => {
                let start = self.text.len() as u32;
                write_end(&mut self.text, message);
                let range = (start, self.text.len() as u32);
                self.ranges.insert(key, range);
                range
            }
        };
        out.extend_from_slice(
            self.text
                .get(start as usize..end as usize)
                .unwrap_or_default(),
        );
    }
}

/// Includes the final newline.
pub(super) fn write_as_oxlint(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let (mut total, mut ends) = (0, Ends::default());
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        total += result.messages.len();
        for message in &result.messages {
            let start = source.start(message);
            out.extend_from_slice(&source.name);
            write_position(out, start.line as i64, start.column as i64);
            out.extend_from_slice(&message.message);
            ends.write(out, message);
        }
    }
    if total > 0 {
        let _ = writeln!(
            out,
            "\n{total} problem{}",
            if total == 1 { "" } else { "s" }
        );
    }
}
