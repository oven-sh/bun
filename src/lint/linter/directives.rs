//! Finds the comments of a file that configure the linter.

use super::comment::parse_directive;
use crate::ast::File;
use crate::span::Span;
use crate::tokens::TokenKind;

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
    /// `// eslint-disable`, `// eslint-enable`: a comment to the end of the line, which for ESLint cannot be about more than a
    /// line. It is a comment like any other for ESLint.
    pub(crate) is_only_of_oxlint: bool,
}

/// Whether `value`, which is a comment without its delimiters, can start with a label.
#[inline]
fn may_start_with_label(value: &[u8]) -> bool {
    // Or with whitespace that is not ASCII.
    matches!(value.trim_ascii_start().first(), Some(b'e' | b'o' | b'g' | 0x0B | 0x80..))
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
    let mut comments = Vec::new();
    for comment in file.comments() {
        let (span, is_line) = match comment.kind() {
            TokenKind::Line => (comment.span(), true),
            TokenKind::Block => (comment.span(), false),
            _ => continue,
        };
        let value = file.slice(span.shrink(2, if is_line { 0 } else { 2 }));
        if !may_start_with_label(value) {
            continue;
        }
        let Some(directive) = parse_directive(value) else {
            continue;
        };
        let Some(label) = Label::of(directive.label) else {
            continue;
        };
        let is_only_of_oxlint = is_line && matches!(label, Label::Disable | Label::Enable);
        if is_line
            && !is_only_of_oxlint
            && !matches!(label, Label::DisableLine | Label::DisableNextLine)
        {
            continue;
        }
        comments.push(ConfigComment {
            is_only_of_oxlint,
            span,
            label,
            label_span: range_in(text, directive.label),
            value: range_in(text, directive.value),
            justification: range_in(text, directive.justification),
        });
    }
    comments
}
