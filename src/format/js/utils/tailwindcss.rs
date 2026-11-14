//! oxfmt's `sortTailwindcss` in JavaScript: which strings are class lists, and how much of the whitespace at their ends
//! is kept.
//!
//! A port of `oxc_formatter/src/utils/tailwindcss.rs`, which follows `prettier-plugin-tailwindcss`. The code being
//! printed is in a context, the top of a stack: `JsFormatContext::tailwind_context`.
//!
//! If the plugin itself turned sorting on (`Tailwind::follows_plugin`), its `transformJavaScript` rules apply. The
//! stack then has a single context, and the nodes around a text decide if it's sorted: [`collapse_by_plugin`].

use super::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::options::HtmlRoot;
use crate::prelude::*;
use crate::tailwind::{Ends, Names, Oxc, Tailwind};
use smallvec::SmallVec;
use std::borrow::Cow;

/// The code being printed is in an attribute value, or among a function's arguments, that takes classes.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TailwindContext {
    pub(crate) preserves_whitespace: bool,
    /// It's between a template's `${` and `}`.
    is_in_template_expression: bool,
    /// The text before that `${` ends with whitespace.
    has_whitespace_before: bool,
    /// The text after that `}` starts with whitespace.
    has_whitespace_after: bool,
    /// Which ends of the current template can lose their whitespace, given the `+`s around it.
    outer_collapse: Collapse,
    /// It's in a call of another function. Strings there aren't sorted.
    pub(crate) is_disabled: bool,
    /// See [`Tailwind::follows_plugin`].
    pub(crate) follows_plugin: bool,
    /// The current template's texts are sorted. oxfmt sorts every template that's in a context.
    sorts_template: bool,
}

/// For the start and the end of a text, true if the whitespace there can be removed. Otherwise one space is kept.
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

    /// Intersects with `start` and `end`.
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
    /// For an attribute's value or a function's arguments.
    fn new(tailwind: &Tailwind) -> Self {
        TailwindContext {
            preserves_whitespace: tailwind.preserves_whitespace,
            is_in_template_expression: false,
            has_whitespace_before: true,
            has_whitespace_after: true,
            outer_collapse: Collapse::ALL,
            is_disabled: false,
            follows_plugin: false,
            sorts_template: true,
        }
    }

    /// For a whole file where the plugin's rules apply.
    pub(crate) fn for_plugin(tailwind: &Tailwind) -> Self {
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
            outer_collapse: collapse_in_concatenation(e.span(), e.ast_parent()),
            ..self
        }
    }

    /// For the template at `span` in `parent`, under the plugin's rules.
    pub(crate) fn in_template_at<'a>(
        self,
        span: Span,
        parent: AstNodes<'a>,
        f: &Formatter<'a>,
    ) -> Self {
        let plugin_collapse = collapse_by_plugin(span, parent, f);
        TailwindContext {
            sorts_template: plugin_collapse.is_some(),
            outer_collapse: plugin_collapse.unwrap_or(Collapse::ALL),
            ..self
        }
    }

    /// For the content of a `${}` that has the text `before` in front of it and the text `following` after it.
    pub(crate) fn in_template_expression(self, before: &[u8], following: &[u8]) -> Self {
        TailwindContext {
            is_in_template_expression: true,
            has_whitespace_before: ends_with_white_space(before),
            has_whitespace_after: starts_with_white_space(following),
            outer_collapse: Collapse::ALL,
            is_disabled: false,
            sorts_template: !self.follows_plugin,
            ..self
        }
    }

    /// True if the line breaks in the current template are removed.
    pub(crate) fn collapses_line_breaks(self) -> bool {
        self.sorts_template && !self.preserves_whitespace
    }

    /// Which ends of the code being printed can lose their whitespace, given the template around it.
    fn collapse(self) -> Collapse {
        Collapse {
            start: !self.is_in_template_expression || self.has_whitespace_before,
            end: !self.is_in_template_expression || self.has_whitespace_after,
        }
    }
}

/// `content`, printed in a context if there is one.
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

/// The context for `callee`'s arguments, or for the template it tags, if they're classes.
pub(crate) fn context_of_function(callee: Expr<'_>, f: &Formatter<'_>) -> Option<TailwindContext> {
    (f.options().tailwind.as_deref())
        .filter(|tailwind| !tailwind.follows_plugin && is_class_function(callee, tailwind, f))
        .map(TailwindContext::new)
}

