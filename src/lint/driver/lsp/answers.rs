//! What the linter and the formatter say, in the words of the protocol: diagnostics, code actions and edits.

use super::rpc::{number, object, text};
use super::text::{Lines, Range, range_to_json};
use crate::embedded::Framework;
use crate::format::oxlint::Offsets;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::fix::Fix;
use bun_lint::linter::{LintMessage, RuleId};
use bun_lint::options::Json;
use bun_lint::rule::{Meta, Plugin};

pub(crate) const QUICK_FIX: &[u8] = b"quickfix";
pub(crate) const FIX_ALL: &[u8] = b"source.fixAll.bun";
const FIX_ALL_TITLE: &[u8] = b"Fix all auto-fixable problems";

/// Whether a client that asks for the kinds `only` wants `kind`: `source` is for `source.fixAll.bun` too. `None`: it wants what
/// goes with a place in the text.
pub(crate) fn wants(only: Option<&[Vec<u8>]>, kind: &[u8]) -> bool {
    match only {
        None => kind == QUICK_FIX,
        Some(only) => only.iter().any(|it| {
            (kind.strip_prefix(&it[..])).is_some_and(|rest| rest.is_empty() || rest[0] == b'.')
        }),
    }
}

/// `DiagnosticTag`
#[derive(Copy, Clone)]
enum Tag {
    Unnecessary = 1,
    Deprecated = 2,
}

/// How an editor shows what the rule reports: faded, or struck out.
fn tag_of(meta: &Meta) -> Option<Tag> {
    match (meta.plugin, meta.name) {
        (
            Plugin::Eslint | Plugin::TypeScript,
            "no-unused-vars"
            | "no-unused-labels"
            | "no-unused-private-class-members"
            | "no-unreachable"
            | "no-unreachable-loop"
            | "no-unused-expressions",
        ) => Some(Tag::Unnecessary),
        (Plugin::TypeScript, "no-deprecated") | (Plugin::Node, "no-deprecated-api") => {
            Some(Tag::Deprecated)
        }
        _ => None,
    }
}

fn meta_of(message: &LintMessage) -> Option<&'static Meta> {
    match message.rule_id.as_ref()? {
        RuleId::Known(meta) | RuleId::Named(meta, _) => Some(meta),
        RuleId::Js(_) | RuleId::Unknown(_) => None,
    }
}

/// A document, with what it takes to say where something is in it.
pub(crate) struct Places<'t> {
    pub(crate) uri: &'t [u8],
    pub(crate) version: &'t Json,
    pub(crate) path: &'t [u8],
    text: &'t [u8],
    pub(crate) lines: Lines<'t>,
    /// For the lines and columns of a message.
    offsets: Offsets<'t>,
    /// The client takes `documentChanges`, which name the version that they are for.
    pub(crate) has_versioned_edits: bool,
}

impl<'t> Places<'t> {
    pub(crate) fn new(
        (uri, version, path): (&'t [u8], &'t Json, &'t [u8]),
        lines: Lines<'t>,
        text: &'t [u8],
        has_versioned_edits: bool,
    ) -> Places<'t> {
        Places {
            uri,
            version,
            path,
            text,
            lines,
            offsets: Offsets::new(text, None),
            has_versioned_edits,
        }
    }

    /// Where `message` starts and ends, in bytes. One without a place is at the start.
    fn span_of(&self, message: &LintMessage) -> (usize, usize) {
        if message.line == 0 {
            return (0, 0);
        }
        let start = self.offsets.at(message.line, message.column).0;
        let end = message
            .end
            .map(|(line, column)| self.offsets.at(line, column).0);
        (start, end.unwrap_or(start).max(start))
    }

    fn range_of(&self, message: &LintMessage) -> Range {
        let (start, end) = self.span_of(message);
        self.lines.range(start, end)
    }

    pub(crate) fn diagnostic(&self, message: &LintMessage) -> Json {
        let is_error = message.is_fatal || message.severity == Severity::Error;
        let mut entries = vec![
            ("range", range_to_json(self.range_of(message))),
            ("severity", number(if is_error { 1 } else { 2 })),
        ];
        if let Some(id) = &message.rule_id {
            entries.push(("code", Json::String(id.to_vec())));
        }
        if let Some(meta) = meta_of(message) {
            let page = object([("href", Json::String(meta.docs_url()))]);
            entries.push(("codeDescription", page));
            if let Some(tag) = tag_of(meta) {
                entries.push(("tags", Json::Array(vec![number(tag as u32)])));
            }
        }
        entries.push(("source", text(b"bun")));
        entries.push(("message", text(&message.message)));
        let entries = entries.into_iter();
        Json::Object(
            entries
                .map(|(key, value)| (key.as_bytes().to_vec(), value))
                .collect(),
        )
    }

    fn edit(&self, (start, end): (usize, usize), new: &[u8]) -> Json {
        object([
            ("range", range_to_json(self.lines.range(start, end))),
            ("newText", text(new)),
        ])
    }

    fn edit_of(&self, fix: &Fix) -> Json {
        self.edit((fix.span.start as usize, fix.span.end as usize), &fix.text)
    }

    /// The edits that make `new` of the text, line by line. `within`: only those that touch these bytes.
    pub(crate) fn edits_to(&self, new: &[u8], within: Option<(usize, usize)>) -> Vec<Json> {
        let hunks = bun_text_diff::diff_lines(self.text, new).into_iter();
        let hunks =
            hunks.filter(|it| within.is_none_or(|(start, end)| it.a_lo <= end && start <= it.a_hi));
        hunks
            .map(|it| self.edit((it.a_lo, it.a_hi), &new[it.b_lo..it.b_hi]))
            .collect()
    }

