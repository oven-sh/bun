use crate::js::format::identifier;
use crate::js::utils::member_chain::chain_member::FormatComputedMemberExpressionWithoutObject;
use crate::prelude::*;
use crate::{format_args, write};

/// `a.b`, `a?.b`, `a.#b`, `a[b]`, `a?.[b]`
pub(crate) fn write_member_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    match e.kind() {
        ExprKind::Index { obj, .. } => {
            write!(f, [obj, FormatComputedMemberExpressionWithoutObject(e)]);
        }
        ExprKind::Dot { obj, name, .. } if name.bytes().starts_with(b"#") => {
            let name = identifier(name, AstNodes::PrivateFieldExpression(e));
            write!(f, [obj, e.is_optional().then_some("?"), ".", name]);
        }
        ExprKind::Dot { obj, name, .. } => write_static_member_expression(e, obj, name, f),
        _ => {}
    }
}

fn write_static_member_expression<'a>(e: Expr<'a>, object: Expr<'a>, property: Ident<'a>, f: &mut Formatter<'a>) {
    let start = f.elements().len();
    write!(f, object);
    let is_member_chain = f.elements_from(start).has_label(LabelId::of(JsLabels::MemberChain));

    let operator = if e.is_optional() { "?." } else { "." };
    let property_start = property.start();
    let property = identifier(property, AstNodes::StaticMemberExpression(e));

    match layout(e, object, property_start, is_member_chain, f) {
        StaticMemberLayout::NoBreak => {
            let format_no_break = format_args!(operator, property);
            match is_member_chain {
                true => write!(f, labelled(LabelId::of(JsLabels::MemberChain), &format_no_break)),
                false => write!(f, format_no_break),
            }
        }
        StaticMemberLayout::BreakAfterObject => {
            write!(
                f,
                group(&indent(&format_args!(
                    soft_line_break(),
                    format_with(|f| {
                        if f.comments().has_leading_own_line_comment(property_start) {
                            let comments = f.comments().comments_before(property_start);
                            write!(f, [FormatLeadingComments::Comments(comments), soft_line_break()]);
                        }
                    }),
                    operator,
                    property,
                )))
            );
        }
    }
}

#[derive(Debug, Copy, Clone)]
enum StaticMemberLayout {
    /// The object, the operator and the name stay on one line.
    NoBreak,
    /// There is a line break after the object if it does not all fit.
    BreakAfterObject,
}

fn layout<'a>(
    e: Expr<'a>,
    object: Expr<'a>,
    property_start: u32,
    is_member_chain: bool,
    f: &Formatter<'a>,
) -> StaticMemberLayout {
    if !f.is_quiet() && f.comments().has_leading_own_line_comment(property_start) {
        return StaticMemberLayout::BreakAfterObject;
    }

    // The `!` of `a.b!` and the `ChainExpression` of `a?.b` are looked through.
    let mut parent = e.ast_parent();
    while matches!(parent, AstNodes::TSNonNullExpression(_) | AstNodes::ChainExpression(_)) {
        parent = parent.parent();
    }

    let has_arguments = |e: Expr<'a>| matches!(e.kind(), ExprKind::Call(call) if !call.args().is_empty());
    let is_nested = match parent {
        AstNodes::AssignmentExpression(_) | AstNodes::VariableDeclarator(_) => {
            let no_break = match object.kind() {
                ExprKind::NonNull(expression) => has_arguments(expression),
                _ => has_arguments(object) && !is_chain_root(object),
            };
            if no_break || is_member_chain {
                return StaticMemberLayout::NoBreak;
            }
            false
        }
        AstNodes::StaticMemberExpression(_) | AstNodes::ComputedMemberExpression(_) => true,
        _ => false,
    };

    if !is_nested && matches!(object.kind(), ExprKind::Ident(_)) {
        return StaticMemberLayout::NoBreak;
    }

    let mut first_non_static_member_ancestor = parent;
    while matches!(
        first_non_static_member_ancestor,
        AstNodes::StaticMemberExpression(_)
            | AstNodes::ComputedMemberExpression(_)
            | AstNodes::ChainExpression(_)
            | AstNodes::TSNonNullExpression(_)
    ) {
        first_non_static_member_ancestor = first_non_static_member_ancestor.parent();
    }

    match first_non_static_member_ancestor {
        AstNodes::NewExpression(new) if new.callee().is_some_and(|callee| callee.span().contains(e.span())) => {
            StaticMemberLayout::NoBreak
        }
        AstNodes::AssignmentExpression(assignment) => match assignment.left().map(Expr::kind) {
            Some(ExprKind::Ident(_)) => StaticMemberLayout::BreakAfterObject,
            _ => StaticMemberLayout::NoBreak,
        },
        _ => StaticMemberLayout::BreakAfterObject,
    }
}
