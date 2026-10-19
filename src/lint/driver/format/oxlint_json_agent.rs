//! `json` and `agent` with an oxlint config. The output matches oxlint's byte for byte, except for the message texts.
//! Only rules whose wording matches oxlint's have a `help`, a `note` and label texts.

use super::Meta;
use super::info::{Position, Source};
use super::oxlint::{code, docs_page, is_error};
use crate::results::FileResult;
use bun_core::printer::json_stringify;
use bun_core::strings;
use bun_lint::linter::{LintMessage, RuleId};
use std::io::Write;

/// Returns oxlint's docs page for the rule. A JavaScript plugin's rule has none.
fn url(message: &LintMessage) -> Option<Vec<u8>> {
    let Some(RuleId::Known(rule)) = &message.rule_id else {
        return None;
    };
    docs_page(rule.plugin, rule.name.as_bytes())
}

/// Writes a span that oxlint labels, from byte `start` to byte `end`, with the label's text. There's no end line or end
/// column.
fn write_label(out: &mut Vec<u8>, source: &Source, (start, end): (usize, usize), text: &str) {
    out.push(b'{');
    if !text.is_empty() {
        out.extend_from_slice(b"\"label\": ");
        json_stringify(text.as_bytes(), out);
        out.push(b',');
    }
    let length = end.saturating_sub(start);
    let Position { line, column } = source.position(start);
    let _ = write!(
        out,
        "\"span\": {{\"offset\": {start},\"length\": {length},\"line\": {line},\"column\": {column}}}}}"
    );
}

/// `JSONReportHandler::render_report`
fn write_diagnostic(out: &mut Vec<u8>, source: &Source, message: &LintMessage) {
    out.extend_from_slice(b"{\"message\": ");
    json_stringify(&message.message, out);
    if let Some(code) = code(message) {
        out.extend_from_slice(b",\"code\": ");
        json_stringify(&code, out);
    }
    out.extend_from_slice(if is_error(message) {
        b",\"severity\": \"error\""
    } else {
        b",\"severity\": \"warning\""
    });
    if let Some(url) = url(message) {
        out.extend_from_slice(b",\"url\": ");
        json_stringify(&url, out);
    }
    let details = message.details.as_deref();
    for (key, text) in [("help", message.help()), ("note", message.note())] {
        if !text.is_empty() {
            let _ = write!(out, ",\"{key}\": ");
            json_stringify(text.as_bytes(), out);
        }
    }
    if source.is_about_a_file {
        out.extend_from_slice(b",\"filename\": ");
        json_stringify(&source.name, out);
    }
    out.extend_from_slice(b",\"labels\": [");
    if let Some(first) = source.span(message) {
        write_label(out, source, first, message.first_label());
        for (start, end, text) in details.into_iter().flat_map(|it| &it.labels) {
            out.push(b',');
            write_label(out, source, source.label(*start, *end), text);
        }
    }
    out.extend_from_slice(b"]}");
}

/// `lint_command_info` of oxlint's `JsonOutputFormatter`. It ends with spaces, not with a newline.
pub(super) fn write_json(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    out.extend_from_slice(b"{ \"diagnostics\": [");
    let mut is_first = true;
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        for message in &result.messages {
            if !std::mem::replace(&mut is_first, false) {
                out.extend_from_slice(b",\n");
            }
            write_diagnostic(out, &source, message);
        }
    }
    let run = &meta.run;
    let rules = run
        .rules
        .map_or_else(|| "null".to_owned(), |it| it.to_string());
    let _ = write!(
        out,
        "],\n              \"number_of_files\": {},\n              \"number_of_rules\": {rules},\n              \"threads_count\": {},\n              \"start_time\": {}\n            }}\n            ",
        run.files, run.threads, run.seconds,
    );
}

/// `compact_message`: the words from `str::split_whitespace`, joined with single spaces.
fn write_compact(out: &mut Vec<u8>, text: &[u8]) {
    // Most texts are already in that form.
    let is_plain = strings::index_of_needs_escape_for_java_script_string(text, b'"').is_none();
    let has_more_blanks =
        strings::contains(text, b"  ") || text.starts_with(b" ") || text.ends_with(b" ");
    if is_plain && !has_more_blanks {
        out.extend_from_slice(text);
        return;
    }
    let start = out.len();
    let mut is_after_blank = false;
    let mut push_part = |out: &mut Vec<u8>, part: &str| {
        if part.starts_with(char::is_whitespace) {
            is_after_blank = true;
            return;
        }
        if std::mem::take(&mut is_after_blank) && out.len() > start {
            out.push(b' ');
        }
        out.extend_from_slice(part.as_bytes());
    };
    for chunk in text.utf8_chunks() {
        let mut rest = chunk.valid();
        // Take a run of ASCII word characters in one step, and any other character by itself.
        while let Some(first) = rest.chars().next() {
            let len = rest.bytes().take_while(u8::is_ascii_graphic).count();
            let Some((part, after)) = rest.split_at_checked(len.max(first.len_utf8())) else {
                break;
            };
            push_part(out, part);
            rest = after;
        }
        if !chunk.invalid().is_empty() {
            push_part(out, "\u{FFFD}");
        }
    }
}

/// Writes one line per problem and nothing else. Here a problem without a location keeps its file name and severity.
pub(super) fn write_agent(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let source = Source::new(result, meta);
        for message in &result.messages {
            out.extend_from_slice(&source.name);
            if let Some((start, _)) = source.span(message) {
                let Position { line, column } = source.position(start);
                let _ = write!(out, ":{line}:{column}");
            }
            out.extend_from_slice(if is_error(message) {
                b": error"
            } else {
                b": warning"
            });
            if let Some(code) = code(message) {
                out.push(b' ');
                out.extend_from_slice(&code);
            }
            out.extend_from_slice(b": ");
            write_compact(out, &message.message);
            let help = message.help();
            if !help.is_empty() {
                out.extend_from_slice(b" help: ");
                write_compact(out, help.as_bytes());
            }
            out.push(b'\n');
        }
    }
}
