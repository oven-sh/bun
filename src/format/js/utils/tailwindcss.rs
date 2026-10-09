//! oxfmt's `sortTailwindcss` in JavaScript: which strings are lists of classes, and what stays of the white space at their
//! ends.
//!
//! A port of `oxc_formatter/src/utils/tailwindcss.rs`, which follows `prettier-plugin-tailwindcss`. What is written
//! is in a context, the last of a stack: `JsFormatContext::tailwind_context`.

use super::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::tailwind::Tailwind;

/// What is written is in the value of an attribute, or among the arguments of a function, that takes classes.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TailwindContext {
    pub(crate) preserves_whitespace: bool,
    /// It is between the `${` and the `}` of a template.
    is_in_template_expression: bool,
    /// The text before that `${` ends with white space.
    has_whitespace_before: bool,
    /// The text behind that `}` starts with white space.
    has_whitespace_behind: bool,
    /// What the `+` around the template that is written leave of the white space at its ends.
    around_template: Collapse,
    /// It is in a call of another function. A string there is not sorted.
    pub(crate) is_disabled: bool,
}

/// Whether the white space at the start and at the end of a text can go. If not, one blank stays of it.
#[derive(Clone, Copy, Debug)]
struct Collapse {
    start: bool,
    end: bool,
}

impl Collapse {
    const ALL: Collapse = Collapse {
        start: true,
        end: true,
    };
}

#[inline]
pub(crate) fn has_white_space(text: &[u8]) -> bool {
    text.iter().any(u8::is_ascii_whitespace)
}

fn starts_with_white_space(text: &[u8]) -> bool {
    text.first().is_some_and(u8::is_ascii_whitespace)
}

fn ends_with_white_space(text: &[u8]) -> bool {
    text.last().is_some_and(u8::is_ascii_whitespace)
}

impl TailwindContext {
    /// For the value of an attribute and for the arguments of a function.
    fn new(tailwind: &Tailwind) -> Self {
        TailwindContext {
            preserves_whitespace: tailwind.preserves_whitespace,
            is_in_template_expression: false,
            has_whitespace_before: true,
            has_whitespace_behind: true,
            around_template: Collapse::ALL,
            is_disabled: false,
        }
    }

    /// For the template `e`.
    pub(crate) fn in_template(self, e: Expr<'_>) -> Self {
        TailwindContext {
            around_template: collapse_in_concatenation(e.span(), e.ast_parent()),
            ..self
        }
    }

    /// For what is between `${` and `}`, `before` and `behind` which these texts are.
    pub(crate) fn in_template_expression(self, before: &[u8], behind: &[u8]) -> Self {
        TailwindContext {
            preserves_whitespace: self.preserves_whitespace,
            is_in_template_expression: true,
            has_whitespace_before: ends_with_white_space(before),
            has_whitespace_behind: starts_with_white_space(behind),
            around_template: Collapse::ALL,
            is_disabled: false,
        }
    }

    /// What the template around it leaves of the white space at the ends of what is written.
    fn collapse(self) -> Collapse {
        Collapse {
            start: !self.is_in_template_expression || self.has_whitespace_before,
            end: !self.is_in_template_expression || self.has_whitespace_behind,
        }
    }
}

/// `content`, written in a context if there is one.
pub(crate) struct InTailwindContext<T>(pub(crate) Option<TailwindContext>, pub(crate) T);

impl<'a, T: Format<'a>> Format<'a> for InTailwindContext<T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if let Some(context) = self.0 {
            f.context_mut().push_tailwind_context(context);
        }
        self.1.fmt(f);
        if self.0.is_some() {
            f.context_mut().pop_tailwind_context();
        }
    }
}

/// The context for the arguments of `callee`, or for the template that it is the tag of, if they are classes.
pub(crate) fn context_of_function(callee: Expr<'_>, f: &Formatter<'_>) -> Option<TailwindContext> {
    (f.options().tailwind.as_deref())
        .filter(|tailwind| is_class_function(callee, tailwind))
        .map(TailwindContext::new)
}

/// The context for the value of the JSX attribute called `name`, if it is classes.
pub(crate) fn context_of_attribute(name: &[u8], f: &Formatter<'_>) -> Option<TailwindContext> {
    (f.options().tailwind.as_deref())
        .filter(|tailwind| is_class_attribute(name, tailwind))
        .map(TailwindContext::new)
}

/// The context of the string literal `source`, if it is to be sorted: one class is not.
pub(crate) fn context_of_string(source: &[u8], f: &Formatter<'_>) -> Option<TailwindContext> {
    f.context()
        .tailwind_context()
        .filter(|context| !context.is_disabled && has_white_space(source))
}

/// Whether the value of the JSX attribute called `name` is classes.
fn is_class_attribute(name: &[u8], tailwind: &Tailwind) -> bool {
    matches!(name, b"class" | b"className")
        || (!bun_core::strings::contains_char(name, b':')
            && tailwind.attributes.iter().any(|it| it == name))
}

