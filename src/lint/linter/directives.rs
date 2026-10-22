//! Finds a file's comments that configure the linter.

use super::comment::{Space, parse_directive, parse_json_like_config};
use super::severity_of;
use crate::ast::File;
use crate::context::Severity;
use crate::options::Json;
use crate::span::Span;
use crate::tokens::TokenKind;
use bun_core::strings;

/// The label at the start of a comment that configures the linter.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Label {
    /// `eslint`
    Rules,
    /// `eslint-env`
    Env,
    /// `eslint-enable`
    Enable,
    /// `eslint-disable`
    Disable,
    /// `eslint-disable-line`
    DisableLine,
    /// `eslint-disable-next-line`
    DisableNextLine,
    /// `exported`
    Exported,
    /// `global`, `globals`
    Global,
}

impl Label {
    /// `oxlint-disable` and the like mean the same as `eslint-disable` with an oxlint config:
    /// [`ResolvedConfig::understands_oxlint_comments`](super::ResolvedConfig::understands_oxlint_comments).
    fn of(label: &[u8]) -> Option<Label> {
        Some(match label {
            b"eslint" => Label::Rules,
            b"eslint-env" => Label::Env,
            b"eslint-enable" | b"oxlint-enable" => Label::Enable,
            b"eslint-disable" | b"oxlint-disable" => Label::Disable,
            b"eslint-disable-line" | b"oxlint-disable-line" => Label::DisableLine,
            b"eslint-disable-next-line" | b"oxlint-disable-next-line" => Label::DisableNextLine,
            b"exported" => Label::Exported,
            b"global" | b"globals" => Label::Global,
            _ => return None,
        })
    }
}

/// A comment that configures the linter: an element of ESLint's `getInlineConfigNodes()`.
#[derive(Copy, Clone, Debug)]
pub(crate) struct ConfigComment {
    /// Includes the delimiters.
    pub(crate) span: Span,
    pub(crate) label: Label,
    pub(crate) label_span: Span,
    /// The text after the label, trimmed.
    pub(crate) value: Span,
    /// The text after ` -- `, trimmed.
    pub(crate) justification: Span,
    /// `// eslint-disable` or `// eslint-enable`. ESLint doesn't let a line comment apply to more than one line, so it
    /// treats these as ordinary comments.
    pub(crate) is_oxlint_only: bool,
}

/// True if `value`, a comment without its delimiters, could start with a label.
#[inline]
fn may_start_with_label(value: &[u8]) -> bool {
    // Or with non-ASCII whitespace.
    matches!(
        value.trim_ascii_start().first(),
        Some(b'e' | b'o' | b'g' | 0x0B | 0x80..)
    )
}

/// The range within `outer` of `inner`, which is a slice of it.
fn range_in(outer: &[u8], inner: &[u8]) -> Span {
    let start = (inner.as_ptr() as usize)
        .saturating_sub(outer.as_ptr() as usize)
        .min(outer.len());
    Span::new(start as u32, (start + inner.len()).min(outer.len()) as u32)
}

/// The file span of `part`, a slice of the comment value `value`, whose span is `value_span`. The value can live
/// outside the file's text: [`File::slice`].
fn span_in_value(value: &[u8], value_span: Span, part: &[u8]) -> Span {
    let start = (part.as_ptr().addr())
        .saturating_sub(value.as_ptr().addr())
        .min(value.len());
    let end = (start + part.len()).min(value.len());
    Span::new(
        value_span.start + start as u32,
        value_span.start + end as u32,
    )
}

/// The rules that `/* eslint .. */` comments in `text` turn on, by the names the comments use, for callers that need
/// them before the text is parsed. Every `/*` counts as a comment start, so ones inside strings or markup count too.
pub fn rules_turned_on_in_comments(text: &[u8]) -> Vec<Vec<u8>> {
    rules_in_comments(text, false)
}

/// The rules that `/* eslint .. */` comments in `text` configure in any way, including the ones they turn off: see
/// [`rules_turned_on_in_comments`].
pub fn rules_configured_in_comments(text: &[u8]) -> Vec<Vec<u8>> {
    rules_in_comments(text, true)
}

