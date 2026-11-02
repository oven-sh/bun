use super::program::{FormatStatements, is_next_line_empty};
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::{write_comments_before_token, write_space_before_body};
use crate::js::utils::typecast::comments_of_expression;
use crate::prelude::*;
use crate::{format_args, write};

#[inline(never)]
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

/// `case a: ..`, `default: ..`
pub(crate) fn write_switch_case<'a>(case: Case<'a>, f: &mut Formatter<'a>) {
    let consequent = case.body();
    let mut statements = consequent
        .iter()
        .filter(|it| !matches!(it.kind(), StmtKind::Empty));
    let first_statement = statements.next();
    let only_block = first_statement
        .filter(|it| matches!(it.kind(), StmtKind::Block(_)) && statements.next().is_none());
    if let Some(block) = only_block
        && !f.is_quiet()
        && comments_stay_between_head_and_body(f)
    {
        return write_switch_case_with_comments_in_place(case, block, f);
    }

    match case.test() {
        Some(test) => write!(f, ["case", space(), test, ":"]),
        None => write!(f, "default:"),
    }
    // `default: // comment`
    let node = AstNodes::SwitchCase(case);
    if !f.is_quiet() && !f.comments().of_node(node).dangling.is_empty() {
        write!(f, [space(), dangling_comments(node)]);
    }
    if first_statement.is_none() {
        return;
    }
    // If a block is the only statement, its `{` goes on the `case`'s line.
    match only_block {
        Some(_) => write!(f, [space(), FormatStatements(consequent)]),
        None => write!(
            f,
            indent(&format_args!(
                hard_line_break(),
                FormatStatements(consequent)
            ))
        ),
    }
}

/// See [`comments_stay_between_head_and_body`]: a `case` whose only statement is `block`. The comments before the `:` and
/// before the `{` keep their lines.
///
/// ```js
/// case a: // comment
/// {
/// }
/// case b
/// // comment
/// : {
/// }
/// ```
fn write_switch_case_with_comments_in_place<'a>(
    case: Case<'a>,
    block: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let mut follows_line_comment = false;
    match case.test() {
        Some(test) => {
            write!(
                f,
                ["case", space(), FormatNodeWithoutTrailingComments(&test)]
            );
            follows_line_comment =
                write_comments_before_token(comments_of_expression(test, f).trailing, f);
            write!(f, ":");
        }
        None => write!(f, "default:"),
    }
    match follows_line_comment {
        true => write!(f, hard_line_break()),
        false => write_space_before_body(block.as_ast_nodes(), f),
    }
    write!(f, FormatStatements(case.body()));
}
