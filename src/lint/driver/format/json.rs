//! ESLint's `json` and `json-with-metadata` formatters.

use super::Meta;
use crate::results::FileResult;
use bun_core::printer::json_stringify;
use bun_lint::linter::{LintMessage, Utf16Offsets};
use bun_threading::Guarded;
use std::io::Write;

fn write_messages(out: &mut Vec<u8>, messages: &[LintMessage], text: &[u8]) {
    let mut offsets = Utf16Offsets::new(text);
    out.push(b'[');
    for (i, message) in messages.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        message.write_json(out, &mut offsets);
    }
    out.push(b']');
}

fn write_result(out: &mut Vec<u8>, result: &FileResult) {
    out.extend_from_slice(b"{\"filePath\":");
    json_stringify(&result.path, out);
    let counts = result.counts;
    match &result.linted {
        None => {
            out.extend_from_slice(b",\"messages\":[");
            for message in &result.messages {
                out.extend_from_slice(
                    b"{\"ruleId\":null,\"fatal\":false,\"severity\":1,\"message\":",
                );
                json_stringify(&message.message, out);
                out.push(b'}');
            }
            let _ = write!(
                out,
                "],\"suppressedMessages\":[],\"errorCount\":{},\"warningCount\":{},\"fatalErrorCount\":{},\"fixableErrorCount\":{},\"fixableWarningCount\":{}",
                counts.errors,
                counts.warnings,
                counts.fatal_errors,
                counts.fixable_errors,
                counts.fixable_warnings
            );
        }
        Some(linted) => {
            let text = result.text.as_deref().unwrap_or_default();
            out.extend_from_slice(b",\"messages\":");
            write_messages(out, &result.messages, text);
            out.extend_from_slice(b",\"suppressedMessages\":");
            write_messages(out, &result.suppressed, text);
            let _ = write!(
                out,
                ",\"errorCount\":{},\"fatalErrorCount\":{},\"warningCount\":{},\"fixableErrorCount\":{},\"fixableWarningCount\":{}",
                counts.errors,
                counts.fatal_errors,
                counts.warnings,
                counts.fixable_errors,
                counts.fixable_warnings
            );
            if result.is_fixed {
                out.extend_from_slice(b",\"output\":");
                json_stringify(text, out);
            } else if linted.has_source {
                out.extend_from_slice(b",\"source\":");
                json_stringify(text, out);
            }
        }
    }
    out.extend_from_slice(b",\"usedDeprecatedRules\":");
    match &result.deprecated {
        Some(deprecated) => out.extend_from_slice(deprecated),
        None => crate::deprecated::write_used(out, result.linted.as_ref().map(|it| &*it.config)),
    }
    out.push(b'}');
}

pub(super) fn write_results(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    // The text of every file with a problem is in it: on all threads.
    let mut pieces: Guarded<Vec<Vec<u8>>> =
        Guarded::new(results.iter().map(|_| Vec::new()).collect());
    meta.pool.for_each(results.len(), 8, &|index| {
        let mut piece = Vec::new();
        write_result(&mut piece, &results[index]);
        pieces.lock()[index] = piece;
    });
    let pieces = pieces.get_mut();
    out.reserve(pieces.iter().map(|it| it.len() + 1).sum::<usize>() + 2);
    out.push(b'[');
    for (i, piece) in pieces.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.extend_from_slice(piece);
    }
    out.push(b']');
}

/// `rulesMeta` has what is known here of the `meta` of each rule that is reported.
pub(super) fn write_with_metadata(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    out.extend_from_slice(b"{\"results\":");
    write_results(out, results, meta);
    out.extend_from_slice(b",\"metadata\":{");
    if let Some(color) = meta.color_option {
        let _ = write!(out, "\"color\":{color},");
    }
    if let Some((max, found)) = meta.max_warnings_exceeded {
        let _ = write!(
            out,
            "\"maxWarningsExceeded\":{{\"maxWarnings\":{max},\"foundWarnings\":{found}}},"
        );
    }
    out.extend_from_slice(b"\"cwd\":");
    json_stringify(&crate::paths::to_native(meta.cwd.to_vec()), out);
    out.extend_from_slice(b",\"rulesMeta\":{");
    let mut seen: Vec<Vec<u8>> = Vec::new();
    for message in results
        .iter()
        .flat_map(|it| it.messages.iter().chain(&it.suppressed))
    {
        use bun_lint::linter::RuleId;
        let Some(id @ (RuleId::Known(rule) | RuleId::Named(rule, _))) = &message.rule_id else {
            continue;
        };
        let id = id.to_vec();
        if seen.contains(&id) {
            continue;
        }
        if !seen.is_empty() {
            out.push(b',');
        }
        json_stringify(&id, out);
        let kind = match rule.kind {
            bun_lint::rule::Kind::Problem => "problem",
            bun_lint::rule::Kind::Suggestion => "suggestion",
            bun_lint::rule::Kind::Layout => "layout",
        };
        let _ = write!(out, ":{{\"type\":\"{kind}\"");
        match rule.fixable {
            bun_lint::rule::Fixable::No => {}
            bun_lint::rule::Fixable::Code => out.extend_from_slice(b",\"fixable\":\"code\""),
            bun_lint::rule::Fixable::Whitespace => {
                out.extend_from_slice(b",\"fixable\":\"whitespace\"")
            }
        }
        if rule.has_suggestions {
            out.extend_from_slice(b",\"hasSuggestions\":true");
        }
        if rule.is_deprecated {
            out.extend_from_slice(b",\"deprecated\":true");
        }
        out.push(b'}');
        seen.push(id);
    }
    out.extend_from_slice(b"}}}");
}
