//! The formats of oxlint that programs read: `json`, `checkstyle`, `junit`, `gitlab`, `sarif`, and
//! what `--rules` prints.
//!
//! The shape is oxlint's. The messages are ESLint's, and there is no `help`.

use super::Meta;
use crate::paths;
use crate::print_config::{object, text, write_indented};
use crate::results::FileResult;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, Registry, RuleId, parse_rule_id, write_json_string};
use bun_lint::options::Json;
use bun_lint::rule::Fixable;
use std::io::Write;

/// What else oxlint's `json` has.
pub(crate) struct Run {
    pub(crate) files: usize,
    /// How many rules are on in the working directory.
    pub(crate) rules: Option<usize>,
    pub(crate) threads: usize,
    pub(crate) seconds: f64,
}

/// `eslint(no-debugger)`, `typescript(no-explicit-any)`
fn code(message: &LintMessage) -> Option<Vec<u8>> {
    // oxlint has one rule where typescript-eslint extends a rule of ESLint.
    if let Some(RuleId::Known(meta)) = &message.rule_id
        && let Some(base) = meta.extends_base_rule
    {
        return Some([b"eslint(", base.as_bytes(), b")"].concat());
    }
    let id = message.rule_id.as_ref()?.to_vec();
    let (plugin, name) = parse_rule_id(&id);
    Some([scope(plugin), b"(", name, b")"].concat())
}

/// What oxlint calls, in a diagnostic, the plugin that rules have the prefix `prefix` of.
fn scope(prefix: &[u8]) -> &[u8] {
    match prefix {
        b"" => b"eslint",
        b"@typescript-eslint" => b"typescript",
        b"n" => b"node",
        prefix => prefix,
    }
}

fn is_error(message: &LintMessage) -> bool {
    message.is_fatal || message.severity == Severity::Error
}

fn file_name(result: &FileResult, meta: &Meta) -> Vec<u8> {
    let path = paths::from_native(&result.path);
    if paths::is_absolute(&path) { paths::relative(meta.cwd, &path) } else { path }
}

/// Finds the offsets of the lines and columns that ESLint counts.
struct Offsets<'t> {
    text: &'t [u8],
    /// Where each line starts.
    lines: Vec<usize>,
    /// A byte is a UTF-16 code unit.
    is_ascii: bool,
    /// Of a text that is not ASCII and is valid UTF-8, for every `Offsets::STEP` bytes: where the next character starts, and how
    /// many UTF-16 code units are before it.
    marks: Vec<(usize, usize)>,
}

/// How many bytes and how many UTF-16 code units the character has that starts with `first`.
fn sizes(first: u8) -> (usize, usize) {
    match first {
        0xF0.. => (4, 2),
        0xE0.. => (3, 1),
        0xC0.. => (2, 1),
        _ => (1, 1),
    }
}

