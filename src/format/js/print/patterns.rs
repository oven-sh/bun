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
        PatKind::Object(_) | PatKind::Array(_) if !f.context_mut().has_stack_left() => {}
        PatKind::Object(props) => ObjectPatternLike::ObjectPattern(pat, props).fmt(f),
        PatKind::Array(elements) => write_array_pattern(pat, elements, f),
    }
}

fn write_array_pattern<'a>(pat: Pat<'a>, elements: List<'a, PatElem<'a>>, f: &mut Formatter<'a>) {
    write!(f, "[");
    if elements.is_empty() {
        write!(
            f,
            dangling_comments(pat.as_ast_nodes()).with_soft_block_indent()
        );
    } else {
        // `[, /* comment */]`: a hole isn't a node, so the comment dangles. Prettier's `printArray` prints it after the
        // elements.
        let dangling_comments = match f.is_quiet() {
            true => CommentList::empty(),
            false => f.comments().of_node(pat.as_ast_nodes()).dangling,
        };
        let has_dangling_line_comment = dangling_comments.iter().any(|comment| comment.is_line());
        let rest = elements.last().filter(|it| is_rest_element(*it));
        let count = elements.len() - usize::from(rest.is_some());
        write!(
            f,
            group(&soft_block_indent(&format_with(|f| {
                if count > 0 {
                    write_array_node(
                        elements.len(),
                        elements
                            .iter()
                            .take(count)
                            .map(|element| element.pat().is_some().then_some(element)),
                        f,
                    );
                }
                // Prettier's `printArrayItems`: each element is a group.
                if let Some(rest) = rest {
                    write!(f, group(&rest));
                }
                write!(
                    f,
                    FormatDanglingComments::Comments {
                        comments: dangling_comments,
                        indent: DanglingIndentMode::None,
                    }
                );
            })))
            .should_expand(has_dangling_line_comment)
        );
    }
    write!(f, "]");
}

/// `left = right`, ESTree's `AssignmentPattern`.
fn write_assignment_pattern<'a>(left: Pat<'a>, right: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, [group(&left), space(), "=", space(), right]);
}

/// `[...a = 1]` is an error, and typescript-estree's tree has `a = 1` for it.
fn is_rest_element(element: PatElem<'_>) -> bool {
    element.is_rest() && element.default().is_none()
}

/// `a`, `a = 1`, `...a` in an array pattern.
pub(crate) fn write_array_pattern_element<'a>(element: PatElem<'a>, f: &mut Formatter<'a>) {
    let Some(pat) = element.pat() else {
        return;
    };
    if is_rest_element(element) {
        let node = AstNodes::BindingRestElement(Node::PatElem(element));
        format_node(node, f, |f| write!(f, ["...", pat]));
    } else if let Some(default) = element.default() {
        let node = AstNodes::AssignmentPattern(Node::PatElem(element));
        format_node(node, f, |f| write_assignment_pattern(pat, default, f));
    } else {
        pat.fmt(f);
    }
}

/// `a`, `a: b`, `a = 1`, `a: b = 1`, `...a` in an object pattern.
pub(crate) fn write_binding_property<'a>(property: PatProp<'a>, f: &mut Formatter<'a>) {
    if property.is_rest() {
        return write!(f, ["...", property.value()]);
    }
    AssignmentLike::BindingProperty(property).fmt(f);
}

/// `BindingProperty.value`: the `b = 1` in `a: b = 1`, the `a = 1` in `{ a = 1 }`.
#[derive(Copy, Clone)]
pub(crate) struct FormatBindingPropertyValue<'a>(pub(crate) PatProp<'a>);

impl<'a> Format<'a> for FormatBindingPropertyValue<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (property, value) = (self.0, self.0.value());
        match property.default() {
            // Includes the default's parentheses, as in ESTree.
            Some(default) => format_node(
                AstNodes::AssignmentPattern(Node::PatProp(property)),
                f,
                |f| write_assignment_pattern(value, default, f),
            ),
            None => value.fmt(f),
        }
    }
}
