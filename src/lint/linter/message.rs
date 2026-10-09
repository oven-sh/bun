//! What the linter reports about a file: ESLint's `LintMessage`.

use crate::ast::File;
use crate::context::Severity;
use crate::fix::{Fix, SuggestionKind};
use crate::js_plugin;
use crate::options::Json;
use crate::rule::{Meta, Plugin};
use crate::span::Span;
use std::borrow::Cow;
use std::sync::Arc;

/// ESLint's `ruleId`.
#[derive(Clone, Debug)]
pub enum RuleId {
    /// A rule that exists. It is written `no-debugger`, `@typescript-eslint/no-explicit-any`,
    /// whatever alias the configuration or a comment uses.
    Known(&'static Meta),
    /// A rule of a JavaScript plugin.
    Js(Arc<js_plugin::Rule>),
    /// As a configuration or a comment names it.
    Unknown(Box<[u8]>),
}

impl PartialEq for RuleId {
    fn eq(&self, other: &RuleId) -> bool {
        match (self, other) {
            (RuleId::Known(a), RuleId::Known(b)) => a.plugin == b.plugin && a.name == b.name,
            (RuleId::Js(a), RuleId::Js(b)) => Arc::ptr_eq(a, b),
            (RuleId::Unknown(a), RuleId::Unknown(b)) => a == b,
            _ => false,
        }
    }
}
impl Eq for RuleId {}

impl std::hash::Hash for RuleId {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        match self {
            RuleId::Known(meta) => (meta.plugin, meta.name).hash(state),
            RuleId::Js(rule) => Arc::as_ptr(rule).hash(state),
            RuleId::Unknown(name) => name.hash(state),
        }
    }
}

impl RuleId {
    pub fn write_to(&self, out: &mut Vec<u8>) {
        match self {
            RuleId::Known(meta) => {
                if meta.plugin != Plugin::Eslint {
                    out.extend_from_slice(meta.plugin.prefix().as_bytes());
                    out.push(b'/');
                }
                out.extend_from_slice(meta.name.as_bytes());
            }
            RuleId::Js(rule) => out.extend_from_slice(&rule.id),
            RuleId::Unknown(name) => out.extend_from_slice(name),
        }
    }

    pub fn to_vec(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.write_to(&mut out);
        out
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SuppressionKind {
    /// An `eslint-disable` comment.
    Directive,
    /// `eslint-suppressions.json`
    File,
}

/// Why a message is not shown: `{ kind, justification }`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Suppression {
    pub kind: SuppressionKind,
    /// What follows `--` in the `eslint-disable` comment.
    pub justification: Box<[u8]>,
}

impl Suppression {
    /// By an `eslint-disable` comment.
    pub fn directive(justification: &[u8]) -> Suppression {
        Suppression {
            kind: SuppressionKind::Directive,
            justification: justification.into(),
        }
    }

