//! `a as T`, `a as const`, `a satisfies T`

use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::typecast::comments_of_expression;
use crate::prelude::*;
use crate::{format_args, write};

/// Prettier 3.9 prints `new (⏎ a as T⏎)()` like `(⏎ a as T⏎)()`. oxfmt follows 3.8, in which only `T` can break.
fn breaks_around_new_callee(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// For oxfmt the comments around `as` and `satisfies` stay on their side of the operator, and start a line if they do
/// in the source. Prettier attaches them to the expression or to the type.
fn comments_stay_around_cast_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// See [`comments_stay_around_cast_operator`]. `cast` is the whole expression. `type_annotation` is `None` for
/// `as const`.
#[cold]
#[inline(never)]
fn write_with_comments_in_place<'a>(
    cast: Expr<'a>,
    expression: Expr<'a>,
    operation: &'static str,
    type_annotation: Option<TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    let type_node = type_annotation.map(|ty| ty.as_ast_nodes());
    let after_expression = comments_of_expression(expression, f).trailing;
    let before_type = match type_node {
        Some(ty) => f.comments().of_node(ty).leading,
        // `const` isn't a node. A multiline comment before it trails the whole expression.
        None => {
            let comments = f.comments().of_node(cast.as_ast_nodes()).trailing;
            let count = (comments.iter())
                .take_while(|comment| comment.span().end <= cast.span().end)
                .count();
            comments.slice(0, count)
        }
    };
    let is_ignored = type_node.is_some_and(|ty| f.comments().is_ignored(ty));
    // A union prints its own leading comments.
    let is_union =
        !is_ignored && type_annotation.is_some_and(|ty| matches!(ty.kind(), TypeKind::Union(_)));

    let expression_end = expression.outer_span().end;
    let before_operator_count = (after_expression.iter())
        .take_while(|comment| comment.prev_token_end() <= expression_end)
        .count();
    let (before_operator, after_operator) = after_expression.split_at(before_operator_count);
    // There can't be a line break before the operator, so only block comments on the expression's line stay there. A
    // line comment is printed after the operator anyway.
    // `(a /* prettier-ignore */⏎) as T` is `a as /* prettier-ignore */ T`.
    let has_ignore_comment =
        (before_operator.iter()).any(|comment| f.comments().is_suppression_comment(comment));
    let glued_before_count = before_operator
        .iter()
        .take_while(|comment| {
            !has_ignore_comment && !comment.has_newline_before() && !comment.is_multiline_block()
        })
        .count();
    let (glued_before, moved) = before_operator.split_at(glued_before_count);
    // The comments on the operator's line.
    let is_glued_after = |comment: &Comment<'_>| {
        !(comment.has_newline_before()
            || (comment.is_multiline_block() && comment.has_newline_after()))
    };
    let can_glue_after = !is_union && moved.is_empty() && !is_ignored;
    let glued_after_count = match can_glue_after {
        true => after_operator.iter().take_while(is_glued_after).count(),
        false => 0,
    };
    let (glued_after, leading) = after_operator.split_at(glued_after_count);
    let glued_before_type_count = match can_glue_after && leading.is_empty() {
        true => before_type.iter().take_while(is_glued_after).count(),
        false => 0,
    };
    let (glued_before_type, leading_type) = before_type.split_at(glued_before_type_count);
    let is_on_its_own_lines = |comment: Comment<'_>| {
        comment.has_newline_after()
            && (comment.has_newline_before() || comment.is_multiline_block())
    };
    let is_type_on_next_line = (glued_before.iter())
        .chain(glued_after)
        .chain(glued_before_type)
        .any(|comment| comment.is_line())
        || (!is_union
            && (moved.iter().chain(leading).chain(leading_type)).any(is_on_its_own_lines))
        // `a as // prettier-ignore⏎T`
        || (is_ignored && leading_type.iter().any(|comment| comment.has_newline_after()));

    let format_type = format_with(|f| {
        write!(
            f,
            [
                FormatLeadingComments::Comments(moved),
                FormatLeadingComments::Comments(leading),
                type_annotation
                    .is_none()
                    .then_some(FormatLeadingComments::Comments(leading_type))
            ]
        );
        match type_annotation {
            Some(ty) => write!(f, ty),
            None => write!(f, "const"),
        }
    });
    write!(
        f,
        [
            FormatNodeWithoutTrailingComments(&expression),
            FormatTrailingComments::Comments(glued_before),
            space(),
            operation,
            FormatTrailingComments::Comments(glued_after),
            FormatTrailingComments::Comments(glued_before_type)
        ]
    );
    match is_type_on_next_line {
        true => write!(f, indent(&format_args!(hard_line_break(), format_type))),
        false => write!(f, [space(), format_type]),
    }
}

/// Not inlined, because `a as b as c` nests as deep as it is long, and inlining would add this function's stack usage
/// to every level.
#[inline(never)]
fn ends_with_line_comment<'a>(expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    (comments_of_expression(expression, f).trailing.last()).is_some_and(|comment| comment.is_line())
}

#[inline(never)]
pub(crate) fn write_as_or_satisfies_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let (expression, type_annotation, operation) = match e.kind() {
        ExprKind::As { expr, ty } => (expr, Some(ty), "as"),
        ExprKind::AsConst(expr) => (expr, None, "as"),
        ExprKind::Satisfies { expr, ty } => (expr, Some(ty), "satisfies"),
        _ => return,
    };

    let format_inner = format_with(|f| {
        if !f.is_quiet() && comments_stay_around_cast_operator(f) {
            return write_with_comments_in_place(e, expression, operation, type_annotation, f);
        }
        write!(f, [expression, space(), operation]);
        // Prettier's space is text, so it's still printed before a line comment that trails the expression when the
        // type starts on the next line: `a as  // comment`.
        match !f.is_quiet() && ends_with_line_comment(expression, f) {
            true => write!(f, " "),
            false => write!(f, space()),
        }
        match type_annotation {
            Some(ty) => write!(f, ty),
            None => write!(f, "const"),
        }
    });

    let parent = e.ast_parent();
    let is_callee_or_object = match parent {
        AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        AstNodes::NewExpression(_) if !breaks_around_new_callee(f) => false,
        _ => parent.is_call_like_callee(e),
    };
    match is_callee_or_object {
        true => write!(f, group(&soft_block_indent(&format_inner))),
        false => write!(f, format_inner),
    }
}
