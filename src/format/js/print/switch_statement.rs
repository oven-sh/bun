use super::program::{FormatStatements, is_next_line_empty};
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::{write_comments_before_token, write_space_before_body};
use crate::js::utils::typecast::comments_of_expression;
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
        let node = AstNodes::SwitchStatement(statement);
        match f.comments().of_node(node).dangling.is_empty() {
            true => write!(f, hard_line_break()),
            false => write!(f, dangling_comments(node).with_block_indent()),
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

/// `case a:`, `default:`, and the comments on that line. Returns whether a line break has to follow, because a line comment
/// is waiting for the end of the line.
fn write_switch_case_head<'a>(case: Case<'a>, f: &mut Formatter<'a>) -> bool {
    let node = AstNodes::SwitchCase(case);
    let dangling = match f.is_quiet() {
        true => CommentList::empty(),
        false => f.comments().of_node(node).dangling,
    };
    let mut follows_line_comment = false;
    match case.test() {
        // See `comments_stay_between_head_and_body`: a comment on a line of its own before the `:` stays there.
        Some(test) if !f.is_quiet() && comments_stay_between_head_and_body(f) => {
            write!(
                f,
                ["case", space(), FormatNodeWithoutTrailingComments(&test)]
            );
            follows_line_comment =
                write_comments_before_token(comments_of_expression(test, f).trailing, f);
            write!(f, ":");
        }
        Some(test) => write!(f, ["case", space(), test, ":"]),
        None => write!(f, "default:"),
    }
    // `default: // comment`
    if let Some(last) = dangling.last() {
        write!(f, [space(), dangling_comments(node)]);
        follows_line_comment = last.is_line();
    }
    follows_line_comment
}

/// `case a: ..`, `default: ..`
pub(crate) fn write_switch_case<'a>(case: Case<'a>, f: &mut Formatter<'a>) {
    let follows_line_comment = write_switch_case_head(case, f);

    let consequent = case.body();
    let mut statements = consequent
        .iter()
        .filter(|it| !matches!(it.kind(), StmtKind::Empty));
    let Some(first_statement) = statements.next() else {
        return;
    };
    // The `{` of a block that is all there is goes on the line of the `case`.
    if matches!(first_statement.kind(), StmtKind::Block(_)) && statements.next().is_none() {
        // See `comments_stay_between_head_and_body`: `case a: // comment⏎{⏎}`
        match follows_line_comment && comments_stay_between_head_and_body(f) {
            true => write!(f, hard_line_break()),
            false => write_space_before_body(first_statement.as_ast_nodes(), f),
        }
        write!(f, FormatStatements(consequent));
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
