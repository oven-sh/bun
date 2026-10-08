//! `eslint-formatter-unix`

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
