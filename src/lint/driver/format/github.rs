//! What oxlint calls `github`: a workflow command of GitHub Actions for each problem, then the two lines that its `default` ends
//! with.

use super::Meta;
use super::info::Source;
use super::oxlint::is_error;
use super::stylish::plural;
use crate::results::FileResult;
use std::io::Write;

/// `escape_data`, and with `is_property` `escape_property`. Nothing else is taken out, as the escape sequences of a terminal are
/// by `bun_core::fmt::github_action`.
fn write_escaped(out: &mut Vec<u8>, text: &[u8], is_property: bool) {
    for byte in text {
        match byte {
            b'%' => out.extend_from_slice(b"%25"),
            b'\r' => out.extend_from_slice(b"%0D"),
            b'\n' => out.extend_from_slice(b"%0A"),
            b':' if is_property => out.extend_from_slice(b"%3A"),
            b',' if is_property => out.extend_from_slice(b"%2C"),
            byte => out.push(*byte),
        }
    }
}

fn severity(is_error: bool) -> &'static [u8] {
    if is_error { b"::error" } else { b"::warning" }
}

/// `get_diagnostic_result_output`
fn write_found(out: &mut Vec<u8>, meta: &Meta) {
    let (warnings, errors) = (meta.found.warnings, meta.found.errors);
    if warnings + errors > 0 {
        out.push(b'\n');
    }
    let _ = writeln!(
        out,
        "Found {warnings} warning{} and {errors} error{}.",
        plural(warnings),
        plural(errors),
    );
    if let Some((_, found)) = meta.max_warnings_exceeded {
        let _ = writeln!(out, "Exceeded maximum number of warnings. Found {found}.");
    }
}

/// `LintCommandInfo::format_execution_summary`
fn write_finished(out: &mut Vec<u8>, meta: &Meta) {
    match meta.updated_suppressions {
        Some(false) => {
            out.extend_from_slice(b"Created 'oxlint-suppressions.json' in the root folder.\n");
        }
        Some(true) => out.extend_from_slice(b"Updated 'oxlint-suppressions.json'.\n"),
        None => {}
    }
    let run = &meta.run;
    let milliseconds = (run.seconds * 1000.0) as u64;
    let _ = if milliseconds < 1000 {
        write!(out, "Finished in {milliseconds}ms")
    } else {
        write!(out, "Finished in {:.1}s", run.seconds)
    };
    let _ = write!(out, " on {} file{}", run.files, plural(run.files));
    if let Some(rules) = run.rules {
        let _ = write!(out, " with {rules} rules");
    }
    let _ = writeln!(out, " using {} threads.", run.threads);
}

/// With the end of the last line. It is never empty.
pub(super) fn write(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        for message in &result.messages {
            let info = source.info(message);
            let title = info.code.as_deref().unwrap_or(b"oxlint");
            if info.filename.is_empty() {
                out.extend_from_slice(severity(is_error(message)));
                out.extend_from_slice(b" title=");
                write_escaped(out, title, true);
                out.extend_from_slice(b"::");
                write_escaped(out, &message.message, false);
                out.push(b'\n');
                continue;
            }
            let (start, end) = (info.start, info.end);
            out.extend_from_slice(severity(info.is_error));
            out.extend_from_slice(b" file=");
            write_escaped(out, info.filename, true);
            let _ = write!(
                out,
                ",line={},endLine={},col={},endColumn={},title=",
                start.line, end.line, start.column, end.column,
            );
            // oxlint prints the name of a rule as it is. One of a plugin could end the command with it.
            write_escaped(out, title, true);
            out.extend_from_slice(b"::");
            write_escaped(out, info.filename, false);
            let _ = write!(out, ":{}:{}: ", start.line, start.column);
            write_escaped(out, info.message, false);
            out.push(b'\n');
        }
    }
    // Without a file to lint oxlint has nothing that counts.
    if meta.run.files > 0 {
        write_found(out, meta);
    }
    write_finished(out, meta);
}
