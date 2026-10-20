//! The linter's reports about a file: ESLint's `LintMessage`.

use crate::ast::File;
use crate::context::Severity;
use crate::fix::{Fix, SuggestionKind};
use crate::js_plugin;
use crate::options::Json;
use crate::oxlint_help::{Help, Part};
use crate::rule::{Meta, Plugin};
use crate::span::Span;
use bun_core::printer::json_stringify;
use std::borrow::Cow;
use std::sync::Arc;

/// ESLint's `ruleId`.
#[derive(Clone, Debug)]
pub enum RuleId {
    /// A built-in rule. It's printed as `no-debugger` or `@typescript-eslint/no-explicit-any`, whatever alias the
    /// config or a comment uses.
    Known(&'static Meta),
    Js(Arc<js_plugin::Rule>),
    /// An extra instance of a built-in rule, under a name from the config: `no-restricted-syntax/<name>`. Holds the
    /// rule and the full name.
    Named(&'static Meta, Arc<[u8]>),
    /// The name as a config or a comment writes it.
    Unknown(Box<[u8]>),
}

impl PartialEq for RuleId {
    fn eq(&self, other: &RuleId) -> bool {
        match (self, other) {
            (RuleId::Known(a), RuleId::Known(b)) => a.plugin == b.plugin && a.name == b.name,
            (RuleId::Js(a), RuleId::Js(b)) => Arc::ptr_eq(a, b),
            (RuleId::Named(_, a), RuleId::Named(_, b)) => a == b,
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
            RuleId::Named(_, name) => name.hash(state),
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
            RuleId::Named(_, name) => out.extend_from_slice(name),
            RuleId::Unknown(name) => out.extend_from_slice(name),
        }
    }

    pub fn to_vec(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.write_to(&mut out);
        out
    }

    /// [`Meta::docs_url`], if the rule is built in.
    pub fn docs_url(&self) -> Option<Vec<u8>> {
        match self {
            RuleId::Known(meta) | RuleId::Named(meta, _) => Some(meta.docs_url()),
            RuleId::Js(_) | RuleId::Unknown(_) => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SuppressionKind {
    /// An `eslint-disable` comment.
    Directive,
    /// `eslint-suppressions.json`
    File,
}

/// Why a message isn't shown: `{ kind, justification }`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Suppression {
    pub kind: SuppressionKind,
    /// The text after `--` in the `eslint-disable` comment.
    pub justification: Box<[u8]>,
}

impl Suppression {
    /// Suppressed by an `eslint-disable` comment.
    pub fn directive(justification: &[u8]) -> Suppression {
        Suppression {
            kind: SuppressionKind::Directive,
            justification: justification.into(),
        }
    }

    /// Suppressed by `eslint-suppressions.json`.
    pub fn file() -> Suppression {
        Suppression {
            kind: SuppressionKind::File,
            justification: Box::default(),
        }
    }
}

/// A suggestion's `data`, which ESLint passes through to its output.
#[derive(Clone, Debug, Default)]
pub enum Data {
    /// The rule didn't pass any.
    #[default]
    None,
    /// Values for the placeholders in a built-in rule's message.
    Texts(Vec<(&'static str, Vec<u8>)>),
    /// The `data` that a JavaScript rule passed, as JSON.
    Json(Vec<u8>),
}

/// An element of ESLint's `suggestions`.
#[derive(Clone, Debug)]
pub struct Suggestion {
    /// Empty if the rule wrote the description itself.
    pub message_id: Cow<'static, str>,
    /// `desc`
    pub message: Vec<u8>,
    pub data: Data,
    pub fix: Fix,
    pub kind: SuggestionKind,
}

impl From<crate::context::Suggestion> for Suggestion {
    fn from(it: crate::context::Suggestion) -> Suggestion {
        Suggestion {
            message_id: Cow::Borrowed(it.message_id),
            message: it.message,
            // Where upstream writes `desc` itself, the built-in rule fills in its own template. That data isn't
            // upstream's, so drop it.
            data: match it.data.is_empty() || it.message_id.is_empty() {
                true => Data::None,
                false => Data::Texts(it.data),
            },
            fix: it.fix,
            kind: it.kind,
        }
    }
}

impl From<js_plugin::Suggested> for Suggestion {
    fn from(it: js_plugin::Suggested) -> Suggestion {
        Suggestion {
            message_id: it
                .message_id
                .map_or(Cow::Borrowed(""), |id| Cow::Owned(id.into())),
            message: it.message,
            data: it.data.map_or(Data::None, Data::Json),
            fix: it.fix,
            kind: SuggestionKind::Suggestion,
        }
    }
}

/// ESLint's `LintMessage`, and with [`LintMessage::suppressions`] its `SuppressedLintMessage`.
#[derive(Clone, Debug)]
pub struct LintMessage {
    /// `None` if it comes from the linter itself.
    pub rule_id: Option<RuleId>,
    /// Never [`Severity::Off`].
    pub severity: Severity,
    pub message: Vec<u8>,
    /// `None` if it comes from the linter itself. Empty if it comes from a rule whose messages have no ids.
    pub message_id: Option<Cow<'static, str>>,
    /// 1-based. 0 in a fatal message means it has no position, and ESLint has neither `line` nor `column`. A JavaScript
    /// rule can pass any number, which ESLint passes through. A negative one is stored as an `i32`: -1 is `u32::MAX`.
    pub line: u32,
    /// 1-based, in UTF-16 code units. Negative values are stored as in `line`.
    pub column: u32,
    /// `endLine` and `endColumn`. Negative values are stored as in `line`.
    pub end: Option<(u32, u32)>,
    /// The file isn't linted because of it.
    pub is_fatal: bool,
    /// [`Report::claims`](crate::context::Report::claims). See [`LintMessage::hide_claimed`].
    pub claim: Option<crate::context::Claim>,
    pub fix: Option<Fix>,
    pub suggestions: Vec<Suggestion>,
    pub suppressions: Vec<Suppression>,
    /// The start and end that comments which disable rules see, if they differ from the position that's shown:
    /// [`Report::comments_apply_at`](crate::context::Report::comments_apply_at). Only oxlint has such messages, and
    /// it's only used with an oxlint config.
    pub comments_apply_at: Option<((u32, u32), (u32, u32))>,
    pub not_numbers: NotNumbers,
    pub details: Option<Box<Details>>,
    /// [`Diagnostic::constant_help`](crate::context::Diagnostic::constant_help)
    pub constant_help: Option<Help>,
    /// For oxlint, which doesn't sort. It prints the reports of its own rules in the order it runs them (see
    /// `oxlint_order`), then the reports of JavaScript plugin rules in the order they're made, then its messages about
    /// comments. This is the message's 1-based position in that sequence. 0 means it doesn't come from a rule and is
    /// printed first. `u32::MAX` means it's about a comment.
    pub reported: u32,
}

impl LintMessage {
    /// Removes from `messages` what a rule without types reports about a node that the typed rule of its
    /// [pair](crate::rule_set::Pairs) also reports. Its fix and suggestions move to the typed rule's report. Returns
    /// true if anything was removed.
    ///
    /// This is the last step: `messages` are the ones that are shown, after suppression by comments and files and after
    /// the fixes. Until then there are two reports, and everything treats them as two.
    pub fn hide_claimed(messages: &mut Vec<LintMessage>) -> bool {
        let claims = messages
            .iter()
            .zip(0..)
            .filter_map(|(it, at)| Some((it.claim?, at)));
        let mut with_types: Vec<(crate::context::Claim, usize)> =
            claims.filter(|it| it.0.with_types).collect();
        if with_types.is_empty() {
            return false;
        }
        with_types.sort_unstable();
        let mut is_hidden = vec![false; messages.len()];
        for from in 0..messages.len() {
            let Some(claim) = messages[from].claim.filter(|it| !it.with_types) else {
                continue;
            };
            let Ok(found) = with_types.binary_search_by_key(&claim.with_types(), |it| it.0) else {
                continue;
            };
            is_hidden[from] = true;
            let fix = messages[from].fix.take();
            let suggestions = std::mem::take(&mut messages[from].suggestions);
            let typed_report = &mut messages[with_types[found].1];
            typed_report.fix = typed_report.fix.take().or(fix);
            for suggestion in suggestions {
                if !typed_report
                    .suggestions
                    .iter()
                    .any(|it| it.fix == suggestion.fix)
                {
                    typed_report.suggestions.push(suggestion);
                }
            }
        }
        let mut is_hidden = is_hidden.into_iter();
        let before = messages.len();
        messages.retain(|_| is_hidden.next() == Some(false));
        messages.len() != before
    }

    /// oxlint's `help`. Empty if there is none.
    pub fn help(&self) -> &str {
        self.text(Part::Help, |it| &it.help)
    }

    /// oxlint's label at the message's position. Empty if there is none.
    pub fn first_label(&self) -> &str {
        self.text(Part::FirstLabel, |it| &it.first_label)
    }

    /// oxlint's `note`. Empty if there is none.
    pub fn note(&self) -> &str {
        self.text(Part::Note, |it| &it.note)
    }

    fn text(&self, part: Part, select_field: fn(&Details) -> &str) -> &str {
        match self.details.as_deref().map(select_field) {
            Some(selected) if !selected.is_empty() => selected,
            _ => self.constant_help.map_or("", |it| it.constant(part)),
        }
    }
}

/// True where a JavaScript rule passed something other than a number for `line` or `column`. ESLint keeps such a
/// report. The field is then 0, which is what ESLint's `stylish` prints, and `null` in JSON.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NotNumbers {
    pub line: bool,
    pub column: bool,
}

/// A report's [`Details`](crate::context::Details), with lines and columns like the message's.
#[derive(Clone, Debug, Default)]
pub struct Details {
    pub first_label: Cow<'static, str>,
    /// Each label's start, end and text.
    pub labels: Vec<((u32, u32), (u32, u32), Cow<'static, str>)>,
    pub help: Cow<'static, str>,
    pub note: Cow<'static, str>,
    /// 1038 means that oxlint's `code` for the message, which doesn't come from a rule, is `TS(1038)`. 0 means it has
    /// none.
    pub typescript_code: u16,
}

impl Default for LintMessage {
    /// An error from the linter itself, with no text and no position. It's for `..LintMessage::default()`, so code that
    /// builds a message keeps compiling when fields are added.
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
            claim: None,
            fix: None,
            suggestions: Vec::new(),
            suppressions: Vec::new(),
            comments_apply_at: None,
            not_numbers: NotNumbers::default(),
            details: None,
            constant_help: None,
            reported: 0,
        }
    }
}

/// Converts offsets to the positions ESLint reports.
pub(crate) struct Locator<'a> {
    file: &'a File<'a>,
}

impl<'a> Locator<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Locator { file }
    }

    /// The line, and the 1-based column.
    pub(crate) fn position(&self, offset: u32) -> (u32, u32) {
        let at = self.file.position(offset);
        (at.line, at.column + 1)
    }

    /// The same for `span`'s start and end.
    #[inline]
    pub(crate) fn positions(&self, span: Span) -> ((u32, u32), (u32, u32)) {
        let (start, end) = self.file.positions(span);
        ((start.line, start.column + 1), (end.line, end.column + 1))
    }

    /// `createLintingProblem`: a message from the linter itself at `span`.
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
            claim: None,
            fix: None,
            suggestions: Vec::new(),
            suppressions: Vec::new(),
            comments_apply_at: None,
            not_numbers: NotNumbers::default(),
            details: None,
            constant_help: None,
            reported: 0,
        }
    }
}