impl<'t> Offsets<'t> {
    fn new(text: &'t [u8]) -> Offsets<'t> {
        let mut lines = vec![text.len() - strings::without_utf8_bom(text).len()];
        let mut at = 0;
        // `\r`, `\n`, and the first byte of U+2028 and U+2029.
        while let Some(found) = strings::index_of_any(&text[at..], b"\r\n\xE2") {
            at += found;
            at += match &text[at..] {
                [b'\r', b'\n', ..] => 2,
                [b'\xE2', b'\x80', b'\xA8' | b'\xA9', ..] => 3,
                [b'\xE2', ..] => {
                    at += 1;
                    continue;
                }
                _ => 1,
            };
            lines.push(at);
        }
        let is_ascii = strings::first_non_ascii(text).is_none();
        let mut marks = Vec::new();
        if !is_ascii && std::str::from_utf8(text).is_ok() {
            let (mut at, mut units) = (0, 0);
            while at < text.len() {
                if at >= marks.len() * Self::STEP {
                    marks.push((at, units));
                }
                let (bytes, in_utf16) = sizes(text[at]);
                at += bytes;
                units += in_utf16;
            }
        }
        Offsets { text, lines, is_ascii, marks }
    }

    const STEP: usize = 1024;

    /// From `at`, which has `units` code units before it, to the first start of a character that has `wanted` or more.
    fn forward(&self, (mut at, mut units): (usize, usize), wanted: usize) -> usize {
        while units < wanted && at < self.text.len() {
            let (bytes, in_utf16) = sizes(self.text[at]);
            at += bytes;
            units += in_utf16;
        }
        at.min(self.text.len())
    }

    /// The offset of a line from 1 and a column from 1 in UTF-16 code units, and the column from 1
    /// in bytes.
    fn at(&self, line: u32, column: u32) -> (usize, usize) {
        let start = (self.lines.get((line as usize).saturating_sub(1)).copied()).unwrap_or(self.text.len());
        let after_start = (column as usize).saturating_sub(1);
        let at = if self.is_ascii {
            (start + after_start).min(self.text.len())
        } else if let Some(&before) = self.marks.get(start / Self::STEP).filter(|it| it.0 <= start).or_else(|| {
            // The mark is after the start of its step if a character goes across that.
            self.marks.get((start / Self::STEP).checked_sub(1)?)
        }) {
            let (mut counted, mut units_before_line) = before;
            while counted < start {
                let (bytes, in_utf16) = sizes(self.text[counted]);
                counted += bytes;
                units_before_line += in_utf16;
            }
            let wanted = units_before_line + after_start;
            let later = self.marks.partition_point(|it| it.1 <= wanted);
            self.forward(later.checked_sub(1).map_or((start, units_before_line), |it| self.marks[it]).max((start, units_before_line)), wanted)
        } else {
            self.forward((start, 0), after_start)
        };
        (at, at - start + 1)
    }
}

/// miette's `JSONReportHandler`, in `lint_command_info` of oxlint's `JsonOutputFormatter`.
pub(super) fn write_json(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    out.extend_from_slice(b"{ \"diagnostics\": [");
    let mut is_first = true;
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let name = file_name(result, meta);
        let offsets = Offsets::new(result.text.as_deref().unwrap_or_default());
        for message in &result.messages {
            if !std::mem::replace(&mut is_first, false) {
                out.extend_from_slice(b",\n");
            }
            out.extend_from_slice(b"{\"message\": ");
            write_json_string(out, &message.message);
            if let Some(code) = code(message) {
                out.extend_from_slice(b",\"code\": ");
                write_json_string(out, &code);
            }
            out.extend_from_slice(if is_error(message) { b",\"severity\": \"error\"" } else { b",\"severity\": \"warning\"" });
            out.extend_from_slice(b",\"filename\": ");
            write_json_string(out, &name);
            out.extend_from_slice(b",\"labels\": [");
            if message.line > 0 {
                let (start, column) = offsets.at(message.line, message.column);
                let end = message.end.map_or(start, |(line, column)| offsets.at(line, column).0);
                let length = end.saturating_sub(start);
                let line = message.line;
                let _ = write!(out, "{{\"span\": {{\"offset\": {start},\"length\": {length},\"line\": {line},\"column\": {column}}}}}");
            }
            out.extend_from_slice(b"]}");
        }
    }
    let run = &meta.run;
    let rules = run.rules.map_or_else(|| "null".to_owned(), |it| it.to_string());
    let _ = write!(
        out,
        "],\n              \"number_of_files\": {},\n              \"number_of_rules\": {rules},\n              \"threads_count\": {},\n              \"start_time\": {}\n            }}\n            ",
        run.files, run.threads, run.seconds,
    );
}

fn write_xml_escaped(out: &mut Vec<u8>, text: &[u8]) {
    for byte in text {
        match byte {
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            b'\'' => out.extend_from_slice(b"&apos;"),
            b'&' => out.extend_from_slice(b"&amp;"),
            b'"' => out.extend_from_slice(b"&quot;"),
            byte => out.push(*byte),
        }
    }
}

