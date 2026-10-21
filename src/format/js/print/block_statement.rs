use super::program::FormatStatements;
use crate::prelude::*;
use crate::write;

/// `{ .. }`
#[inline(never)]
pub(crate) fn write_block_statement<'a>(
    statement: Stmt<'a>,
    body: List<'a, Stmt<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, "{");
    if is_empty_block(body) {
        let dangling = f
            .comments()
            .of_node(AstNodes::BlockStatement(statement))
            .dangling;
        if !dangling.is_empty() {
            write!(
                f,
                dangling_comments(AstNodes::BlockStatement(statement)).with_block_indent()
            );
        } else if is_non_collapsible(statement.ast_parent(), f) {
            write!(f, hard_line_break());
        }
    } else {
        write!(f, block_indent(&FormatStatements(body)));
    }
    write!(f, "}");
}

/// True if the block contains only empty statements.
pub(crate) fn is_empty_block<'a>(block: List<'a, Stmt<'a>>) -> bool {
    block.iter().all(|it| it.tag() == StmtTag::Empty)
}

/// True if an empty block in `parent` is printed as `{\n}` instead of `{}`.
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
