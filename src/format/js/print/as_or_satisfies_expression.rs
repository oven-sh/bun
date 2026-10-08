//! `a as T`, `a as const`, `a satisfies T`

use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::write;

pub(crate) fn write_as_or_satisfies_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let (expression, type_annotation, operation) = match e.kind() {
        ExprKind::As { expr, ty } => (expr, Some(ty), "as"),
        ExprKind::AsConst(expr) => (expr, None, "as"),
        ExprKind::Satisfies { expr, ty } => (expr, Some(ty), "satisfies"),
        _ => return,
    };
    let type_start = match type_annotation {
        Some(ty) => ty.span().start,
        None => e.const_keyword_span().map_or(e.span().end, |it| it.start),
    };

    let format_inner = format_with(|f| {
        let format_type = format_with(|f| match type_annotation {
            Some(ty) => write!(f, ty),
            None => write!(f, "const"),
        });
        let comments = match f.is_quiet() {
            true => &[][..],
            false => f.comments().comments_in_range(expression.span().end, type_start),
        };
        // Those up to the first that spans several lines.
        let count = comments.iter().take_while(|c| !c.is_multiline_block()).count();
        let block_comments = comments.get(..count).unwrap_or_default();

        if !comments.is_empty() && type_annotation.is_none() {
            write!(
                f,
                [
                    FormatNodeWithoutTrailingComments(&expression),
                    FormatTrailingComments::Comments(block_comments),
                    space(),
                    operation,
                    space(),
                    "const"
                ]
            );
        } else if block_comments.is_empty() {
            write!(f, [FormatNodeWithoutTrailingComments(&expression), space(), operation, space(), format_type]);
        } else {
            write!(f, [expression, space(), operation, space(), format_type]);
        }
    });

    let parent = e.ast_parent();
    let is_callee_or_object = match parent {
        AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
        AstNodes::ComputedMemberExpression(member) => member.object() == Some(e),
        _ => parent.is_call_like_callee(e),
    };
    match is_callee_or_object {
        true => write!(f, group(&soft_block_indent(&format_inner))),
        false => write!(f, format_inner),
    }
}