/// The context for the value of the JSX attribute `name`, if it holds classes.
pub(crate) fn context_of_attribute(name: &[u8], f: &Formatter<'_>) -> Option<TailwindContext> {
    (f.options().tailwind.as_deref())
        .filter(|tailwind| !tailwind.follows_plugin && is_class_attribute(name, tailwind))
        .map(TailwindContext::new)
}

/// The context of the string literal `source`, if it should be sorted. A single class isn't.
pub(crate) fn context_of_string(source: &[u8], f: &Formatter<'_>) -> Option<TailwindContext> {
    f.context()
        .tailwind_context()
        .filter(|context| !context.is_disabled && has_white_space(source))
}

/// True if the plugin has already joined the string `e` onto one line by the time Prettier sees it.
pub(crate) fn loses_line_breaks<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    (f.context().tailwind_context()).is_some_and(|it| it.follows_plugin && !it.preserves_whitespace)
        && !bun_core::strings::contains(e.text(), b"{{")
        && collapse_by_plugin(e.span(), e.ast_parent(), f).is_some()
}

/// True if the value of the JSX attribute `name` holds classes.
fn is_class_attribute(name: &[u8], tailwind: &Tailwind) -> bool {
    matches!(name, b"class" | b"className")
        || (!bun_core::strings::contains_char(name, b':')
            && has(&tailwind.attributes, name, tailwind))
}

/// oxfmt's own rules don't support patterns.
fn has(names: &Names, name: &[u8], tailwind: &Tailwind) -> bool {
    names.has_name(name) || (tailwind.follows_plugin && names.has_pattern_for(name))
}

/// True if `@prettier/plugin-oxc` parses the code being printed.
fn is_parsed_by_oxc(tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    tailwind.oxc != Oxc::Absent
        && (!f.context().has_babel_tree() || f.options().in_html.root == HtmlRoot::None)
}

/// True if the plugin sees Babel's tree.
fn is_babel(tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    f.context().has_babel_tree() && !is_parsed_by_oxc(tailwind, f)
}

/// True if the plugin sees `e`, which is in an optional chain, as a node kind other than a call or a member access. In
/// Babel that's every link from the `?.` on. In the other parsers it's the node wrapping the whole chain.
fn is_opaque_chain_node_to_plugin(e: Expr<'_>, tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    match is_babel(tailwind, f) {
        true => e.is_in_optional_chain(),
        false => e.is_chain_root(),
    }
}

