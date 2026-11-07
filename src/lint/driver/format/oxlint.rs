//! Code shared by oxlint's formats.

use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, RuleId, parse_rule_id};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::source::LineStarts;
use std::cell::OnceCell;

/// The run statistics that oxlint prints.
pub(crate) struct Run {
    pub(crate) files: usize,
    /// [`Config::oxlint_number_of_rules`](bun_lint::linter::Config::oxlint_number_of_rules). `None` if oxlint
    /// doesn't print it, as with nested configs.
    pub(crate) rules: Option<usize>,
    pub(crate) threads: usize,
    pub(crate) seconds: f64,
}

/// `eslint(no-debugger)`, `typescript(no-explicit-any)`, `TS(1038)`
pub(super) fn code(message: &LintMessage) -> Option<Vec<u8>> {
    let Some(rule) = message.rule_id.as_ref() else {
        let code = message.details.as_ref().map(|it| it.typescript_code);
        return code
            .filter(|it| *it != 0)
            .map(|it| format!("TS({it})").into_bytes());
    };
    let id = rule.to_vec();
    let (plugin, name) = parse_rule_id(&id);
    Some([scope_of(rule, plugin), b"(", name, b")"].concat())
}

/// [`scope`] for `rule`'s prefix. A JavaScript plugin keeps its own name.
pub(crate) fn scope_of<'p>(rule: &RuleId, prefix: &'p [u8]) -> &'p [u8] {
    match rule {
        RuleId::Js(_) | RuleId::Named(..) => prefix,
        RuleId::Known(_) | RuleId::Unknown(_) => scope(prefix),
    }
}

/// Returns oxlint's name, in a diagnostic, for the plugin whose rules have the prefix `prefix`.
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

/// Converts ESLint's lines and columns to byte offsets.
pub(super) struct Offsets<'t> {
    text: &'t [u8],
    /// Where each line starts.
    pub(super) lines: LineStarts,
    /// Where the first line starts, which is after a byte order mark.
    start: usize,
    /// If true, every byte is one UTF-16 code unit.
    pub(super) is_ascii: bool,
    /// For valid UTF-8 that isn't ASCII, one entry per `Offsets::STEP` bytes: where the next character starts, and how
    /// many UTF-16 code units come before it. Built the first time a column far into a line is looked up.
    marks: OnceCell<Vec<(usize, usize)>>,
}

/// A character's length.
struct Sizes {
    bytes: usize,
    in_utf16: usize,
}

/// Returns the sizes of the character that starts with the byte `first`.
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
    /// `lines` has the start of each line.
    pub(super) fn new(text: &'t [u8], lines: LineStarts) -> Offsets<'t> {
        Offsets {
            text,
            lines,
            start: text.len() - strings::without_utf8_bom(text).len(),
            is_ascii: strings::first_non_ascii(text).is_none(),
            marks: OnceCell::new(),
        }
    }

    fn marks(&self) -> &[(usize, usize)] {
        self.marks.get_or_init(|| {
            let (text, mut marks) = (self.text, Vec::new());
            if !self.is_ascii && std::str::from_utf8(text).is_ok() {
                let (mut at, mut units) = (0, 0);
                for step in (0..text.len()).step_by(Self::STEP) {
                    let in_character = text[step..].iter().take_while(|it| *it & 0xC0 == 0x80);
                    let next = step + in_character.count();
                    if next < text.len() {
                        units += strings::element_length_utf8_into_utf16(&text[at..next]);
                        at = next;
                        marks.push((at, units));
                    }
                }
            }
            marks
        })
    }

    const STEP: usize = 1024;

    /// Advances from `at`, which has `units` code units before it, to the first character start with at least
    /// `target_units` before it.
    fn forward(&self, (mut at, mut units): (usize, usize), target_units: usize) -> usize {
        while units < target_units && at < self.text.len() {
            // Skip a run of ASCII in one step.
            let most = (at + (target_units - units)).min(self.text.len());
            let Some(ascii) = strings::first_non_ascii(&self.text[at..most]) else {
                return most;
            };
            (at, units) = (at + ascii as usize, units + ascii as usize);
            let Sizes { bytes, in_utf16 } = sizes(self.text[at]);
            at += bytes;
            units += in_utf16;
        }
        at.min(self.text.len())
    }

    /// Takes a 1-based line and a 1-based column in UTF-16 code units. Returns the byte offset and the 1-based column
    /// in bytes.
    pub(super) fn at(&self, line: u32, column: u32) -> (usize, usize) {
        let start = match line {
            0 | 1 => self.start,
            line => (self.lines.start_of(line)).map_or(self.text.len(), |it| it as usize),
        };
        let after_start = (column as usize).saturating_sub(1);
        let in_bytes = (start + after_start).min(self.text.len());
        let at = if self.is_ascii {
            in_bytes
        } else if after_start <= Self::STEP {
            // Count from the start of the line. The marks are only for long lines.
            match self.text[start..in_bytes].is_ascii() {
                true => in_bytes,
                false => self.forward((start, 0), after_start),
            }
        } else if let Some(&before) = self
            .marks()
            .get(start / Self::STEP)
            .filter(|it| it.0 <= start)
            .or_else(|| {
                // A mark is past the start of its step if a character straddles that boundary.
                self.marks().get((start / Self::STEP).checked_sub(1)?)
            })
        {
            let between = self.text.get(before.0..start).unwrap_or_default();
            let units_before_line = before.1 + strings::element_length_utf8_into_utf16(between);
            let target_units = units_before_line + after_start;
            let later = self.marks().partition_point(|it| it.1 <= target_units);
            self.forward(
                later
                    .checked_sub(1)
                    .map_or((start, units_before_line), |it| self.marks()[it])
                    .max((start, units_before_line)),
                target_units,
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

/// Returns the oxlint plugin that has the rules with the prefix `prefix`.
pub(crate) fn plugin(prefix: &[u8]) -> &[u8] {
    match prefix {
        b"react-hooks" => b"react",
        b"react-perf" => b"react_perf",
        b"jsx-a11y" => b"jsx_a11y",
        b"@next/next" => b"nextjs",
        prefix => scope(prefix),
    }
}

/// Returns oxlint's docs page for a rule. `None` for Bun's own rules.
pub(crate) fn docs_page(of: Plugin, name: &[u8]) -> Option<Vec<u8>> {
    let page = [
        b"https://oxc.rs/docs/guide/usage/linter/rules/",
        plugin(of.prefix().as_bytes()),
        b"/",
        name,
        b".html",
    ];
    (!matches!(of, Plugin::Bun | Plugin::BunTest)).then(|| page.concat())
}