// ───────────────────────────── as JSON ─────────────────────────────

/// `JSON.stringify(value)`
pub fn write_json(out: &mut Vec<u8>, value: &Json) {
    write_json_with(out, value, |out, number| match number.is_finite() {
        true => out.extend_from_slice(bun_core::fmt::FormatDouble::dtoa(&mut [0; 124], number)),
        false => out.extend_from_slice(b"null"),
    });
}

/// [`write_json`] with a custom way to write numbers. It doesn't recurse, so it can write the options from a comment,
/// which can be nested arbitrarily deep.
pub(crate) fn write_json_with(
    out: &mut Vec<u8>,
    mut value: &Json,
    write_number: fn(&mut Vec<u8>, f64),
) {
    // The arrays and objects around `value`, each with the number of its children already written.
    let mut open: Vec<(&Json, usize)> = Vec::new();
    loop {
        match value {
            Json::Null => out.extend_from_slice(b"null"),
            Json::Bool(value) => out.extend_from_slice(if *value { b"true" } else { b"false" }),
            Json::Number(value) => write_number(out, *value),
            Json::String(value) => json_stringify(value, out),
            Json::Array(_) => {
                out.push(b'[');
                open.push((value, 0));
            }
            Json::Object(_) => {
                out.push(b'{');
                open.push((value, 0));
            }
        }
        value = loop {
            let Some((parent, written_count)) = open.last_mut() else {
                return;
            };
            let at = *written_count;
            *written_count += 1;
            let comma: &[u8] = if at > 0 { b"," } else { b"" };
            match parent {
                Json::Array(items) => match items.get(at) {
                    Some(item) => {
                        out.extend_from_slice(comma);
                        break item;
                    }
                    None => out.push(b']'),
                },
                Json::Object(entries) => match entries.get(at) {
                    Some((key, value)) => {
                        out.extend_from_slice(comma);
                        json_stringify(key, out);
                        out.push(b':');
                        break value;
                    }
                    None => out.push(b'}'),
                },
                _ => {}
            }
            open.pop();
        };
    }
}

