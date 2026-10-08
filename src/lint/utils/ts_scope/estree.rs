//! Where ESTree draws a line that the syntax here does not.

use crate::ast::{Node, Stmt, StmtKind, StmtTag};

/// Whether ESTree has an `ExpressionStatement` for `statement`. The head of a `for` and the object
/// of a `with` are statements here and bare expressions there.
pub(super) fn is_expression_statement(statement: Stmt) -> bool {
    if statement.tag() != StmtTag::Expr {
        return false;
    }
    let Node::Stmt(parent) = statement.parent() else {
        return true;
    };
    match parent.kind() {
        StmtKind::For { init, .. } => init != Some(statement),
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left != statement,
        StmtKind::With { body, .. } => body == statement,
        _ => true,
    }
}
