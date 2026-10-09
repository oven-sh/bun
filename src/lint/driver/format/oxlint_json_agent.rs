//! `json` and `agent` with a configuration of oxlint: the bytes of oxlint, but for the words of the messages. Only the rules that
//! say it as oxlint does have a `help`, a `note` and texts at their labels.

use super::Meta;
use super::info::{Position, Source};
use super::oxlint::{code, is_error, plugin};
use crate::results::FileResult;
use bun_lint::linter::{LintMessage, RuleId, write_json_string};
use std::io::Write;

/// The page of oxlint about the rule. A rule of a plugin in JavaScript has none.
fn url(message: &LintMessage) -> Option<Vec<u8>> {
    let Some(RuleId::Known(rule)) = &message.rule_id else {
        return None;
    };
    Some(
        [
            b"https://oxc.rs/docs/guide/usage/linter/rules/",
            plugin(rule.plugin.prefix().as_bytes()),
            b"/",
            rule.name.as_bytes(),
            b".html",
        ]
        .concat(),
    )
}

/// A place that oxlint marks, from `start` to `end` in bytes, and what it says there. There is no end line and no end column.
fn write_label(out: &mut Vec<u8>, source: &Source, (start, end): (usize, usize), text: &str) {
    out.push(b'{');
    if !text.is_empty() {
        out.extend_from_slice(b"\"label\": ");
        write_json_string(out, text.as_bytes());
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
    write_json_string(out, &message.message);
    if let Some(code) = code(message) {
        out.extend_from_slice(b",\"code\": ");
        write_json_string(out, &code);
    }
    out.extend_from_slice(if is_error(message) {
        b",\"severity\": \"error\""
    } else {
        b",\"severity\": \"warning\""
    });
    if let Some(url) = url(message) {
        out.extend_from_slice(b",\"url\": ");
        write_json_string(out, &url);
    }
    let details = message.details.as_deref();
    let texts = details.map(|it| [("help", &it.help), ("note", &it.note)]);
    for (key, text) in texts.into_iter().flatten() {
        if !text.is_empty() {
            let _ = write!(out, ",\"{key}\": ");
            write_json_string(out, text.as_bytes());
        }
    }
    out.extend_from_slice(b",\"filename\": ");
    write_json_string(out, &source.name);
    out.extend_from_slice(b",\"labels\": [");
    if let Some(first) = source.span(message) {
        let text = details.map_or("", |it| &*it.first_label);
        write_label(out, source, first, text);
        let offset = |(line, column): (u32, u32)| source.offsets.at(line, column).0;
        for (start, end, text) in details.into_iter().flat_map(|it| &it.labels) {
            out.push(b',');
            write_label(out, source, (offset(*start), offset(*end)), text);
        }
    }
    out.extend_from_slice(b"]}");
}

/// `lint_command_info` of oxlint's `JsonOutputFormatter`. It ends with blanks, not with a line break.
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

/// `compact_message`: the words of `str::split_whitespace`, with a blank between them.
fn write_compact(out: &mut Vec<u8>, text: &[u8]) {
    let start = out.len();
    let mut is_after_blank = false;
    let mut put = |out: &mut Vec<u8>, character: char| {
        if character.is_whitespace() {
            is_after_blank = true;
            return;
        }
        if std::mem::take(&mut is_after_blank) && out.len() > start {
            out.push(b' ');
        }
        out.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
    };
    for chunk in text.utf8_chunks() {
        for character in chunk.valid().chars() {
            put(out, character);
        }
        if !chunk.invalid().is_empty() {
            put(out, char::REPLACEMENT_CHARACTER);
        }
    }
}

/// A line for each problem, and nothing else. A problem without a place has the name of its file and its own severity here.
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
            let help = message.details.as_deref().map_or("", |it| &*it.help);
            if !help.is_empty() {
                out.extend_from_slice(b" help: ");
                write_compact(out, help.as_bytes());
            }
            out.push(b'\n');
        }
    }
}