pub(super) fn write_checkstyle(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    out.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"utf-8\"?><checkstyle version=\"4.3\">");
    for (i, result) in results.iter().filter(|it| !it.messages.is_empty()).enumerate() {
        out.extend_from_slice(if i > 0 { b" <file name=\"" } else { b"<file name=\"" });
        out.extend_from_slice(&file_name(result, meta));
        out.extend_from_slice(b"\">");
        for message in &result.messages {
            let severity = if is_error(message) { "error" } else { "warning" };
            let _ = write!(out, "<error line=\"{}\" column=\"{}\" severity=\"{severity}\" message=\"", message.line, message.column);
            write_xml_escaped(out, &message.message);
            out.extend_from_slice(b"\" source=\"");
            write_xml_escaped(out, &code(message).unwrap_or_default());
            out.extend_from_slice(b"\" />");
        }
        out.extend_from_slice(b"</file>");
    }
    out.extend_from_slice(b"</checkstyle>\n");
}

pub(super) fn write_junit(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let count = |of: &dyn Fn(&FileResult) -> usize| results.iter().map(of).sum::<usize>();
    let errors_of = |result: &FileResult| result.messages.iter().filter(|it| is_error(it)).count();
    let (all, errors) = (count(&|it| it.messages.len()), count(&errors_of));
    let _ = write!(
        out,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites name=\"Oxlint\" tests=\"{all}\" failures=\"{}\" errors=\"{errors}\">\n",
        all - errors,
    );
    for (i, result) in results.iter().filter(|it| !it.messages.is_empty()).enumerate() {
        out.extend_from_slice(if i > 0 { b"\n    <testsuite name=\"" } else { b"    <testsuite name=\"" });
        out.extend_from_slice(&file_name(result, meta));
        let (all, errors) = (result.messages.len(), errors_of(result));
        let _ = write!(out, "\" tests=\"{all}\" disabled=\"0\" errors=\"{errors}\" failures=\"{}\">", all - errors);
        for message in &result.messages {
            let tag = if is_error(message) { "error" } else { "failure" };
            out.extend_from_slice(b"\n        <testcase name=\"");
            out.extend_from_slice(&code(message).unwrap_or_default());
            let _ = write!(out, "\">\n            <{tag} message=\"");
            write_xml_escaped(out, &message.message);
            let _ = write!(out, "\">line {}, column {}, ", message.line, message.column);
            write_xml_escaped(out, &message.message);
            let _ = write!(out, "</{tag}>\n        </testcase>");
        }
        out.extend_from_slice(b"\n    </testsuite>");
    }
    out.extend_from_slice(b"\n</testsuites>\n");
}

fn number(value: usize) -> Json {
    Json::Number(value as f64)
}

/// GitLab's Code Quality report. The fingerprints are stable from run to run. They are not
/// oxlint's.
pub(super) fn write_gitlab(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    // Paths are from the root of the repository.
    let root = paths::ancestors(meta.cwd).find(|it| bun_sys::exists(&paths::join(it, b".git"))).unwrap_or(meta.cwd);
    let mut all = Vec::new();
    for result in results {
        let path = paths::relative(root, &paths::resolve(meta.cwd, &file_name(result, meta)));
        for message in &result.messages {
            let end = message.end.map_or(message.line, |it| it.0);
            let severity: &[u8] = if is_error(message) { b"critical" } else { b"major" };
            let lines = format!("{}:{end}:", message.line);
            let fingerprint = crate::evaluate::hash(&[lines.as_bytes(), &path, b":", &message.message, b":", severity]);
            all.push(object(vec![
                (b"description", text(&message.message)),
                (b"check_name", text(&code(message).unwrap_or_default())),
                (b"fingerprint", text(format!("{fingerprint:x}").as_bytes())),
                (b"severity", text(severity)),
                (
                    b"location",
                    object(vec![
                        (b"path", text(&path)),
                        (b"lines", object(vec![(b"begin", number(message.line as usize)), (b"end", number(end as usize))])),
                    ]),
                ),
            ]));
        }
    }
    write_indented(out, &Json::Array(all), 0);
}