/// `JSON.stringify(value, null, 2)`
pub fn write_json_indented(out: &mut Vec<u8>, value: &Json, depth: usize) {
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
                json_stringify(key, out);
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
        // `Array.prototype.join` is recursive too, and throws where this stops.
        Json::Array(_) if !bun_core::StackCheck::init().is_safe_to_recurse() => {}
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

/// Converts byte offsets to UTF-16 code unit offsets, which is what ESLint's `range` uses. Fast if the offsets are
/// requested in ascending order.
pub struct Utf16Offsets<'t> {
    text: &'t [u8],
    is_ascii: bool,
    /// A byte offset and what it converts to.
    last: (u32, u32),
}

impl<'t> Utf16Offsets<'t> {
    /// A byte order mark at the start of `text` isn't counted, as in ESLint, where it's at -1.
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
        // Offsets past the end of the text are carried over one to one.
        let beyond = offset.saturating_sub(self.text.len() as u32);
        let offset = offset - beyond;
        if offset < self.last.0 || self.last.0 < start {
            self.last = (start, 0);
        }
        let between = &self.text[self.last.0 as usize..offset as usize];
        self.last = (
            offset,
            self.last.1 + bun_core::strings::utf8_decoded_len_utf16(between),
        );
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
    json_stringify(&fix.text, out);
    out.push(b'}');
}