    /// By `eslint-suppressions.json`.
    pub fn file() -> Suppression {
        Suppression {
            kind: SuppressionKind::File,
            justification: Box::default(),
        }
    }
}

/// An element of ESLint's `suggestions`.
#[derive(Clone, Debug)]
pub struct Suggestion {
    /// Empty: the rule gave the description itself.
    pub message_id: Cow<'static, str>,
    /// `desc`
    pub message: Vec<u8>,
    /// What the placeholders of the message stand for.
    pub data: Vec<(Cow<'static, str>, Vec<u8>)>,
    pub fix: Fix,
    pub kind: SuggestionKind,
}

impl From<crate::context::Suggestion> for Suggestion {
    fn from(it: crate::context::Suggestion) -> Suggestion {
        let data = it.data.into_iter();
        Suggestion {
            message_id: Cow::Borrowed(it.message_id),
            message: it.message,
            data: data
                .map(|(name, value)| (Cow::Borrowed(name), value))
                .collect(),
            fix: it.fix,
            kind: it.kind,
        }
    }
}

impl From<js_plugin::Suggested> for Suggestion {
    fn from(it: js_plugin::Suggested) -> Suggestion {
        let data = it.data.into_iter();
        Suggestion {
            message_id: it
                .message_id
                .map_or(Cow::Borrowed(""), |id| Cow::Owned(id.into())),
            message: it.message,
            data: data
                .map(|(name, value)| (Cow::Owned(name.into()), value))
                .collect(),
            fix: it.fix,
            kind: SuggestionKind::Suggestion,
        }
    }
}

/// ESLint's `LintMessage`, and with [`LintMessage::suppressions`] its `SuppressedLintMessage`.
#[derive(Clone, Debug)]
pub struct LintMessage {
    /// `None`: it is from the linter itself.
    pub rule_id: Option<RuleId>,
    /// Never [`Severity::Off`].
    pub severity: Severity,
    pub message: Vec<u8>,
    /// `None`: it is from the linter itself. Empty: from a rule whose messages have no ids.
    pub message_id: Option<Cow<'static, str>>,
    /// From 1. 0 in a fatal message: it has no place, and ESLint has neither `line` nor `column`.
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
    /// Where the message starts and ends for the comments that disable rules, if that is another place than the one that is
    /// shown: [`Report::comments_apply_at`](crate::context::Report::comments_apply_at). Only oxlint has such messages, and only
    /// with a configuration of oxlint it counts.
    pub comments_apply_at: Option<((u32, u32), (u32, u32))>,
    pub details: Option<Box<Details>>,
}

/// [`Details`](crate::context::Details) of a report, with lines and columns as the message has them.
#[derive(Clone, Debug, Default)]
pub struct Details {
    pub first_label: Cow<'static, str>,
    /// Where each starts, where it ends, and what it says.
    pub labels: Vec<((u32, u32), (u32, u32), Cow<'static, str>)>,
    pub help: Cow<'static, str>,
    pub note: Cow<'static, str>,
}

impl Default for LintMessage {
    /// An error of the linter itself, without a text and without a place. For `..LintMessage::default()`, with which code that
    /// makes a message goes on compiling when there are more fields.
    fn default() -> LintMessage {
        LintMessage {
            rule_id: None,
            severity: Severity::Error,
            message: Vec::new(),
            message_id: None,
            line: 0,
            column: 0,
            end: None,
            is_fatal: false,
            fix: None,
            suggestions: Vec::new(),
            suppressions: Vec::new(),
            comments_apply_at: None,
            details: None,
        }
    }
}

/// Converts offsets to what ESLint reports.
pub(crate) struct Locator<'a> {
    file: &'a File<'a>,
}

impl<'a> Locator<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Locator { file }
    }

    /// The line, and the column from 1.
    pub(crate) fn position(&self, offset: u32) -> (u32, u32) {
        let at = self.file.position(offset);
        (at.line, at.column + 1)
    }

    /// A message of the linter itself at `span`: `createLintingProblem`.
    pub(crate) fn problem(
        &self,
        span: Span,
        severity: Severity,
        rule_id: Option<RuleId>,
        message: Vec<u8>,
    ) -> LintMessage {
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
            comments_apply_at: None,
            details: None,
        }
    }
}

// ───────────────────────────── as JSON ─────────────────────────────

/// `JSON.stringify(text)`
pub fn write_json_string(out: &mut Vec<u8>, text: &[u8]) {
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
        Json::Number(value) => {
            out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *value))
        }
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

/// `JSON.stringify(value, null, 2)`
pub(crate) fn write_json_indented(out: &mut Vec<u8>, value: &Json, depth: usize) {
    let new_line = |out: &mut Vec<u8>, depth: usize| {
        out.push(b'\n');
        out.resize(out.len() + 2 * depth, b' ');
    };
    match value {
        Json::Array(items) if !items.is_empty() => {
            for (i, item) in items.iter().enumerate() {
                out.push(if i == 0 { b'[' } else { b',' });
                new_line(out, depth + 1);
                write_json_indented(out, item, depth + 1);
            }
            new_line(out, depth);
            out.push(b']');
        }
        Json::Object(entries) if !entries.is_empty() => {
            for (i, (key, value)) in entries.iter().enumerate() {
                out.push(if i == 0 { b'{' } else { b',' });
                new_line(out, depth + 1);
                write_json_string(out, key);
                out.extend_from_slice(b": ");
                write_json_indented(out, value, depth + 1);
            }
            new_line(out, depth);
            out.push(b'}');
        }
        value => write_json(out, value),
    }
}

