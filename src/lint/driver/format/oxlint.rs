//! What the formats of oxlint share, what its `--rules` prints, and `gitlab` and `sarif` as they are without a configuration of
//! oxlint: in the shape of oxlint's, with the places and the paths of ESLint.

use super::Meta;
use crate::paths;
use crate::print_config::{object, text, write_indented};
use crate::results::FileResult;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, Registry, RuleId, parse_rule_id};
use bun_lint::options::Json;
use bun_lint::rule::Fixable;
use std::io::Write;

/// What oxlint says about a run.
pub(crate) struct Run {
    pub(crate) files: usize,
    /// [`Config::number_of_rules_of_oxlint`](bun_lint::linter::Config::number_of_rules_of_oxlint). `None`: it does not say, as
    /// with nested configurations.
    pub(crate) rules: Option<usize>,
    pub(crate) threads: usize,
    pub(crate) seconds: f64,
}

/// `eslint(no-debugger)`, `typescript(no-explicit-any)`
pub(super) fn code(message: &LintMessage) -> Option<Vec<u8>> {
    let rule = message.rule_id.as_ref()?;
    let id = rule.to_vec();
    let (plugin, name) = parse_rule_id(&id);
    Some([scope_of(rule, plugin), b"(", name, b")"].concat())
}

/// [`scope`] for the prefix of `rule`. A plugin in JavaScript is called what it is called.
pub(crate) fn scope_of<'p>(rule: &RuleId, prefix: &'p [u8]) -> &'p [u8] {
    match rule {
        RuleId::Js(_) | RuleId::Named(..) => prefix,
        RuleId::Known(_) | RuleId::Unknown(_) => scope(prefix),
    }
}

/// What oxlint calls, in a diagnostic, the plugin that rules have the prefix `prefix` of.
fn scope(prefix: &[u8]) -> &[u8] {
    match prefix {
        b"" => b"eslint",
        b"@typescript-eslint" => b"typescript",
        b"n" => b"node",
        b"@next/next" => b"next",
        prefix => prefix,
    }
}

pub(super) fn is_error(message: &LintMessage) -> bool {
    message.is_fatal || message.severity == Severity::Error
}

pub(super) fn file_name(result: &FileResult, meta: &Meta) -> Vec<u8> {
    let path = paths::from_native(&result.path);
    if paths::is_absolute(&path) {
        paths::relative(meta.cwd, &path)
    } else {
        path
    }
}

/// Finds the offsets of the lines and columns that ESLint counts.
pub(super) struct Offsets<'t> {
    text: &'t [u8],
    /// Where each line starts.
    lines: Vec<usize>,
    /// A byte is a UTF-16 code unit.
    is_ascii: bool,
    /// Of a text that is not ASCII and is valid UTF-8, for every `Offsets::STEP` bytes: where the next character starts, and how
    /// many UTF-16 code units are before it.
    marks: Vec<(usize, usize)>,
}

/// How long a character is.
struct Sizes {
    bytes: usize,
    in_utf16: usize,
}

/// Of the character that starts with `first`.
fn sizes(first: u8) -> Sizes {
    let (bytes, in_utf16) = match first {
        0xF0.. => (4, 2),
        0xE0.. => (3, 1),
        0xC0.. => (2, 1),
        _ => (1, 1),
    };
    Sizes { bytes, in_utf16 }
}

impl<'t> Offsets<'t> {
    pub(super) fn new(text: &'t [u8]) -> Offsets<'t> {
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
                let Sizes { bytes, in_utf16 } = sizes(text[at]);
                at += bytes;
                units += in_utf16;
            }
        }
        Offsets {
            text,
            lines,
            is_ascii,
            marks,
        }
    }

    const STEP: usize = 1024;

    /// From `at`, which has `units` code units before it, to the first start of a character that has `wanted` or more.
    fn forward(&self, (mut at, mut units): (usize, usize), wanted: usize) -> usize {
        while units < wanted && at < self.text.len() {
            let Sizes { bytes, in_utf16 } = sizes(self.text[at]);
            at += bytes;
            units += in_utf16;
        }
        at.min(self.text.len())
    }

    /// The offset of a line from 1 and a column from 1 in UTF-16 code units, and the column from 1
    /// in bytes.
    pub(super) fn at(&self, line: u32, column: u32) -> (usize, usize) {
        let start =
            (self.lines.get((line as usize).saturating_sub(1)).copied()).unwrap_or(self.text.len());
        let after_start = (column as usize).saturating_sub(1);
        let at = if self.is_ascii {
            (start + after_start).min(self.text.len())
        } else if let Some(&before) = self
            .marks
            .get(start / Self::STEP)
            .filter(|it| it.0 <= start)
            .or_else(|| {
                // The mark is after the start of its step if a character goes across that.
                self.marks.get((start / Self::STEP).checked_sub(1)?)
            })
        {
            let (mut counted, mut units_before_line) = before;
            while counted < start {
                let Sizes { bytes, in_utf16 } = sizes(self.text[counted]);
                counted += bytes;
                units_before_line += in_utf16;
            }
            let wanted = units_before_line + after_start;
            let later = self.marks.partition_point(|it| it.1 <= wanted);
            self.forward(
                later
                    .checked_sub(1)
                    .map_or((start, units_before_line), |it| self.marks[it])
                    .max((start, units_before_line)),
                wanted,
            )
        } else {
            self.forward((start, 0), after_start)
        };
        (at, at - start + 1)
    }
}

