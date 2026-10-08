use crate::prelude::*;
use crate::write;

/// `a, b, c`
pub(crate) fn write_sequence_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let parent = e.ast_parent();
    let is_arrow_body = matches!(parent, AstNodes::ExpressionStatement(statement) if statement.is_arrow_function_body());
    let is_indented = matches!(parent, AstNodes::ForStatement(_))
        || matches!(parent, AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body());
    let all = e.sequence();

    let format_inner = format_with(|f| {
        let mut expressions = all.iter();
        write!(f, expressions.next());
        if all.len() > 1 {
            write!(f, [",", line_suffix_boundary()]);
        }
        let rest = format_with(|f| {
            write!(f, soft_line_break_or_space());
            let separator = format_with(|f| write!(f, [",", line_suffix_boundary(), soft_line_break_or_space()]));
            f.join_with(separator).entries(expressions.clone());
        });
        match is_indented {
            true => write!(f, indent(&rest)),
            false => write!(f, rest),
        }
    });

    // As the body of an arrow function it is in parentheses, and whether it breaks is decided at
    // the `(`.
    match is_arrow_body {
        true => write!(f, group(&soft_block_indent(&format_inner))),
        false => write!(f, group(&format_inner)),
    }
}
