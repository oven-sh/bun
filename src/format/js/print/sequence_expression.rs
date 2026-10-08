use crate::js::parentheses::expression::has_own_line_comment_between;
use crate::prelude::*;
use crate::{format_args, write};

/// `a, b, c`
pub(crate) fn write_sequence_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let parent = e.ast_parent();
    let all = e.sequence();
    let Some((first, rest)) = all.split_first() else {
        return;
    };

    // Where it is not in parentheses, what follows the first expression is indented.
    if matches!(parent, AstNodes::ForStatement(_))
        || matches!(parent, AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body())
    {
        return write!(
            f,
            group(&format_with(|f| {
                write!(f, first);
                for expression in rest {
                    write!(
                        f,
                        [
                            ",",
                            indent(&format_args!(soft_line_break_or_space(), expression))
                        ]
                    );
                }
            }))
        );
    }

    let format_inner = format_with(|f| {
        f.join_with(format_args!(",", soft_line_break_or_space()))
            .entries(all.iter());
        write_comments_before_closing_parenthesis(e, f);
    });
    match parent {
        // Whether it breaks is decided at the `(`.
        AstNodes::ExpressionStatement(_) => write!(f, group(&soft_block_indent(&format_inner))),
        // The statement has a group for the parentheses and what is in them, unless a comment
        // breaks them.
        AstNodes::ReturnStatement(statement) | AstNodes::ThrowStatement(statement)
            if !has_own_line_comment_between(statement.span().start, e.span().start, f) =>
        {
            write!(f, format_inner);
        }
        _ => write!(f, group(&format_inner)),
    }
}

/// Prettier's `handleParenthesizedExpressionTrailingComment`: the comments between the end of `e`,
/// a sequence or an assignment, and the `)` after it trail the last expression in it.
pub(crate) fn write_comments_before_closing_parenthesis<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    let is_whole_side = match e.ast_parent() {
        AstNodes::ExpressionStatement(statement) => statement.is_arrow_function_body(),
        AstNodes::VariableDeclarator(declarator) => declarator.init() == Some(e),
        AstNodes::AssignmentExpression(assignment) => assignment.right() == Some(e),
        AstNodes::ReturnStatement(_) => true,
        _ => false,
    };
    if !is_whole_side {
        return;
    }
    let comments = f
        .comments()
        .comments_in(Span::after(e.span(), e.outer_span().end));
    let count = comments
        .iter()
        .take_while(|comment| !comment.preceded_by_newline())
        .count();
    write!(
        f,
        FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default())
    );
}
