use super::program::FormatStatements;
use crate::prelude::*;
use crate::{format_args, write};

/// `{ .. }`
pub(crate) fn write_block_statement<'a>(
    statement: Stmt<'a>,
    body: List<'a, Stmt<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, "{");

    // See `write_catch_clause`.
    let can_be_handler = f.context().has_cached_elements()
        && matches!(statement.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::Try);
    let comments_before_catch_clause = match can_be_handler.then(|| statement.ast_parent()) {
        Some(parent @ AstNodes::CatchClause(_)) => f.context().get_cached_element(&parent.span()),
        _ => None,
    };
    let formatted_comments_before_catch_clause = format_with(|f| {
        if let Some(comments) = comments_before_catch_clause {
            f.write_element(comments);
        }
    });

    if is_empty_block(body) {
        // `try // comment\n{}`: the comments before the block that are not written yet are written
        // in it.
        if comments_before_catch_clause.is_some()
            || f.comments().has_comment_before(statement.span().end)
        {
            write!(
                f,
                block_indent(&format_args!(
                    formatted_comments_before_catch_clause,
                    format_dangling_comments(statement.span())
                ))
            );
        } else if is_non_collapsible(statement.ast_parent(), f) {
            write!(f, hard_line_break());
        }
    } else {
        write!(
            f,
            block_indent(&format_args!(
                formatted_comments_before_catch_clause,
                FormatStatements(body)
            ))
        );
    }
    write!(f, "}");
}

/// There is nothing in it but empty statements.
pub(crate) fn is_empty_block<'a>(block: List<'a, Stmt<'a>>) -> bool {
    block.iter().all(|it| it.tag() == StmtTag::Empty)
}

/// Whether an empty block in `parent` is written `{\n}` and not `{}`.
fn is_non_collapsible(parent: AstNodes<'_>, f: &Formatter<'_>) -> bool {
    match parent {
        // `function a() { {} }`: a statement in the body, not the body.
        AstNodes::FunctionBody(_) => !empty_block_in_function_body_collapses(f),
        AstNodes::ForStatement(_)
        | AstNodes::WhileStatement(_)
        | AstNodes::DoWhileStatement(_)
        | AstNodes::TSModuleDeclaration(_)
        | AstNodes::TSGlobalDeclaration(_) => false,
        AstNodes::CatchClause(statement) => statement.finalizer().is_some(),
        _ => true,
    }
}

fn empty_block_in_function_body_collapses(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}