/// Writes `,"data":{..}` if the rule passed any data.
fn write_data(out: &mut Vec<u8>, suggestion: &Suggestion) {
    let texts = match &suggestion.data {
        Data::None => return,
        Data::Json(json) => {
            out.extend_from_slice(b",\"data\":");
            return out.extend_from_slice(json);
        }
        Data::Texts(texts) => texts,
    };
    out.extend_from_slice(b",\"data\":{");
    for (i, (name, value)) in texts.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        json_stringify(name.as_bytes(), out);
        out.push(b':');
        json_stringify(value, out);
    }
    out.push(b'}');
}

impl LintMessage {
    /// Sorts by line and column. The sort is stable. Most lists are already sorted.
    pub fn sort(messages: &mut [LintMessage]) {
        let sort_key = |it: &LintMessage| (it.line as i32, it.column as i32);
        if !messages.is_sorted_by_key(sort_key) {
            crate::utils::sort::sort_by_key(messages, sort_key);
        }
    }

    /// The line and column to jump to. A report before the first line maps to the start of the file, and one before the
    /// first column maps to the start of the line.
    pub fn line_and_column(&self) -> (u32, u32) {
        let is_of_rule = !matches!(self.rule_id, None | Some(RuleId::Unknown(_)));
        match is_of_rule && self.line as i32 <= 0 {
            true => (1, 1),
            false => (self.line, (self.column as i32).max(0) as u32),
        }
    }