/// `String(value)`
pub(crate) fn write_js_string(out: &mut Vec<u8>, value: &Json) {
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Bool(value) => out.extend_from_slice(if *value { b"true" } else { b"false" }),
        Json::Number(value) if value.is_nan() => out.extend_from_slice(b"NaN"),
        Json::Number(value) if value.is_infinite() => {
            out.extend_from_slice(if *value < 0.0 {
                b"-Infinity"
            } else {
                b"Infinity"
            });
        }
        Json::Number(value) => {
            out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], *value))
        }
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
        let start = if self.text.starts_with(b"\xEF\xBB\xBF") {
            3
        } else {
            0
        };
        if offset < start {
            return -1;
        }
        // What is beyond the text counts as it is.
        let beyond = offset.saturating_sub(self.text.len() as u32);
        let offset = offset - beyond;
        if offset < self.last.0 || self.last.0 < start {
            self.last = (start, 0);
        }
        let between = &self.text[self.last.0 as usize..offset as usize];
        self.last = (offset, self.last.1 + crate::source::utf16_len(between));
        i64::from(self.last.1) + i64::from(beyond)
    }
}

fn write_fix(out: &mut Vec<u8>, fix: &Fix, offsets: &mut Utf16Offsets) {
    use std::io::Write;
    let (start, end) = (
        offsets.convert(fix.span.start),
        offsets.convert(fix.span.end),
    );
    let _ = write!(out, "{{\"range\":[{start},{end}],\"text\":");
    write_json_string(out, &fix.text);
    out.push(b'}');
}

impl LintMessage {
    /// Sorts by line and column. Those at the same place keep their order. Most lists are in order already.
    pub fn sort(messages: &mut [LintMessage]) {
        let place = |it: &LintMessage| (it.line, it.column);
        if !messages.is_sorted_by_key(place) {
            crate::utils::sort::sort_by_key(messages, place);
        }
    }

    /// As ESLint's `json` formatter prints it.
    pub fn write_json(&self, out: &mut Vec<u8>, offsets: &mut Utf16Offsets) {
        use std::io::Write;
        out.extend_from_slice(b"{\"ruleId\":");
        match &self.rule_id {
            Some(id) => write_json_string(out, &id.to_vec()),
            None => out.extend_from_slice(b"null"),
        }
        // What the linter says itself, other than about a file that cannot be parsed, is made by another function of ESLint.
        let is_severity_last = self.message_id.is_none() && (!self.is_fatal || self.end.is_some());
        if !is_severity_last {
            if self.is_fatal {
                out.extend_from_slice(b",\"fatal\":true");
            }
            let _ = write!(out, ",\"severity\":{}", self.severity as u8);
        }
        out.extend_from_slice(b",\"message\":");
        write_json_string(out, &self.message);
        if !self.is_fatal || self.line != 0 {
            let _ = write!(out, ",\"line\":{},\"column\":{}", self.line, self.column);
        }
        if let Some(id) = self.message_id.as_deref().filter(|it| !it.is_empty()) {
            out.extend_from_slice(b",\"messageId\":");
            write_json_string(out, id.as_bytes());
        }
        if let Some((line, column)) = self.end {
            let _ = write!(out, ",\"endLine\":{line},\"endColumn\":{column}");
        }
        if is_severity_last {
            let _ = write!(out, ",\"severity\":{}", self.severity as u8);
            if self.is_fatal {
                out.extend_from_slice(b",\"fatal\":true");
            }
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
                // A rule that has no ids writes `desc` itself, first.
                if suggestion.message_id.is_empty() {
                    out.extend_from_slice(b"{\"desc\":");
                    write_json_string(out, &suggestion.message);
                    out.extend_from_slice(b",\"fix\":");
                    write_fix(out, &suggestion.fix, offsets);
                    out.push(b'}');
                    continue;
                }
                out.extend_from_slice(b"{\"messageId\":");
                write_json_string(out, suggestion.message_id.as_bytes());
                for (i, (name, value)) in suggestion.data.iter().enumerate() {
                    out.extend_from_slice(if i == 0 { b",\"data\":{" } else { b"," });
                    write_json_string(out, name.as_bytes());
                    out.push(b':');
                    write_json_string(out, value);
                }
                if !suggestion.data.is_empty() {
                    out.push(b'}');
                }
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
                out.extend_from_slice(match suppression.kind {
                    SuppressionKind::Directive => b"{\"kind\":\"directive\",\"justification\":",
                    SuppressionKind::File => b"{\"kind\":\"file\",\"justification\":",
                });
                write_json_string(out, &suppression.justification);
                out.push(b'}');
            }
            out.push(b']');
        }
        out.push(b'}');
    }
}
