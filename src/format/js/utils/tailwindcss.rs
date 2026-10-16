//! oxfmt's `sortTailwindcss` in JavaScript: which strings are lists of classes, and what stays of the white space at their
//! ends.
//!
//! A port of `oxc_formatter/src/utils/tailwindcss.rs`, which follows `prettier-plugin-tailwindcss`. What is written
//! is in a context, the last of a stack: `JsFormatContext::tailwind_context`.
//!
//! Where the plugin itself has turned the sorting on, `Tailwind::follows_plugin`, its `transformJavaScript` counts. The stack
//! has one context then, and what is around a text says whether it is sorted: [`collapse_by_plugin`].

use super::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::options::HtmlRoot;
use crate::prelude::*;
use crate::tailwind::{Ends, Names, Oxc, Tailwind};
use smallvec::SmallVec;
use std::borrow::Cow;

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
    /// See [`Tailwind::follows_plugin`].
    pub(crate) follows_plugin: bool,
    /// The texts of the template that is written are sorted. oxfmt sorts all that are in a context.
    sorts_template: bool,
}

/// Whether the white space at the start and at the end of a text can go. If not, one blank stays of it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Collapse {
    pub(crate) start: bool,
    pub(crate) end: bool,
}

impl Collapse {
    pub(crate) const ALL: Collapse = Collapse {
        start: true,
        end: true,
    };

    /// What can go here, and also at the `start` and the `end`.
    fn and(self, start: bool, end: bool) -> Collapse {
        Collapse {
            start: self.start && start,
            end: self.end && end,
        }
    }
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
            follows_plugin: false,
            sorts_template: true,
        }
    }

    /// For all of a file in which the rules of the plugin count.
    pub(crate) fn of_plugin(tailwind: &Tailwind) -> Self {
        TailwindContext {
            follows_plugin: true,
            sorts_template: false,
            ..TailwindContext::new(tailwind)
        }
    }

    /// For the template `e`.
    pub(crate) fn in_template<'a>(self, e: Expr<'a>, f: &Formatter<'a>) -> Self {
        if self.follows_plugin {
            return self.in_template_at(e.span(), e.ast_parent(), f);
        }
        TailwindContext {
            around_template: collapse_in_concatenation(e.span(), e.ast_parent()),
            ..self
        }
    }

    /// For the template at `span` in `parent`, by the rules of the plugin.
    pub(crate) fn in_template_at<'a>(
        self,
        span: Span,
        parent: AstNodes<'a>,
        f: &Formatter<'a>,
    ) -> Self {
        let around = collapse_by_plugin(span, parent, f);
        TailwindContext {
            sorts_template: around.is_some(),
            around_template: around.unwrap_or(Collapse::ALL),
            ..self
        }
    }

    /// For what is between `${` and `}`, `before` and `behind` which these texts are.
    pub(crate) fn in_template_expression(self, before: &[u8], behind: &[u8]) -> Self {
        TailwindContext {
            is_in_template_expression: true,
            has_whitespace_before: ends_with_white_space(before),
            has_whitespace_behind: starts_with_white_space(behind),
            around_template: Collapse::ALL,
            is_disabled: false,
            sorts_template: !self.follows_plugin,
            ..self
        }
    }

    /// Whether the line breaks in the template that is written go.
    pub(crate) fn collapses_line_breaks(self) -> bool {
        self.sorts_template && !self.preserves_whitespace
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
        .filter(|tailwind| !tailwind.follows_plugin && is_class_function(callee, tailwind, f))
        .map(TailwindContext::new)
}

/// The context for the value of the JSX attribute called `name`, if it is classes.
pub(crate) fn context_of_attribute(name: &[u8], f: &Formatter<'_>) -> Option<TailwindContext> {
    (f.options().tailwind.as_deref())
        .filter(|tailwind| !tailwind.follows_plugin && is_class_attribute(name, tailwind))
        .map(TailwindContext::new)
}

/// The context of the string literal `source`, if it is to be sorted: one class is not.
pub(crate) fn context_of_string(source: &[u8], f: &Formatter<'_>) -> Option<TailwindContext> {
    f.context()
        .tailwind_context()
        .filter(|context| !context.is_disabled && has_white_space(source))
}

/// Whether the plugin has made one line of the string `e` by the time that Prettier looks at it.
pub(crate) fn loses_line_breaks<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    (f.context().tailwind_context()).is_some_and(|it| it.follows_plugin && !it.preserves_whitespace)
        && !bun_core::strings::contains(e.text(), b"{{")
        && collapse_by_plugin(e.span(), e.ast_parent(), f).is_some()
}