    /// Used where there's no ESLint to match. ESLint's own formats print whatever the rule passed. After this, the
    /// message starts at [`LintMessage::line_and_column`] in every format and doesn't end before that.
    pub(crate) fn clamp_to_file(&mut self) {
        let signed = |(line, column): (u32, u32)| (line as i32, column as i32);
        let clamped_start = self.line_and_column();
        (self.line, self.column) = clamped_start;
        self.end = self.end.filter(|end| signed(*end) >= signed(clamped_start));
        self.not_numbers = NotNumbers::default();
    }

    /// Writes it the way ESLint's `json` formatter does.
    pub fn write_json(&self, out: &mut Vec<u8>, offsets: &mut Utf16Offsets) {
        use std::io::Write;
        out.extend_from_slice(b"{\"ruleId\":");
        match &self.rule_id {
            Some(id) => json_stringify(&id.to_vec(), out),
            None => out.extend_from_slice(b"null"),
        }
        // ESLint builds the linter's own messages, other than parse errors, with a different function, which puts
        // `severity` last.
        let is_severity_last = self.message_id.is_none() && (!self.is_fatal || self.end.is_some());
        if !is_severity_last {
            if self.is_fatal {
                out.extend_from_slice(b",\"fatal\":true");
            }
            let _ = write!(out, ",\"severity\":{}", self.severity as u8);
        }
        out.extend_from_slice(b",\"message\":");
        json_stringify(&self.message, out);
        if !self.is_fatal || self.line != 0 {
            for (key, number, is_null) in [
                ("line", self.line, self.not_numbers.line),
                ("column", self.column, self.not_numbers.column),
            ] {
                let _ = match is_null {
                    true => write!(out, ",\"{key}\":null"),
                    false => write!(out, ",\"{key}\":{}", number as i32),
                };
            }
        }
        if let Some(id) = self.message_id.as_deref().filter(|it| !it.is_empty()) {
            out.extend_from_slice(b",\"messageId\":");
            json_stringify(id.as_bytes(), out);
        }
        if let Some((line, column)) = self.end {
            let (line, column) = (line as i32, column as i32);
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
                // A rule without ids writes `desc` itself, and it comes first.
                if suggestion.message_id.is_empty() {
                    out.extend_from_slice(b"{\"desc\":");
                    json_stringify(&suggestion.message, out);
                    write_data(out, suggestion);
                    out.extend_from_slice(b",\"fix\":");
                    write_fix(out, &suggestion.fix, offsets);
                    out.push(b'}');
                    continue;
                }
                out.extend_from_slice(b"{\"messageId\":");
                json_stringify(suggestion.message_id.as_bytes(), out);
                write_data(out, suggestion);
                out.extend_from_slice(b",\"fix\":");
                write_fix(out, &suggestion.fix, offsets);
                out.extend_from_slice(b",\"desc\":");
                json_stringify(&suggestion.message, out);
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
                json_stringify(&suppression.justification, out);
                out.push(b'}');
            }
            out.push(b']');
        }
        out.push(b'}');
    }
}