/// Whether the arguments of `callee` are classes: `cn`, `cn.a`, `cn()`. The plugin's `isSortableExpression`.
fn is_class_function(callee: Expr<'_>, tailwind: &Tailwind) -> bool {
    if tailwind.functions.is_empty() {
        return false;
    }
    let mut node = callee;
    loop {
        node = match node.kind() {
            ExprKind::Call(call) => call.callee(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Ident(_) => return tailwind.functions.iter().any(|it| it == node.text()),
            _ => return false,
        };
    }
}

/// What `a + .. + b` leaves of the white space at the ends of what is at `span` in `parent`: what is added to has to stay
/// apart. The plugin's `canCollapseWhitespaceIn`.
fn collapse_in_concatenation(span: Span, parent: AstNodes<'_>) -> Collapse {
    let mut collapse = Collapse::ALL;
    for ancestor in parent.ancestors() {
        match ancestor {
            AstNodes::BinaryExpression(binary) => {
                let ExprKind::Binary {
                    op: BinOp::Add,
                    left,
                    right,
                } = binary.kind()
                else {
                    break;
                };
                let contains = |operand: Expr<'_>| {
                    operand.span().start <= span.start && span.end <= operand.span().end
                };
                collapse.end &= !contains(left);
                collapse.start &= !contains(right);
                if !collapse.start && !collapse.end {
                    break;
                }
            }
            AstNodes::ConditionalExpression(_)
            | AstNodes::TSAsExpression(_)
            | AstNodes::TSSatisfiesExpression(_)
            | AstNodes::TSNonNullExpression(_)
            | AstNodes::TSTypeAssertion(_) => {}
            _ => break,
        }
    }
    collapse
}

/// What is written for the string literal `source`, which is at `span` in `parent`. `is_jsx`: it is the value of an
/// attribute.
pub(crate) fn sorted_string_literal<'a>(
    source: &'a [u8],
    is_jsx: bool,
    (span, parent): (Span, AstNodes<'a>),
    context: TailwindContext,
    f: &Formatter<'a>,
) -> Vec<u8> {
    let normalized =
        FormatLiteralStringToken::new(source, is_jsx, StringLiteralParentKind::Expression)
            .clean_text(f)
            .into_text();
    let (Some(tailwind), [quote, content @ .., _]) =
        (f.options().tailwind.as_deref(), &*normalized)
    else {
        return normalized.into_owned();
    };
    let mut printed = Vec::with_capacity(normalized.len());
    printed.push(*quote);
    let trimmed = content.trim_ascii();
    if context.preserves_whitespace {
        printed.extend_from_slice(&tailwind.sorted(content));
    } else if trimmed.is_empty() {
        printed.extend(content.first().map(|_| b' '));
    } else {
        let (inner, outer) = (context.collapse(), collapse_in_concatenation(span, parent));
        if starts_with_white_space(content) && !(inner.start && outer.start) {
            printed.push(b' ');
        }
        printed.extend_from_slice(&tailwind.sorted(trimmed));
        if ends_with_white_space(content) && !(inner.end && outer.end) {
            printed.push(b' ');
        }
    }
    printed.push(*quote);
    printed
}

/// `text`, which is between two `${}` of a template or at an end of it, in three parts: a class that touches the `}`
/// before it, what can be sorted, a class that touches the `${` behind it.
fn split_template_text(text: &[u8], is_first: bool, is_last: bool) -> (&[u8], &[u8], &[u8]) {
    let is_white_space = |byte: &u8| byte.is_ascii_whitespace();
    let prefix_end = match !is_first && !starts_with_white_space(text) {
        true => text.iter().position(is_white_space),
        false => None,
    };
    let suffix_start = match !is_last && !ends_with_white_space(text) {
        true => text.iter().rposition(is_white_space).map(|at| at + 1),
        false => None,
    };
    let (prefix_end, suffix_start) = match (prefix_end, suffix_start) {
        (Some(prefix_end), Some(suffix_start)) if prefix_end < suffix_start => {
            (prefix_end, suffix_start)
        }
        (Some(prefix_end), _) => (prefix_end, text.len()),
        (None, Some(suffix_start)) => (0, suffix_start),
        (None, None) => (0, text.len()),
    };
    let (rest, suffix) = text.split_at(suffix_start);
    let (prefix, sortable) = rest.split_at(prefix_end);
    (prefix, sortable, suffix)
}

/// What is written for `text`, which is text of a template. `is_first`, `is_last`: of the texts of the template.
pub(crate) fn sorted_template_text(
    text: &[u8],
    (is_first, is_last): (bool, bool),
    context: TailwindContext,
    tailwind: &Tailwind,
) -> Vec<u8> {
    let (prefix, sortable, suffix) = split_template_text(text, is_first, is_last);
    let mut printed = Vec::with_capacity(text.len());
    printed.extend_from_slice(prefix);
    let trimmed = sortable.trim_ascii();
    if context.preserves_whitespace {
        printed.extend_from_slice(&tailwind.sorted(sortable));
    } else if trimmed.is_empty() {
        printed.extend(sortable.first().map(|_| b' '));
    } else {
        // Only the ends of the template have something else than its own `${}` next to them.
        let (inner, outer) = (context.collapse(), context.around_template);
        let is_at_an_end = is_first || is_last;
        let keeps_start = is_at_an_end && !(inner.start && outer.start);
        let keeps_end = is_at_an_end && !(inner.end && outer.end);
        if !is_first || !prefix.is_empty() || (starts_with_white_space(sortable) && keeps_start) {
            printed.push(b' ');
        }
        printed.extend_from_slice(&tailwind.sorted(trimmed));
        if !is_last || !suffix.is_empty() || (ends_with_white_space(sortable) && keeps_end) {
            printed.push(b' ');
        }
    }
    printed.extend_from_slice(suffix);
    printed
}