/// Whether the value of the JSX attribute called `name` is classes.
fn is_class_attribute(name: &[u8], tailwind: &Tailwind) -> bool {
    matches!(name, b"class" | b"className")
        || (!bun_core::strings::contains_char(name, b':')
            && has(&tailwind.attributes, name, tailwind))
}

/// oxfmt's own rules know no patterns.
fn has(names: &Names, name: &[u8], tailwind: &Tailwind) -> bool {
    names.has_name(name) || (tailwind.follows_plugin && names.has_pattern_for(name))
}

/// Whether `@prettier/plugin-oxc` reads what is written.
fn is_read_by_oxc(tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    tailwind.oxc != Oxc::Absent
        && (!f.context().has_tree_of_babel() || f.options().in_html.root == HtmlRoot::None)
}

/// Whether the plugin looks at the tree of Babel.
fn is_babel(tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    f.context().has_tree_of_babel() && !is_read_by_oxc(tailwind, f)
}

/// Whether what is in an optional chain with `e` is another kind of node to the plugin than a call or a member access: to
/// Babel every link from the `?.` on is, to the other parsers what is around the whole chain.
fn is_other_node_to_plugin(e: Expr<'_>, tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    match is_babel(tailwind, f) {
        true => e.is_in_optional_chain(),
        false => e.is_chain_root(),
    }
}

/// Whether the arguments of `callee` are classes: `cn`, `cn.a`, `cn()`. The plugin's `isSortableExpression`.
fn is_class_function(callee: Expr<'_>, tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    if tailwind.functions.is_empty() {
        return false;
    }
    let mut node = callee;
    loop {
        if tailwind.follows_plugin && is_other_node_to_plugin(node, tailwind, f) {
            return false;
        }
        node = match node.kind() {
            ExprKind::Call(call) => call.callee(),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Ident(_) => return has(&tailwind.functions, node.text(), tailwind),
            _ => return false,
        };
    }
}

/// What stays of the white space at the ends of the string or the template at `leaf` in `parent`, by the rules of the plugin.
/// `None`: it is not sorted. The plugin sorts all strings and templates in the value of an attribute and in an argument of a
/// function that take classes, however deep (`sortInside`), and the template behind such a function.
fn collapse_by_plugin<'a>(leaf: Span, parent: AstNodes<'a>, f: &Formatter<'a>) -> Option<Collapse> {
    let tailwind = f.options().tailwind.as_deref()?;
    if tailwind.oxc == Oxc::Behind && is_read_by_oxc(tailwind, f) {
        return None;
    }
    let is_in = |span: Span| span.start <= leaf.start && leaf.end <= span.end;
    // Each `+` and each template around it, from the inside to the outside.
    let mut around: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
    let (mut is_sorted, mut inner) = (false, None);
    for ancestor in parent.ancestors() {
        match ancestor {
            AstNodes::BinaryExpression(e) | AstNodes::TemplateLiteral(e) => around.push(e),
            AstNodes::TaggedTemplateExpression(e) if inner.is_none() => {
                is_sorted = matches!(e.kind(), ExprKind::TaggedTemplate(call) if is_class_function(call.callee(), tailwind, f));
            }
            // It goes by what is between it and the innermost of these.
            AstNodes::JSXAttribute(attribute)
                if matches!(inner, None | Some(AstNodes::JSXExpressionContainer(_)))
                    && (attribute.key()).is_some_and(|key| {
                        let name = f.source_text().text_for(&key.span(f.file()));
                        is_class_attribute(name, tailwind)
                    }) =>
            {
                is_sorted = true;
                break;
            }
            AstNodes::CallExpression(e) => {
                if let ExprKind::Call(call) = e.kind()
                    && call.args().iter().any(|it| is_in(it.span()))
                    && !(is_babel(tailwind, f) && e.is_in_optional_chain())
                    && is_class_function(call.callee(), tailwind, f)
                {
                    is_sorted = true;
                    break;
                }
            }
            _ => {}
        }
        inner = Some(ancestor);
    }
    if !is_sorted {
        return None;
    }
    let texts = match f.context().has_tree_of_babel() || is_read_by_oxc(tailwind, f) {
        true => Texts::Sorted,
        false => Texts::Unseen,
    };
    around.reverse();
    Some(collapse_among(&around, leaf, tailwind, (true, texts)))
}

/// What the plugin sees of the texts of a template when it decides about what is between them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Texts {
    /// Nothing: the tree of TypeScript does not have the positions that it asks for, and in Vue it does not ask.
    Unseen,
    AsWritten,
    /// It has sorted them by then.
    Sorted,
}

