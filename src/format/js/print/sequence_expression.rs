use super::return_or_throw_statement::has_argument_leading_comments;
use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;
use crate::{format_args, write};

/// ```js
/// return (          return (
///   a(),              a(), b(), c
///   b(),            );
///   c
/// );
/// ```
///
/// Prettier on the left: what does not fit behind `return` has one expression on each line. oxfmt on the right.
fn sequence_after_return_is_a_group_of_its_own(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

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
    });
    match parent {
        // Whether it breaks is decided at the `(`.
        AstNodes::ExpressionStatement(_) => write!(f, group(&soft_block_indent(&format_inner))),
        // It is in parentheses of its own, unless the statement writes parentheses around a comment and what follows it.
        AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_)
            if !is_cast_target(e, f) && !has_argument_leading_comments(e, f) =>
        {
            match sequence_after_return_is_a_group_of_its_own(f) {
                true => write!(f, group(&soft_block_indent(&group(&format_inner)))),
                false => write!(f, group(&soft_block_indent(&format_inner))),
            }
        }
        _ => write!(f, group(&format_inner)),
    }
}
