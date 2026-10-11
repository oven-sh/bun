//! `eslint-formatter-unix`, and what oxlint calls `unix`.

use super::Meta;
use super::info::Source;
use super::oxlint::{Codes, is_error};
use crate::results::FileResult;
use bun_core::fmt::{ItoaBuf, itoa};
use bun_lint::context::Severity;
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
            out.extend_from_slice(if is_error { b" [Error" } else { b" [Warning" });
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

/// With the end of the last line.
pub(super) fn write_as_oxlint(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let (mut total, mut codes) = (0, Codes::default());
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        total += result.messages.len();
        for message in &result.messages {
            let start = source.start(message);
            out.extend_from_slice(&source.name);
            write_place(out, start.line, start.column);
            out.extend_from_slice(&message.message);
            out.extend_from_slice(match is_error(message) {
                true => b" [Error",
                false => b" [Warning",
            });
            codes.write(out, b"/", message);
            out.extend_from_slice(b"]\n");
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
