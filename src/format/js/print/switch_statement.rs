use super::program::FormatStatements;
use crate::js::utils::statement_body::FormatStatementBody;
use crate::prelude::*;
use crate::{format_args, write};

pub(crate) fn write_switch_statement<'a>(
    _statement: Stmt<'a>,
    discriminant: Expr<'a>,
    cases: List<'a, Case<'a>>,
    f: &mut Formatter<'a>,
) {
    let format_cases = format_with(|f| match cases.is_empty() {
        true => write!(f, hard_line_break()),
        false => {
            f.join_nodes_with_hardline().entries(cases.iter());
        }
    });
    write!(
        f,
        [
            "switch",
            space(),
            "(",
            group(&soft_block_indent(&discriminant)),
            ")",
            space(),
            "{",
            block_indent(&format_cases),
            "}"
        ]
    );
}

/// `case a: ..`, `default: ..`
pub(crate) fn write_switch_case<'a>(case: Case<'a>, f: &mut Formatter<'a>) {
    match case.test() {
        Some(test) => write!(f, ["case", space(), test, ":"]),
        None => write!(f, ["default", ":"]),
    }

    let consequent = case.body();
    let Some(first_statement) = consequent.first() else {
        return;
    };
    // The `{` of a block that is all there is goes on the line of the `case`.
    let is_single_block_statement = matches!(first_statement.kind(), StmtKind::Block(_))
        && consequent.iter().skip(1).all(|statement| matches!(statement.kind(), StmtKind::Empty));

    if case.test().is_none() && !f.is_quiet() {
        let comments = match is_single_block_statement {
            true => f.comments().block_comments_before(first_statement.span().start),
            false => f.comments().end_of_line_comments_after(case.span().start + "default".len() as u32),
        };
        if !comments.is_empty() {
            write!(
                f,
                [
                    space(),
                    FormatDanglingComments::Comments {
                        comments,
                        indent: DanglingIndentMode::None
                    },
                ]
            );
        }
    }

    if is_single_block_statement {
        write!(f, FormatStatementBody::new(first_statement));
    } else {
        write!(f, indent(&format_args!(hard_line_break(), FormatStatements(consequent))));
    }
}
