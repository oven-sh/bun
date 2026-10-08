//! Finds the comments of a file that configure the linter.

use super::comment::parse_directive;
use super::space::trim_end;
use crate::ast::File;
use crate::span::Span;
use crate::tokens::TokenKind;
use bun_core::strings;

/// What a comment that configures the linter starts with.
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
    /// `oxlint-disable` and the like mean what `eslint-disable` means, if the configuration is one of oxlint:
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
    /// With its delimiters.
    pub(crate) span: Span,
    pub(crate) label: Label,
    pub(crate) label_span: Span,
    /// What follows the label, trimmed.
    pub(crate) value: Span,
    /// What follows ` -- `, trimmed.
    pub(crate) justification: Span,
}

/// Where comments that may configure the linter start, in order: every `/*` and `//` that a label
/// follows. Whether it is in a string or in another comment is not known yet.
///
/// A file without any costs three searches for a substring.
pub fn candidates(text: &[u8]) -> Vec<u32> {
    let mut found = Vec::new();
    for needle in [&b"lint"[..], b"global", b"exported"] {
        let mut from = 0;
        while let Some(at) = strings::index_of(&text[from..], needle) {
            let at = from + at;
            from = at + needle.len();
            let label = match needle {
                b"lint" if text[..at].ends_with(b"es") || text[..at].ends_with(b"ox") => at - 2,
                b"lint" => continue,
                _ => at,
            };
            let before = trim_end(&text[..label]);
            if before.ends_with(b"/*") || needle == b"lint" && before.ends_with(b"//") {
                found.push(before.len() as u32 - 2);
            }
        }
    }
    found.sort_unstable();
    found.dedup();
    found
}

/// The range of `inner`, which is a slice of `outer`, in `outer`.
fn range_in(outer: &[u8], inner: &[u8]) -> Span {
    let start = (inner.as_ptr() as usize)
        .saturating_sub(outer.as_ptr() as usize)
        .min(outer.len());
    Span::new(start as u32, (start + inner.len()).min(outer.len()) as u32)
}

/// ESLint's `getInlineConfigNodes`.
pub(crate) fn config_comments<'a>(file: &'a File<'a>) -> Vec<ConfigComment> {
    let text = file.text();
    let candidates = candidates(text);
    if candidates.is_empty() {
        return Vec::new();
    }
    let comment_at = |start: u32| -> Option<(Span, bool)> {
        let comment = file
            .comments_in(Span::new(start, text.len() as u32))
            .next()?;
        (comment.start() == start).then(|| (comment.span(), comment.kind() == TokenKind::Line))
    };
    let mut comments = Vec::with_capacity(candidates.len());
    for start in candidates {
        let Some((span, is_line)) = comment_at(start) else {
            continue;
        };
        let value = file.slice(span.shrink(2, if is_line { 0 } else { 2 }));
        let Some(directive) = parse_directive(value) else {
            continue;
        };
        let Some(label) = Label::of(directive.label) else {
            continue;
        };
        if is_line && !matches!(label, Label::DisableLine | Label::DisableNextLine) {
            continue;
        }
        comments.push(ConfigComment {
            span,
            label,
            label_span: range_in(text, directive.label),
            value: range_in(text, directive.value),
            justification: range_in(text, directive.justification),
        });
    }
    comments
}
