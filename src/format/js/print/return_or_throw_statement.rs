use super::semicolon::OptionalSemicolon;
use crate::js::format::{ExprOptions, write_expression, write_trailing_comments_of};
use crate::js::utils::expression::ExpressionLeftSide;
use crate::prelude::*;
use crate::{format_args, write};

pub(crate) fn write_return_statement<'a>(_statement: Stmt<'a>, argument: Option<Expr<'a>>, f: &mut Formatter<'a>) {
    write_return_or_throw("return", argument, f);
}

pub(crate) fn write_throw_statement<'a>(_statement: Stmt<'a>, argument: Expr<'a>, f: &mut Formatter<'a>) {
    write_return_or_throw("throw", Some(argument), f);
}

fn write_return_or_throw<'a>(keyword: &'static str, argument: Option<Expr<'a>>, f: &mut Formatter<'a>) {
    write!(f, keyword);
    if let Some(argument) = argument {
        write!(f, [space(), FormatAdjacentArgument(argument)]);
    }

    write!(f, OptionalSemicolon);
}

/// What has to start on the line of the keyword before it: the argument of `return`, `throw` or
/// `yield`. If it breaks, or starts with a comment, it is written in parentheses.
pub(crate) struct FormatAdjacentArgument<'a>(pub(crate) Expr<'a>);

impl<'a> Format<'a> for FormatAdjacentArgument<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let argument = self.0;
        let is_sequence = matches!(
            argument.kind(),
            ExprKind::Binary {
                op: BinOp::Comma,
                ..
            }
        );
        let is_jsx = matches!(argument.kind(), ExprKind::Jsx(_));

        if !is_jsx && !f.is_quiet() && has_argument_leading_comments(argument, f) {
            let is_in_yield = matches!(argument.ast_parent(), AstNodes::YieldExpression(_));
            let inner = format_with(|f| match argument.kind() {
                _ if is_sequence && is_in_yield => {
                    write!(f, [format_leading_comments(argument.span()), "(", argument, ")"]);
                }
                // Prettier's `willReturnOrThrowStatementBreak`: these parentheses are enough.
                ExprKind::Assign { .. } if !is_in_yield => {
                    write!(f, format_leading_comments(argument.span()));
                    write_expression(argument, ExprOptions::None, f);
                    write_trailing_comments_of(argument.as_ast_nodes(), f);
                }
                _ => write!(f, argument),
            });
            write!(f, ["(", block_indent(&inner), ")"]);
        } else if matches!(argument.kind(), ExprKind::Binary { .. }) && !is_sequence {
            write!(
                f,
                group(&format_args!(if_group_breaks(&"("), soft_block_indent(&argument), if_group_breaks(&")")))
            );
        } else if is_sequence {
            let span = argument.span();
            if !f.is_quiet() && f.comments().get_type_cast_comment_index(span).is_none() {
                write!(f, format_leading_comments(span));
            }
            write!(f, group(&format_args!("(", soft_block_indent(&argument), ")")));
        } else if !f.is_quiet()
            && matches!(argument.kind(), ExprKind::Assign { .. })
            && matches!(argument.ast_parent(), AstNodes::ReturnStatement(_))
        {
            // Prettier's `handleParenthesizedExpressionTrailingComment`:
            // `return (a = b /* comment */);`
            let comments = f.comments().comments_in_range(argument.span().end, argument.outer_span().end);
            let count = comments.iter().take_while(|comment| !comment.preceded_by_newline()).count();
            if count == 0 {
                return write!(f, argument);
            }
            write!(f, [format_leading_comments(argument.span()), "("]);
            write_expression(argument, ExprOptions::None, f);
            write!(f, [FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default()), ")"]);
            write_trailing_comments_of(argument.as_ast_nodes(), f);
        } else {
            write!(f, argument);
        }
    }
}

/// Whether a comment that ends its line, or spans several, is before `argument` or before anything
/// down its left edge.
fn has_argument_leading_comments<'a>(argument: Expr<'a>, f: &Formatter<'a>) -> bool {
    let comments = f.comments();

    // The comments inside the parentheses of a type cast are dealt with there.
    let type_cast_comment_end = comments
        .get_type_cast_comment_index(argument.span())
        .and_then(|index| comments.unprinted_comments().get(index))
        .map(|comment| comment.span.end);
    let is_before_type_cast = |comment: &Comment| type_cast_comment_end.is_none_or(|end| comment.span.start < end);
    let is_in_yield = matches!(argument.ast_parent(), AstNodes::YieldExpression(_));

    for left_side in ExpressionLeftSide::from(argument).iter() {
        let leading_comments = comments.comments_before(left_side.span().start);
        if leading_comments.iter().any(|comment| {
            (comment.is_multiline_block() || comment.followed_by_newline()) && is_before_type_cast(comment)
        }) {
            return true;
        }
        if is_in_yield || left_side.is_assignment_target {
            continue;
        }
        if let ExprKind::Dot { obj, name, .. } = left_side.expr.kind()
            && !name.bytes().starts_with(b"#")
            && comments.comments_in_range(obj.span().end, name.span().end).iter().any(|comment| {
                (comment.is_multiline_block() || comment.preceded_by_newline()) && is_before_type_cast(comment)
            })
        {
            return true;
        }
    }
    false
}
