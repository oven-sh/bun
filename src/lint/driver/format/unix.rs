//! `eslint-formatter-unix`, and what oxlint calls `unix`.

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
fn write_place(out: &mut Vec<u8>, line: usize, column: usize) {
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
            write_place(out, message.line as usize, message.column as usize);
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

/// ` [Warning/eslint(no-debugger)]` and the end of the line
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

/// [`write_end`], made once for each rule that is built in and for errors and warnings.
#[derive(Default)]
struct Ends {
    /// One after the other.
    text: Vec<u8>,
    /// By where the rule is, plus 1 for an error: from where to where its end is in `text`.
    places: FxHashMap<usize, (u32, u32)>,
}

impl Ends {
    fn write(&mut self, out: &mut Vec<u8>, message: &LintMessage) {
        let Some(RuleId::Known(meta)) = &message.rule_id else {
            return write_end(out, message);
        };
        let key = std::ptr::from_ref(*meta).addr() + usize::from(is_error(message));
        let (start, end) = match self.places.get(&key) {
            Some(place) => *place,
            None => {
                let start = self.text.len() as u32;
                write_end(&mut self.text, message);
                let place = (start, self.text.len() as u32);
                self.places.insert(key, place);
                place
            }
        };
        out.extend_from_slice(
            self.text
                .get(start as usize..end as usize)
                .unwrap_or_default(),
        );
    }
}

/// With the end of the last line.
pub(super) fn write_as_oxlint(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let (mut total, mut ends) = (0, Ends::default());
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        total += result.messages.len();
        for message in &result.messages {
            let start = source.start(message);
            out.extend_from_slice(&source.name);
            write_place(out, start.line, start.column);
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