fn rules_in_comments(text: &[u8], with_off: bool) -> Vec<Vec<u8>> {
    let mut names = Vec::new();
    // The first `*/` after the last `/*`.
    let mut end = 0;
    let mut from = 0;
    while let Some(at) = strings::index_of(text.get(from..).unwrap_or_default(), b"/*") {
        let start = from + at + 2;
        from = start;
        if end < start {
            let rest = text.get(start..).unwrap_or_default();
            let Some(found) = strings::index_of(rest, b"*/") else {
                break;
            };
            end = start + found;
        }
        let value = text.get(start..end).unwrap_or_default();
        let behind_label = strings::trim_js_whitespace_start(value).strip_prefix(b"eslint");
        if behind_label.is_none_or(|it| strings::js_whitespace_len(it) == 0) {
            continue;
        }
        let Some(directive) = parse_directive(value, Space::Js) else {
            continue;
        };
        if Label::of(directive.label) != Some(Label::Rules) {
            continue;
        }
        let Ok(rules) = parse_json_like_config(directive.value) else {
            continue;
        };
        for (id, value) in rules {
            let first = match &value {
                Json::Array(items) => items.first(),
                value => Some(value),
            };
            if with_off || first.and_then(severity_of) != Some(Severity::Off) {
                names.push(id);
            }
        }
    }
    names
}

/// `getInlineConfigNodes` as the languages in ESLint's own plugins implement it. Any kind of comment can have any of
/// these labels, and no other labels are recognized.
fn config_comments_of_language(
    text: &[u8],
    parsed: &crate::languages::Parsed,
) -> Vec<ConfigComment> {
    let found = parsed.comments.iter().filter_map(|comment| {
        let joined = parsed.joined.iter().find(|it| it.value() == comment.value);
        let value = match joined {
            Some(joined) => joined.text(),
            None => text.get(comment.value.range())?,
        };
        let span_of = |part: &[u8]| match joined {
            Some(joined) => joined.span_of(range_in(value, part).range()),
            None => range_in(text, part),
        };
        let directive =
            parse_directive(value, Space::Js).filter(|_| may_start_with_label(value))?;
        let label = Label::of(directive.label).filter(|it| {
            directive.label.starts_with(b"eslint")
                && matches!(
                    it,
                    Label::Rules
                        | Label::Enable
                        | Label::Disable
                        | Label::DisableLine
                        | Label::DisableNextLine
                )
        })?;
        Some(ConfigComment {
            is_oxlint_only: false,
            span: comment.span,
            label,
            label_span: span_of(directive.label),
            value: span_of(directive.value),
            justification: span_of(directive.justification),
        })
    });
    found.collect()
}

/// ESLint's `getInlineConfigNodes`.
pub(crate) fn config_comments<'a>(file: &'a File<'a>) -> Vec<ConfigComment> {
    let text = file.text();
    if let Some(parsed) = file.parsed() {
        return config_comments_of_language(text, parsed);
    }
    let space = match file.language().is_oxlint {
        true => Space::Unicode,
        false => Space::Js,
    };
    let mut comments = Vec::new();
    for comment in file.comments() {
        let (span, is_line) = match comment.kind() {
            TokenKind::Line => (comment.span(), true),
            TokenKind::Block => (comment.span(), false),
            _ => continue,
        };
        let (value, value_span) = (comment.comment_value(), comment.comment_value_span());
        if !may_start_with_label(value) {
            continue;
        }
        let Some(directive) = parse_directive(value, space) else {
            continue;
        };
        let Some(label) = Label::of(directive.label) else {
            continue;
        };
        let is_oxlint_only = is_line && matches!(label, Label::Disable | Label::Enable);
        if is_line
            && !is_oxlint_only
            && !matches!(label, Label::DisableLine | Label::DisableNextLine)
        {
            continue;
        }
        comments.push(ConfigComment {
            is_oxlint_only,
            span,
            label,
            label_span: span_in_value(value, value_span, directive.label),
            value: span_in_value(value, value_span, directive.value),
            justification: span_in_value(value, value_span, directive.justification),
        });
    }
    comments
}