/// True if `callee`'s arguments are classes: `cn`, `cn.a`, `cn()`. The plugin's `isSortableExpression`.
fn is_class_function(callee: Expr<'_>, tailwind: &Tailwind, f: &Formatter<'_>) -> bool {
    if tailwind.functions.is_empty() {
        return false;
    }
    let mut node = callee;
    loop {
        if tailwind.follows_plugin && is_opaque_chain_node_to_plugin(node, tailwind, f) {
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

/// Which ends of the string or template at `leaf` in `parent` can lose their whitespace, under the plugin's rules.
/// Returns `None` if it isn't sorted. The plugin sorts all strings and templates, however deep (`sortInside`), in an
/// attribute value or a function argument that takes classes, and the template tagged by such a function.
fn collapse_by_plugin<'a>(leaf: Span, parent: AstNodes<'a>, f: &Formatter<'a>) -> Option<Collapse> {
    let tailwind = f.options().tailwind.as_deref()?;
    if tailwind.oxc == Oxc::After && is_parsed_by_oxc(tailwind, f) {
        return None;
    }
    let is_in = |span: Span| span.start <= leaf.start && leaf.end <= span.end;
    // Each `+` and each template around it, innermost first.
    let mut enclosing: SmallVec<[Expr<'a>; 4]> = SmallVec::new();
    let (mut is_sorted, mut inner) = (false, None);
    for ancestor in parent.ancestors() {
        match ancestor {
            AstNodes::BinaryExpression(e) | AstNodes::TemplateLiteral(e) => enclosing.push(e),
            AstNodes::TaggedTemplateExpression(e) if inner.is_none() => {
                is_sorted = matches!(e.kind(), ExprKind::TaggedTemplate(call) if is_class_function(call.callee(), tailwind, f));
            }
            // The plugin only considers the nodes between the leaf and the innermost of these.
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
    let texts = match f.context().has_babel_tree() || is_parsed_by_oxc(tailwind, f) {
        true => Texts::Sorted,
        false => Texts::Unseen,
    };
    enclosing.reverse();
    Some(collapse_among(&enclosing, leaf, tailwind, (true, texts)))
}

/// How much of a template's texts the plugin sees when it decides about the expressions between them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Texts {
    /// Nothing: TypeScript's tree doesn't have the positions it looks up, and in Vue it doesn't look.
    Unseen,
    Unsorted,
    /// It has already sorted them.
    Sorted,
}

/// Which ends of the string or template at `leaf` can lose their whitespace. `enclosing` is each `+` and each template
/// around it, outermost first. With `every_plus` all the `+`s count, as in the plugin's `canCollapseWhitespaceIn`.
/// Otherwise only the innermost does.
pub(crate) fn collapse_among(
    enclosing: &[Expr<'_>],
    leaf: Span,
    tailwind: &Tailwind,
    (every_plus, texts): (bool, Texts),
) -> Collapse {
    let is_in = |span: Span| span.start <= leaf.start && leaf.end <= span.end;
    // `collapse` is what the plugin removes. `free` is where nothing touches the leaf.
    let (mut collapse, mut free) = (Collapse::ALL, Collapse::ALL);
    if tailwind.preserves_whitespace {
        return collapse;
    }
    for e in enclosing {
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
        // The plugin looks at the texts after the expression, plus the one before it if nothing is between the `${` and
        // the expression. For the start it checks the start of each text.
        let touches_brace = template.quasi_span(index).end == expression.span().start;
        let seen = match texts {
            Texts::Unseen => count,
            _ => index + usize::from(!touches_brace),
        };
        let template_collapse = collapse;
        for i in seen..count {
            let raw = template.raw(i);
            let text = match texts {
                Texts::Sorted => tailwind.sorted_between(
                    raw,
                    ends_in_template(raw, (i == 0, i + 1 == count), template_collapse),
                ),
                _ => Cow::Borrowed(raw),
            };
            collapse = collapse.and(
                starts_with_white_space(&text),
                i == index || ends_with_white_space(&text),
            );
        }
        // So the plugin removes the space in `` `a${" b"}` ``, which merges `a` and `b` into one class. Here, a string
        // that touches a text keeps its space.
        let (before, following) = (template.raw(index), template.raw(index + 1));
        free = Collapse {
            start: ends_with_white_space(before) || (before.is_empty() && index == 0 && free.start),
            end: starts_with_white_space(following)
                || (following.is_empty() && index + 2 == count && free.end),
        };
    }
    collapse.and(free.start, free.end)
}

/// The arguments that the plugin's `sortTemplateLiteral` passes to `sortClasses` for `text`. `template_ends` is which
/// of the template's ends can lose their whitespace.
pub(crate) fn ends_in_template(
    text: &[u8],
    (is_first, is_last): (bool, bool),
    template_ends: Collapse,
) -> Ends {
    Ends {
        ignores_first: !is_first && !starts_with_white_space(text),
        ignores_last: !is_last && !ends_with_white_space(text),
        collapses_start: template_ends.start && is_first,
        collapses_end: template_ends.end && is_last,
    }
}

/// Which ends of the node at `span` in `parent` can lose their whitespace inside `a + .. + b`: an end that something is
/// concatenated to has to keep a space. The plugin's `canCollapseWhitespaceIn`.
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

/// The output for the string literal `source`, which is at `span` in `parent`. `is_jsx` means it's an attribute's
/// value. Returns `None` if it isn't sorted.
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
    if let Some(plugin_collapse) = by_plugin {
        let ends = Ends {
            collapses_start: plugin_collapse.start,
            collapses_end: plugin_collapse.end,
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

/// Splits `text`, which is between two `${}` of a template or at one of its ends, into three parts: a class that
/// touches the `}` before it, the sortable part, and a class that touches the `${` after it.
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

/// The output for `text`, one of a template's texts. `is_first` and `is_last` are its position among them. Returns
/// `None` if it isn't sorted.
pub(crate) fn sorted_template_text(
    text: &[u8],
    (is_first, is_last): (bool, bool),
    context: TailwindContext,
    tailwind: &Tailwind,
) -> Option<Vec<u8>> {
    if context.follows_plugin {
        let ends = ends_in_template(text, (is_first, is_last), context.outer_collapse);
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
        // Only the template's ends have something other than its own `${}` next to them.
        let (inner, outer) = (context.collapse(), context.outer_collapse);
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