    /// `WorkspaceEdit`
    fn in_this_document(&self, edits: Vec<Json>) -> Json {
        let edits = Json::Array(edits);
        if !self.has_versioned_edits {
            return object([("changes", Json::Object(vec![(self.uri.to_vec(), edits)]))]);
        }
        let document = object([("uri", text(self.uri)), ("version", self.version.clone())]);
        let change = object([("textDocument", document), ("edits", edits)]);
        object([("documentChanges", Json::Array(vec![change]))])
    }

    fn action(
        &self,
        title: &[u8],
        kind: &[u8],
        about: Option<&LintMessage>,
        edits: Vec<Json>,
    ) -> Json {
        let mut entries = vec![("title", text(title)), ("kind", text(kind))];
        if let Some(message) = about {
            entries.push(("diagnostics", Json::Array(vec![self.diagnostic(message)])));
        }
        entries.push(("edit", self.in_this_document(edits)));
        let entries = entries.into_iter();
        Json::Object(
            entries
                .map(|(key, value)| (key.as_bytes().to_vec(), value))
                .collect(),
        )
    }

    /// `kind`: [`QUICK_FIX`] or [`FIX_ALL`]. `fixed`: the text with all fixes.
    pub(crate) fn fix_all(&self, kind: &[u8], fixed: &[u8]) -> Json {
        self.action(FIX_ALL_TITLE, kind, None, self.edits_to(fixed, None))
    }

    /// A comment above the line of `message` that turns `rule` off for it. One that is there already gets one more rule.
    fn disable_for_line(&self, message: &LintMessage, rule: &[u8], tool: &[u8]) -> Json {
        let line = self.range_of(message).0.line;
        let (start, end) = self.lines.line(line);
        let comment = [b"// ", tool, b"-disable-next-line "].concat();
        if let Some(above) = line.checked_sub(1) {
            let (_, end) = self.lines.line(above);
            let written = self.text[self.lines.line(above).0..end].trim_ascii();
            if written.starts_with(&comment) && !strings::contains(written, b" -- ") {
                let end = end - (self.text[..end].len() - self.text[..end].trim_ascii_end().len());
                return self.edit((end, end), &[b", ", rule].concat());
            }
        }
        let content = &self.text[start..end];
        let indentation = &content[..content.len() - content.trim_ascii_start().len()];
        let new = [indentation, &comment, rule, self.lines.line_break()].concat();
        self.edit((start, start), &new)
    }

    /// A comment at the top that turns `rule` off.
    fn disable_for_file(&self, rule: &[u8], tool: &[u8]) -> Json {
        let after_mark = self.text.len() - strings::without_utf8_bom(self.text).len();
        let at = match self.text[after_mark..].starts_with(b"#!") {
            true => self.lines.line(1).0,
            false => after_mark,
        };
        let line_break = self.lines.line_break();
        // The interpreter's line is the last.
        let before: &[u8] =
            match at == self.text.len() && at > after_mark && self.lines.line(0).1 == at {
                true => line_break,
                false => b"",
            };
        let new = [before, b"/* ", tool, b"-disable ", rule, b" */", line_break].concat();
        self.edit((at, at), &new)
    }

    /// The quick fixes for those of `messages` that touch `range`. `is_oxlint`: the configuration is one of oxlint.
    pub(crate) fn quick_fixes(
        &self,
        messages: &[LintMessage],
        range: Range,
        is_oxlint: bool,
    ) -> Vec<Json> {
        let tool: &[u8] = if is_oxlint { b"oxlint" } else { b"eslint" };
        let touches = |it: &&LintMessage| {
            let (start, end) = self.range_of(it);
            start <= range.1 && range.0 <= end
        };
        // In a component a script's comment is not one everywhere.
        let takes_comments = Framework::of(self.path).is_none();
        let mut actions = Vec::new();
        // The rules that are turned off for a line, and for the file.
        let (mut for_line, mut for_file) = (Vec::new(), Vec::new());
        for message in messages.iter().filter(touches) {
            let rule = message.rule_id.as_ref().map(RuleId::to_vec);
            if let Some(fix) = &message.fix {
                let title = match &rule {
                    Some(rule) => [b"Fix ", &rule[..]].concat(),
                    None => b"Remove unused comment".to_vec(),
                };
                let mut action =
                    self.action(&title, QUICK_FIX, Some(message), vec![self.edit_of(fix)]);
                if let Json::Object(entries) = &mut action {
                    entries.push((b"isPreferred".to_vec(), Json::Bool(true)));
                }
                actions.push(action);
            }
            for suggestion in &message.suggestions {
                let edits = vec![self.edit_of(&suggestion.fix)];
                actions.push(self.action(&suggestion.message, QUICK_FIX, Some(message), edits));
            }
            let Some(rule) = rule.filter(|_| takes_comments) else {
                continue;
            };
            let line = (self.range_of(message).0.line, rule);
            if !for_line.contains(&line) {
                let title = [b"Disable ", &line.1[..], b" for this line"].concat();
                let edits = vec![self.disable_for_line(message, &line.1, tool)];
                for_line.push(line);
                actions.push(self.action(&title, QUICK_FIX, Some(message), edits));
            }
        }
        for (_, rule) in for_line {
            if !for_file.contains(&rule) {
                let title = [b"Disable ", &rule[..], b" for this file"].concat();
                let edits = vec![self.disable_for_file(&rule, tool)];
                actions.push(self.action(&title, QUICK_FIX, None, edits));
                for_file.push(rule);
            }
        }
        actions
    }
}