pub(super) fn number(value: usize) -> Json {
    Json::Number(value as f64)
}

/// GitLab's Code Quality report. The fingerprints are stable from run to run. They are not
/// oxlint's.
pub(super) fn write_gitlab(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    // Paths are from the root of the repository.
    let root = paths::ancestors(meta.cwd)
        .find(|it| bun_sys::exists(&paths::join(it, b".git")))
        .unwrap_or(meta.cwd);
    let mut all = Vec::new();
    for result in results {
        let path = paths::relative(root, &paths::resolve(meta.cwd, &file_name(result, meta)));
        for message in &result.messages {
            let end = message.end.map_or(message.line, |it| it.0);
            let severity: &[u8] = if is_error(message) {
                b"critical"
            } else {
                b"major"
            };
            let lines = format!("{}:{end}:", message.line);
            let fingerprint = crate::evaluate::hash(&[
                lines.as_bytes(),
                &path,
                b":",
                &message.message,
                b":",
                severity,
            ]);
            all.push(object(vec![
                (b"description", text(&message.message)),
                (b"check_name", text(&code(message).unwrap_or_default())),
                (b"fingerprint", text(format!("{fingerprint:x}").as_bytes())),
                (b"severity", text(severity)),
                (
                    b"location",
                    object(vec![
                        (b"path", text(&path)),
                        (
                            b"lines",
                            object(vec![
                                (b"begin", number(message.line as usize)),
                                (b"end", number(end as usize)),
                            ]),
                        ),
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
        artifacts.push(object(vec![(
            b"location",
            object(vec![(b"uri", text(&uri))]),
        )]));
        for message in &result.messages {
            // A problem without a rule, like a syntax error.
            let id = code(message).unwrap_or_else(|| b"OXL0001".to_vec());
            let rule = rule_ids.iter().position(|it| *it == id).unwrap_or_else(|| {
                rules.push(object(vec![(b"id", text(&id))]));
                rule_ids.push(id.clone());
                rule_ids.len() - 1
            });
            let mut region = vec![
                (&b"startLine"[..], number(message.line.max(1) as usize)),
                (b"startColumn", number(message.column.max(1) as usize)),
            ];
            if let Some((line, column)) = message.end {
                region.extend([
                    (&b"endLine"[..], number(line as usize)),
                    (b"endColumn", number(column as usize)),
                ]);
            }
            let location = object(vec![(
                b"physicalLocation",
                object(vec![
                    (
                        b"artifactLocation",
                        object(vec![(b"uri", text(&uri)), (b"index", number(artifact))]),
                    ),
                    (b"region", object(region)),
                ]),
            )]);
            all.push(object(vec![
                (b"ruleId", text(&id)),
                (b"ruleIndex", number(rule)),
                (
                    b"level",
                    text(if is_error(message) {
                        b"error"
                    } else {
                        b"warning"
                    }),
                ),
                (b"message", object(vec![(b"text", text(&message.message))])),
                (b"locations", Json::Array(vec![location])),
            ]));
        }
    }
    let driver = object(vec![
        (b"name", text(b"bun lint")),
        (b"version", text(meta.version)),
        (b"semanticVersion", text(meta.version)),
        (
            b"informationUri",
            text(b"https://bun.com/docs/runtime/lint"),
        ),
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
pub(crate) fn plugin(prefix: &[u8]) -> &[u8] {
    match prefix {
        b"react-hooks" => b"react",
        b"react-perf" => b"react_perf",
        b"jsx-a11y" => b"jsx_a11y",
        b"@next/next" => b"nextjs",
        prefix => scope(prefix),
    }
}

/// `--rules`. `as_json`: with `-f json`.
pub(crate) fn write_rules(out: &mut Vec<u8>, registry: &Registry, as_json: bool) {
    let mut all: Vec<_> = registry
        .all()
        .iter()
        .map(|it| (plugin(it.meta.plugin.prefix().as_bytes()), &it.meta))
        .collect();
    bun_lint::utils::sort::sort_by_key(&mut all, |it| (it.0, it.1.name));
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
        let url = [
            b"https://oxc.rs/docs/guide/usage/linter/rules/",
            scope,
            b"/",
            meta.name.as_bytes(),
            b".html",
        ]
        .concat();
        object(vec![
            (b"scope", text(scope)),
            (b"value", text(meta.name.as_bytes())),
            (
                b"category",
                category.map_or(Json::Null, |it| text(it.as_bytes())),
            ),
            (b"type_aware", Json::Bool(meta.requires_types)),
            (b"fix", text(fix)),
            (
                b"default",
                Json::Bool(
                    category == Some("correctness")
                        && matches!(scope, b"eslint" | b"typescript" | b"oxc" | b"unicorn"),
                ),
            ),
            (b"docs_url", text(&url)),
        ])
    });
    write_indented(out, &Json::Array(rules.collect()), 0);
    out.push(b'\n');
}