pub(super) fn write_sarif(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let (mut rules, mut rule_ids): (Vec<Json>, Vec<Vec<u8>>) = (Vec::new(), Vec::new());
    let (mut artifacts, mut all) = (Vec::new(), Vec::new());
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let uri = file_name(result, meta);
        let artifact = artifacts.len();
        artifacts.push(object(vec![(b"location", object(vec![(b"uri", text(&uri))]))]));
        for message in &result.messages {
            // A problem without a rule, like a syntax error.
            let id = code(message).unwrap_or_else(|| b"OXL0001".to_vec());
            let rule = rule_ids.iter().position(|it| *it == id).unwrap_or_else(|| {
                rules.push(object(vec![(b"id", text(&id))]));
                rule_ids.push(id.clone());
                rule_ids.len() - 1
            });
            let mut region = vec![(&b"startLine"[..], number(message.line.max(1) as usize)), (b"startColumn", number(message.column.max(1) as usize))];
            if let Some((line, column)) = message.end {
                region.extend([(&b"endLine"[..], number(line as usize)), (b"endColumn", number(column as usize))]);
            }
            let location = object(vec![(
                b"physicalLocation",
                object(vec![
                    (b"artifactLocation", object(vec![(b"uri", text(&uri)), (b"index", number(artifact))])),
                    (b"region", object(region)),
                ]),
            )]);
            all.push(object(vec![
                (b"ruleId", text(&id)),
                (b"ruleIndex", number(rule)),
                (b"level", text(if is_error(message) { b"error" } else { b"warning" })),
                (b"message", object(vec![(b"text", text(&message.message))])),
                (b"locations", Json::Array(vec![location])),
            ]));
        }
    }
    let driver = object(vec![
        (b"name", text(b"bun lint")),
        (b"version", text(meta.version)),
        (b"semanticVersion", text(meta.version)),
        (b"informationUri", text(b"https://bun.com/docs/runtime/lint")),
        (b"rules", Json::Array(rules)),
    ]);
    let mut run = vec![(&b"tool"[..], object(vec![(b"driver", driver)]))];
    if !artifacts.is_empty() {
        run.push((b"artifacts", Json::Array(artifacts)));
    }
    let has_results = !all.is_empty();
    run.push((b"results", Json::Array(all)));
    if has_results {
        run.push((b"columnKind", text(b"utf16CodeUnits")));
    }
    let log = object(vec![
        (b"version", text(b"2.1.0")),
        (b"$schema", text(b"https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json")),
        (b"runs", Json::Array(vec![object(run)])),
    ]);
    write_indented(out, &log, 0);
    out.push(b'\n');
}

/// The plugin of oxlint that has the rules with the prefix `prefix`.
fn plugin(prefix: &[u8]) -> &[u8] {
    if prefix == b"react-hooks" { b"react" } else { scope(prefix) }
}

/// `--rules`. `as_json`: with `-f json`.
pub(crate) fn write_rules(out: &mut Vec<u8>, registry: &Registry, as_json: bool) {
    let mut all: Vec<_> = registry.all().iter().map(|it| (plugin(it.meta.plugin.prefix().as_bytes()), &it.meta)).collect();
    all.sort_by_key(|it| (it.0, it.1.name));
    if !as_json {
        for (scope, meta) in all {
            out.extend_from_slice(scope);
            let _ = writeln!(out, "/{}", meta.name);
        }
        return;
    }
    let rules = all.into_iter().map(|(scope, meta)| {
        let category = bun_lint::linter::oxlint_category(meta.plugin, meta.name);
        let fix: &[u8] = match (meta.fixable != Fixable::No, meta.has_suggestions) {
            (true, true) => b"fixable_safe_fix_or_suggestion",
            (true, false) => b"fixable_fix",
            (false, true) => b"fixable_suggestion",
            (false, false) => b"none",
        };
        let url = [b"https://oxc.rs/docs/guide/usage/linter/rules/", scope, b"/", meta.name.as_bytes(), b".html"].concat();
        object(vec![
            (b"scope", text(scope)),
            (b"value", text(meta.name.as_bytes())),
            (b"category", category.map_or(Json::Null, |it| text(it.as_bytes()))),
            (b"type_aware", Json::Bool(meta.requires_types)),
            (b"fix", text(fix)),
            (b"default", Json::Bool(category == Some("correctness") && matches!(scope, b"eslint" | b"typescript" | b"oxc"))),
            (b"docs_url", text(&url)),
        ])
    });
    write_indented(out, &Json::Array(rules.collect()), 0);
    out.push(b'\n');
}
