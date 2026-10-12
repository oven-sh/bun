use super::program::{FormatStatements, is_next_line_empty};
use crate::js::format::write_declaration;
use crate::js::trivia::{comments_stay_between_head_and_body, write_trailing_comments_before};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::FormatStatementBody;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};

pub(crate) fn write_switch_statement<'a>(
    statement: Stmt<'a>,
    discriminant: Expr<'a>,
    cases: List<'a, Case<'a>>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() && super::flow::write_match_statement(statement, discriminant, cases, f) {
        return;
    }
    write!(
        f,
        [
            "switch",
            space(),
            "(",
            group(&soft_block_indent(&discriminant)),
            ")",
            space(),
            "{"
        ]
    );
    if cases.is_empty() {
        match f.comments().has_comment_before(statement.span().end) {
            true => write!(
                f,
                format_dangling_comments(statement.span()).with_block_indent()
            ),
            false => write!(f, hard_line_break()),
        }
        return write!(f, "}");
    }
    let format_cases = format_with(|f| {
        let mut previous: Option<Case<'a>> = None;
        for case in cases.iter() {
            if let Some(previous) = previous {
                match is_next_line_empty(f.source_text(), previous.span().end) {
                    true => write!(f, empty_line()),
                    false => write!(f, hard_line_break()),
                }
            }
            write!(f, case);
            previous = Some(case);
        }
    });
    write!(f, [block_indent(&format_cases), "}"]);
}

/// `case a: ..`, `default: ..`
pub(crate) fn write_switch_case<'a>(case: Case<'a>, f: &mut Formatter<'a>) {
    // `case 1: a(); // prettier-ignore`: the comment is not in the `case`, so it trails all of it.
    if !f.is_quiet()
        && f.comments()
            .has_trailing_suppression_comment(case.span().end)
    {
        return write!(f, FormatSuppressedNode(case.span()));
    }
    let consequent = case.body();
    let mut statements = consequent
        .iter()
        .filter(|it| !matches!(it.kind(), StmtKind::Empty));
    if !f.is_quiet()
        && comments_stay_between_head_and_body(f)
        && let (Some(block), None) = (statements.clone().next(), statements.clone().nth(1))
        && matches!(block.kind(), StmtKind::Block(_))
    {
        match case.test() {
            Some(test) => {
                write!(
                    f,
                    ["case", space(), FormatNodeWithoutTrailingComments(&test)]
                );
                let follows_line_comment = write_trailing_comments_before(test.span().end, b':', f);
                write!(f, [":", follows_line_comment.then_some(hard_line_break())]);
            }
            None => write!(f, ["default", ":"]),
        }
        return write!(f, FormatStatementBody::new(block));
    }
    match case.test() {
        Some(test) => write!(f, ["case", space(), test, ":"]),
        None => write!(f, ["default", ":"]),
    }

    let Some(first_statement) = statements.next() else {
        // `default /* comment */:`
        if case.test().is_none() && f.comments().has_comment_before(case.span().end) {
            write!(f, [space(), format_dangling_comments(case.span())]);
        }
        return;
    };
    // The `{` of a block that is all there is goes on the line of the `case`.
    let is_single_block_statement =
        matches!(first_statement.kind(), StmtKind::Block(_)) && statements.next().is_none();

    // Prettier's `handleSwitchDefaultCaseComments`: the comments on the line of `default:` stay
    // there, but for a line comment before a block, which is written in the block.
    if case.test().is_none() && !f.is_quiet() && consequent.first() == Some(first_statement) {
        let mut comments = f
            .comments()
            .end_of_line_comments_after(case.span().start + "default".len() as u32);
        let mut is_comment_in_block = false;
        if let [rest @ .., last] = comments
            && last.is_line()
            && matches!(first_statement.kind(), StmtKind::Block(_))
        {
            comments = rest;
            is_comment_in_block = true;
        }
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
        if is_comment_in_block && is_single_block_statement {
            write!(f, space());
            return write_declaration(first_statement, f);
        }
    }

    if is_single_block_statement {
        write!(f, [space(), FormatStatements(consequent)]);
    } else {
        write!(
            f,
            indent(&format_args!(
                hard_line_break(),
                FormatStatements(consequent)
            ))
        );
    }
}
