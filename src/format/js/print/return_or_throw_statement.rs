use super::semicolon::OptionalSemicolon;
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

/// What has to start on the line of the keyword before it: the argument of `return` or `throw`.
/// If it breaks, or starts with a comment, it is written in parentheses.
struct FormatAdjacentArgument<'a>(Expr<'a>);

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
            write!(f, ["(", block_indent(&argument), ")"]);
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

    for left_side in ExpressionLeftSide::from(argument).iter() {
        let leading_comments = comments.comments_before(left_side.span().start);
        if leading_comments.iter().any(|comment| {
            (comment.is_multiline_block() || comment.followed_by_newline()) && is_before_type_cast(comment)
        }) {
            return true;
        }
        if left_side.is_assignment_target {
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
