//! What the linter reports about a file: ESLint's `LintMessage`.

use crate::ast::File;
use crate::context::{Severity, Suggestion};
use crate::fix::Fix;
use crate::options::Json;
use crate::rule::{Meta, Plugin};
use crate::span::Span;

/// ESLint's `ruleId`.
#[derive(Clone, Debug)]
pub enum RuleId {
    /// A rule that exists. It is written `no-debugger`, `@typescript-eslint/no-explicit-any`,
    /// whatever alias the configuration or a comment uses.
    Known(&'static Meta),
    /// As a configuration or a comment names it.
    Unknown(Box<[u8]>),
}

impl PartialEq for RuleId {
    fn eq(&self, other: &RuleId) -> bool {
        match (self, other) {
            (RuleId::Known(a), RuleId::Known(b)) => a.plugin == b.plugin && a.name == b.name,
            (RuleId::Unknown(a), RuleId::Unknown(b)) => a == b,
            _ => false,
        }
    }
}
impl Eq for RuleId {}

impl RuleId {
    pub fn write_to(&self, out: &mut Vec<u8>) {
        match self {
            RuleId::Known(meta) => {
                if meta.plugin == Plugin::TypeScript {
                    out.extend_from_slice(b"@typescript-eslint/");
                }
                out.extend_from_slice(meta.name.as_bytes());
            }
            RuleId::Unknown(name) => out.extend_from_slice(name),
        }
    }

    pub fn to_vec(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.write_to(&mut out);
        out
    }
}

/// Why a message is not shown: `{ kind: "directive", justification }`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Suppression {
    /// What follows `--` in the `eslint-disable` comment.
    pub justification: Box<[u8]>,
}

/// ESLint's `LintMessage`, and with [`LintMessage::suppressions`] its `SuppressedLintMessage`.
#[derive(Clone, Debug)]
pub struct LintMessage {
    /// `None`: it is from the linter itself.
    pub rule_id: Option<RuleId>,
    /// Never [`Severity::Off`].
    pub severity: Severity,
    pub message: Vec<u8>,
    pub message_id: Option<&'static str>,
    /// From 1.
    pub line: u32,
    /// From 1, in UTF-16 code units.
    pub column: u32,
    /// `endLine` and `endColumn`.
    pub end: Option<(u32, u32)>,
    /// The file is not linted because of it.
    pub is_fatal: bool,
    pub fix: Option<Fix>,
    pub suggestions: Vec<Suggestion>,
    pub suppressions: Vec<Suppression>,
}

/// Converts offsets to what ESLint reports. ESLint does not count a byte order mark.
pub(crate) struct Locator<'a> {
    file: &'a File<'a>,
    has_bom: bool,
}

impl<'a> Locator<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Locator {
            file,
            has_bom: file.text().starts_with(b"\xEF\xBB\xBF"),
        }
    }

    /// The line, and the column from 1.
    pub(crate) fn position(&self, offset: u32) -> (u32, u32) {
        let at = self.file.position(offset);
        let bom = u32::from(self.has_bom && at.line == 1 && at.column > 0);
        (at.line, at.column + 1 - bom)
    }

    /// A message of the linter itself at `span`: `createLintingProblem`.
    pub(crate) fn problem(&self, span: Span, severity: Severity, rule_id: Option<RuleId>, message: Vec<u8>) -> LintMessage {
        let (line, column) = self.position(span.start);
        LintMessage {
            rule_id,
            severity,
            message,
            message_id: None,
            line,
            column,
            end: Some(self.position(span.end)),
            is_fatal: false,
            fix: None,
            suggestions: Vec::new(),
            suppressions: Vec::new(),
        }
    }
}

// ───────────────────────────── as JSON ─────────────────────────────

/// `JSON.stringify(text)`
pub(crate) fn write_json_string(out: &mut Vec<u8>, text: &[u8]) {
    use std::io::Write;
    out.push(b'"');
    for chunk in text.utf8_chunks() {
        for &byte in chunk.valid().as_bytes() {
            match byte {
                b'"' | b'\\' => out.extend_from_slice(&[b'\\', byte]),
                0x08 => out.extend_from_slice(b"\\b"),
                0x0C => out.extend_from_slice(b"\\f"),
                b'\n' => out.extend_from_slice(b"\\n"),
                b'\r' => out.extend_from_slice(b"\\r"),
                b'\t' => out.extend_from_slice(b"\\t"),
                0..0x20 => {
                    let _ = write!(out, "\\u{byte:04x}");
                }
                _ => out.push(byte),
            }
        }
        if !chunk.invalid().is_empty() {
            out.extend_from_slice("\u{FFFD}".as_bytes());
        }
    }
    out.push(b'"');
}

