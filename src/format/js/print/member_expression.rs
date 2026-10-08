use crate::js::format::identifier;
use crate::js::utils::call_expression::strip_chain_element_wrappers;
use crate::js::utils::member_chain::chain_member::FormatComputedMemberExpressionWithoutObject;
use crate::prelude::*;
use crate::{format_args, write};

/// `a.b`, `a?.b`, `a.#b`, `a[b]`, `a?.[b]`. Prettier's `printMemberExpression`.
pub(crate) fn write_member_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    match e.kind() {
        ExprKind::Index { obj, .. } => {
            write!(f, [obj, line_suffix_boundary(), FormatComputedMemberExpressionWithoutObject(e)]);
        }
        ExprKind::Dot { obj, name, .. } => write_static_member_expression(e, obj, name, f),
        _ => {}
    }
}

fn write_static_member_expression<'a>(e: Expr<'a>, object: Expr<'a>, property: Ident<'a>, f: &mut Formatter<'a>) {
    let start = f.elements().len();
    write!(f, [object, line_suffix_boundary()]);

    let operator = if e.is_optional() { "?." } else { "." };
    let property_start = property.start();
    let has_own_line_comment = !f.is_quiet() && f.comments().has_leading_own_line_comment(property_start);
    let is_inline = !has_own_line_comment && should_inline(e, object, property, start, f);
    let property = identifier(property, e.as_chain_element());

    if is_inline {
        return write!(f, [operator, property]);
    }
    write!(
        f,
        group(&indent(&format_args!(
            soft_line_break(),
            format_with(|f| {
                if has_own_line_comment {
                    let comments = f.comments().comments_before(property_start);
                    write!(f, [FormatLeadingComments::Comments(comments), soft_line_break()]);
                }
            }),
            operator,
            property,
        )))
    );
}

fn is_member(node: AstNodes<'_>) -> bool {
    matches!(
        node,
        AstNodes::StaticMemberExpression(_) | AstNodes::ComputedMemberExpression(_) | AstNodes::PrivateFieldExpression(_)
    )
}

/// Whether there is no line break between the object and the `.`, however long the line.
///
/// `object_start`: where the elements of the object start in what is written.
fn should_inline<'a>(
    e: Expr<'a>,
    object: Expr<'a>,
    property: Ident<'a>,
    object_start: usize,
    f: &Formatter<'a>,
) -> bool {
    let parent = e.as_chain_element().parent();

    let mut first_non_wrapper_parent = parent;
    while matches!(first_non_wrapper_parent, AstNodes::TSNonNullExpression(_) | AstNodes::ChainExpression(_)) {
        first_non_wrapper_parent = first_non_wrapper_parent.parent();
    }

    if is_member(first_non_wrapper_parent) {
        // `a.b` of `a.b.c`
    } else if matches!(object.kind(), ExprKind::Ident(_)) && !property.bytes().starts_with(b"#") {
        return true;
    } else if matches!(first_non_wrapper_parent, AstNodes::AssignmentExpression(_) | AstNodes::VariableDeclarator(_))
        && (matches!(strip_chain_element_wrappers(object).kind(), ExprKind::Call(call) if !call.args().is_empty())
            || (is_member_chain_or_member_of_one(object)
                && f.elements_from(object_start).has_label(LabelId::of(JsLabels::MemberChain))))
    {
        return true;
    }

    // Babel, which reads JavaScript for Prettier, has no `ChainExpression`.
    let is_javascript = f.file().is_javascript();
    let is_transparent = |node: AstNodes<'a>| is_javascript && matches!(node, AstNodes::ChainExpression(_));

    let mut first_non_member_parent = parent;
    while is_member(first_non_member_parent)
        || matches!(first_non_member_parent, AstNodes::TSNonNullExpression(_))
        || is_transparent(first_non_member_parent)
    {
        first_non_member_parent = first_non_member_parent.parent();
    }
    match first_non_member_parent {
        AstNodes::AssignmentExpression(assignment) => {
            !assignment.left().is_some_and(|left| matches!(left.kind(), ExprKind::Ident(_)))
        }
        // Prettier's `shouldInlineNewExpressionCallee`: it is on the left edge of the callee.
        AstNodes::NewExpression(new) => {
            let mut child = e;
            let mut ancestor = parent;
            loop {
                match ancestor {
                    AstNodes::NewExpression(_) => return new.callee() == Some(child),
                    AstNodes::ChainExpression(_) => {}
                    AstNodes::TSNonNullExpression(it) => child = it,
                    AstNodes::StaticMemberExpression(it)
                    | AstNodes::ComputedMemberExpression(it)
                    | AstNodes::PrivateFieldExpression(it)
                        if it.object() == Some(child) =>
                    {
                        child = it;
                    }
                    _ => return false,
                }
                ancestor = ancestor.parent();
            }
        }
        _ => false,
    }
}

/// Whether what is written for `object` has the label of what is at its left edge: it is a call
/// of a member, which may be written as a member chain, or a member of that.
fn is_member_chain_or_member_of_one(mut object: Expr<'_>) -> bool {
    loop {
        match object.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => object = obj,
            ExprKind::Call(call) => return matches!(call.callee().kind(), ExprKind::Dot { .. } | ExprKind::Index { .. }),
            _ => return false,
        }
    }
}
