//! `eslint-formatter-unix`, and what oxlint calls `unix`.

use super::Meta;
use super::info::Source;
use crate::results::FileResult;
use bun_lint::context::Severity;
use std::io::Write;

pub(super) fn write(out: &mut Vec<u8>, results: &[FileResult]) {
    let mut total = 0;
    for result in results {
        total += result.messages.len();
        for message in &result.messages {
            out.extend_from_slice(&result.path);
            let _ = write!(out, ":{}:{}: ", message.line, message.column);
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
    let mut total = 0;
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        total += result.messages.len();
        for message in &result.messages {
            let info = source.info(message);
            out.extend_from_slice(info.filename);
            let _ = write!(out, ":{}:{}: ", info.start.line, info.start.column);
            out.extend_from_slice(info.message);
            out.extend_from_slice(if info.is_error {
                b" [Error"
            } else {
                b" [Warning"
            });
            if let Some(code) = &info.code {
                out.push(b'/');
                out.extend_from_slice(code);
            }
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