/// `JSON.stringify(value)`
pub fn write_json(out: &mut Vec<u8>, value: &Json) {
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Bool(value) => out.extend_from_slice(if *value { b"true" } else { b"false" }),
        Json::Number(value) if !value.is_finite() => out.extend_from_slice(b"null"),
        Json::Number(value) => out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *value)),
        Json::String(value) => write_json_string(out, value),
        Json::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_json(out, item);
            }
            out.push(b']');
        }
        Json::Object(entries) => {
            out.push(b'{');
            for (i, (key, value)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_json_string(out, key);
                out.push(b':');
                write_json(out, value);
            }
            out.push(b'}');
        }
    }
}

/// `String(value)`
pub(crate) fn write_js_string(out: &mut Vec<u8>, value: &Json) {
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Bool(value) => out.extend_from_slice(if *value { b"true" } else { b"false" }),
        Json::Number(value) if value.is_nan() => out.extend_from_slice(b"NaN"),
        Json::Number(value) if value.is_infinite() => {
            out.extend_from_slice(if *value < 0.0 { b"-Infinity" } else { b"Infinity" });
        }
        Json::Number(value) => out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *value)),
        Json::String(value) => out.extend_from_slice(value),
        Json::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                if !matches!(item, Json::Null) {
                    write_js_string(out, item);
                }
            }
        }
        Json::Object(_) => out.extend_from_slice(b"[object Object]"),
    }
}

/// Converts offsets in bytes to offsets in UTF-16 code units, which is what ESLint's `range` is
/// in. Fast if they are asked for in ascending order.
pub struct Utf16Offsets<'t> {
    text: &'t [u8],
    is_ascii: bool,
    /// An offset in bytes and what it converts to.
    last: (u32, u32),
}

impl<'t> Utf16Offsets<'t> {
    /// A byte order mark at the start of `text` is not counted, as in ESLint: it is at -1.
    pub fn new(text: &'t [u8]) -> Self {
        Utf16Offsets {
            text,
            is_ascii: bun_core::strings::first_non_ascii(text).is_none(),
            last: (0, 0),
        }
    }

    pub fn convert(&mut self, offset: u32) -> i64 {
        if self.is_ascii {
            return i64::from(offset);
        }
        let start = if self.text.starts_with(b"\xEF\xBB\xBF") { 3 } else { 0 };
        if offset < start {
            return -1;
        }
        let offset = offset.min(self.text.len() as u32);
        if offset < self.last.0 || self.last.0 < start {
            self.last = (start, 0);
        }
        let between = &self.text[self.last.0 as usize..offset as usize];
        self.last = (offset, self.last.1 + crate::source::utf16_len(between));
        i64::from(self.last.1)
    }
}

fn write_fix(out: &mut Vec<u8>, fix: &Fix, offsets: &mut Utf16Offsets) {
    use std::io::Write;
    let (start, end) = (offsets.convert(fix.span.start), offsets.convert(fix.span.end));
    let _ = write!(out, "{{\"range\":[{start},{end}],\"text\":");
    write_json_string(out, &fix.text);
    out.push(b'}');
}

impl LintMessage {
    /// As ESLint's `json` formatter prints it.
    pub fn write_json(&self, out: &mut Vec<u8>, offsets: &mut Utf16Offsets) {
        use std::io::Write;
        out.extend_from_slice(b"{\"ruleId\":");
        match &self.rule_id {
            Some(id) => write_json_string(out, &id.to_vec()),
            None => out.extend_from_slice(b"null"),
        }
        if self.is_fatal {
            out.extend_from_slice(b",\"fatal\":true");
        }
        let _ = write!(out, ",\"severity\":{},\"message\":", self.severity as u8);
        write_json_string(out, &self.message);
        let _ = write!(out, ",\"line\":{},\"column\":{}", self.line, self.column);
        if let Some(id) = self.message_id {
            out.extend_from_slice(b",\"messageId\":");
            write_json_string(out, id.as_bytes());
        }
        if let Some((line, column)) = self.end {
            let _ = write!(out, ",\"endLine\":{line},\"endColumn\":{column}");
        }
        if let Some(fix) = &self.fix {
            out.extend_from_slice(b",\"fix\":");
            write_fix(out, fix, offsets);
        }
        if !self.suggestions.is_empty() {
            out.extend_from_slice(b",\"suggestions\":[");
            for (i, suggestion) in self.suggestions.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                out.extend_from_slice(b"{\"messageId\":");
                write_json_string(out, suggestion.message_id.as_bytes());
                out.extend_from_slice(b",\"fix\":");
                write_fix(out, &suggestion.fix, offsets);
                out.extend_from_slice(b",\"desc\":");
                write_json_string(out, &suggestion.message);
                out.push(b'}');
            }
            out.push(b']');
        }
        if !self.suppressions.is_empty() {
            out.extend_from_slice(b",\"suppressions\":[");
            for (i, suppression) in self.suppressions.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                out.extend_from_slice(b"{\"kind\":\"directive\",\"justification\":");
                write_json_string(out, &suppression.justification);
                out.push(b'}');
            }
            out.push(b']');
        }
        out.push(b'}');
    }
}
