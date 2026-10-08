//! Binding patterns: `a`, `{ a, b: c = 1, ...d }`, `[a, , b = 1, ...c]`.

use super::object_pattern_like::ObjectPatternLike;
use crate::js::format::format_node;
use crate::js::utils::array::write_array_node;
use crate::js::utils::assignment_like::AssignmentLike;
use crate::prelude::*;
use crate::write;

pub(crate) fn write_binding_pattern<'a>(pat: Pat<'a>, f: &mut Formatter<'a>) {
    match pat.kind() {
        PatKind::Missing => {}
        PatKind::Ident(_) => write!(f, source_text(pat.span())),
        PatKind::Object(props) => ObjectPatternLike::ObjectPattern(pat, props).fmt(f),
        PatKind::Array(elements) => write_array_pattern(pat, elements, f),
    }
}

fn write_array_pattern<'a>(pat: Pat<'a>, elements: List<'a, PatElem<'a>>, f: &mut Formatter<'a>) {
    write!(f, "[");
    if elements.is_empty() {
        write!(f, format_dangling_comments(pat.span()).with_soft_block_indent());
    } else {
        let rest = elements.last().filter(|it| it.is_rest());
        let count = elements.len() - usize::from(rest.is_some());
        write!(
            f,
            group(&soft_block_indent(&format_with(|f| {
                if count > 0 {
                    write_array_node(
                        elements.len(),
                        elements.iter().take(count).map(|element| element.pat().is_some().then_some(element)),
                        f,
                    );
                }
                if let Some(rest) = rest {
                    write!(f, [(count > 0).then_some(soft_line_break_or_space()), rest]);
                }
            })))
        );
    }
    write!(f, "]");
}

/// `left = right`, ESTree's `AssignmentPattern`.
fn write_assignment_pattern<'a>(left: Pat<'a>, right: Expr<'a>, f: &mut Formatter<'a>) {
    let left = left.memoized();
    // So that the comments in it are not taken for comments before the `=`.
    left.inspect(f);
    let comments = f.comments().own_line_comments_before(right.span().start);
    write!(f, [FormatLeadingComments::Comments(comments), group(&left), space(), "=", space(), right]);
}

/// `a`, `a = 1`, `...a` in an array pattern.
pub(crate) fn write_array_pattern_element<'a>(element: PatElem<'a>, f: &mut Formatter<'a>) {
    let Some(pat) = element.pat() else {
        return;
    };
    let parent = || crate::js::ast_nodes::node_as_ast_nodes(element.parent());
    if element.is_rest() {
        format_node(element.span(), parent, f, |f| write!(f, ["...", pat]));
    } else if let Some(default) = element.default() {
        format_node(element.span(), parent, f, |f| write_assignment_pattern(pat, default, f));
    } else {
        pat.fmt(f);
    }
}

/// `a`, `a: b`, `a = 1`, `a: b = 1`, `...a` in an object pattern.
pub(crate) fn write_binding_property<'a>(property: PatProp<'a>, f: &mut Formatter<'a>) {
    match property.is_rest() {
        true => write!(f, ["...", property.value()]),
        false => AssignmentLike::BindingProperty(property).fmt(f),
    }
}

/// `BindingProperty.value`: the `b = 1` of `a: b = 1`, the `a = 1` of `{ a = 1 }`.
#[derive(Copy, Clone)]
pub(crate) struct FormatBindingPropertyValue<'a>(pub(crate) PatProp<'a>);

impl<'a> Format<'a> for FormatBindingPropertyValue<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (property, value) = (self.0, self.0.value());
        match property.default() {
            Some(default) => format_node(
                value.span().to(default.span()),
                || AstNodes::BindingProperty(property),
                f,
                |f| write_assignment_pattern(value, default, f),
            ),
            None => value.fmt(f),
        }
    }
}
