use super::program::{FormatStatements, is_next_line_empty};
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::statement_body::write_space_before_body;
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

/// `case a: ..`, `default: ..`
pub(crate) fn write_switch_case<'a>(case: Case<'a>, f: &mut Formatter<'a>) {
    match case.test() {
        Some(test) => write!(f, ["case", space(), test, ":"]),
        None => write!(f, "default:"),
    }
    // `default: // comment`
    let node = AstNodes::SwitchCase(case);
    if !f.is_quiet() && !f.comments().of_node(node).dangling.is_empty() {
        write!(f, [space(), dangling_comments(node)]);
    }

    let consequent = case.body();
    let mut statements = consequent
        .iter()
        .filter(|it| !matches!(it.kind(), StmtKind::Empty));
    let Some(first_statement) = statements.next() else {
        return;
    };
    // The `{` of a block that is all there is goes on the line of the `case`.
    if matches!(first_statement.kind(), StmtKind::Block(_)) && statements.next().is_none() {
        write_space_before_only_block(case, first_statement, f);
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

/// What separates the `:` of `case` from `block`, the only statement after it: a space.
///
/// See [`comments_stay_between_head_and_body`]: for oxfmt a line comment before the `:`, which is written behind it, ends
/// the line, and a comment on a line of its own stays there.
///
/// ```js
/// case a: // comment
/// {
/// }
/// ```
fn write_space_before_only_block<'a>(case: Case<'a>, block: Stmt<'a>, f: &mut Formatter<'a>) {
    let follows_line_comment = !f.is_quiet()
        && comments_stay_between_head_and_body(f)
        && f.comments()
            .has_printed_line_comment_after(case.span().start);
    match follows_line_comment {
        true => write!(f, hard_line_break()),
        false => write_space_before_body(block.as_ast_nodes(), f),
    }
}