/// What stays of the white space at the ends of the string or the template at `leaf`. `around`: each `+` and each template
/// around it, from the outside to the inside. `every_plus`: all of them count, as in the plugin's `canCollapseWhitespaceIn`.
/// If not, the innermost does.
pub(crate) fn collapse_among(
    around: &[Expr<'_>],
    leaf: Span,
    tailwind: &Tailwind,
    (every_plus, texts): (bool, Texts),
) -> Collapse {
    let is_in = |span: Span| span.start <= leaf.start && leaf.end <= span.end;
    // What the plugin lets go, and where nothing touches it.
    let (mut collapse, mut free) = (Collapse::ALL, Collapse::ALL);
    if tailwind.preserves_whitespace {
        return collapse;
    }
    for e in around {
        let template = match e.kind() {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let outer = if every_plus { collapse } else { Collapse::ALL };
                collapse = outer.and(!is_in(right.span()), !is_in(left.span()));
                continue;
            }
            ExprKind::Template(template) => template,
            _ => continue,
        };
        let count = template.quasi_count();
        let mut expressions = template.exprs().iter().enumerate();
        let Some((index, expression)) = expressions.find(|it| is_in(it.1.span())) else {
            continue;
        };
        // It looks at the texts behind it, and at the one before it if nothing is between the `${` and it, and for the start
        // at the start of each.
        let touches_brace = template.quasi_span(index).end == expression.span().start;
        let seen = match texts {
            Texts::Unseen => count,
            _ => index + usize::from(!touches_brace),
        };
        let of_template = collapse;
        for i in seen..count {
            let raw = template.raw(i);
            let text = match texts {
                Texts::Sorted => tailwind.sorted_between(
                    raw,
                    ends_in_template(raw, (i == 0, i + 1 == count), of_template),
                ),
                _ => Cow::Borrowed(raw),
            };
            collapse = collapse.and(
                starts_with_white_space(&text),
                i == index || ends_with_white_space(&text),
            );
        }
        // So the blank goes in `` `a${" b"}` ``, and `a` and `b` are one class. Here what touches a text stays apart from it.
        let (before, behind) = (template.raw(index), template.raw(index + 1));
        free = Collapse {
            start: ends_with_white_space(before) || (before.is_empty() && index == 0 && free.start),
            end: starts_with_white_space(behind)
                || (behind.is_empty() && index + 2 == count && free.end),
        };
    }
    collapse.and(free.start, free.end)
}

/// What the plugin's `sortTemplateLiteral` calls `sortClasses` with for `text`. `around`: what stays at the ends of the template.
pub(crate) fn ends_in_template(
    text: &[u8],
    (is_first, is_last): (bool, bool),
    around: Collapse,
) -> Ends {
    Ends {
        ignores_first: !is_first && !starts_with_white_space(text),
        ignores_last: !is_last && !ends_with_white_space(text),
        collapses_start: around.start && is_first,
        collapses_end: around.end && is_last,
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
                collapse = collapse.and(!contains(right), !contains(left));
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
/// attribute. `None`: it is not sorted.
pub(crate) fn sorted_string_literal<'a>(
    source: &'a [u8],
    is_jsx: bool,
    (span, parent): (Span, AstNodes<'a>),
    context: TailwindContext,
    f: &Formatter<'a>,
) -> Option<Vec<u8>> {
    let by_plugin = match context.follows_plugin {
        true => Some(collapse_by_plugin(span, parent, f)?),
        false => None,
    };
    let normalized =
        FormatLiteralStringToken::new(source, is_jsx, StringLiteralParentKind::Expression)
            .clean_text(f)
            .into_text();
    let (tailwind, [quote, content @ .., _]) = (f.options().tailwind.as_deref()?, &*normalized)
    else {
        return None;
    };
    let mut printed = Vec::with_capacity(normalized.len());
    printed.push(*quote);
    let trimmed = content.trim_ascii();
    if let Some(around) = by_plugin {
        let ends = Ends {
            collapses_start: around.start,
            collapses_end: around.end,
            ..Ends::FREE
        };
        printed.extend_from_slice(&tailwind.sorted_between(content, ends));
    } else if context.preserves_whitespace {
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
    Some(printed)
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

/// What is written for `text`, which is text of a template. `is_first`, `is_last`: of the texts of the template. `None`: it
/// is not sorted.
pub(crate) fn sorted_template_text(
    text: &[u8],
    (is_first, is_last): (bool, bool),
    context: TailwindContext,
    tailwind: &Tailwind,
) -> Option<Vec<u8>> {
    if context.follows_plugin {
        let ends = ends_in_template(text, (is_first, is_last), context.around_template);
        return (context.sorts_template).then(|| tailwind.sorted_between(text, ends).into_owned());
    }
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
    Some(printed)
}
