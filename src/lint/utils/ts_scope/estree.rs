//! Where ESTree draws a line that the syntax here does not.

use crate::ast::{Stmt, StmtTag};

/// Whether ESTree has an `ExpressionStatement` for `statement`. The head of a `for` and the object
/// of a `with` are statements here and bare expressions there.
#[inline]
pub(super) fn is_expression_statement(statement: Stmt) -> bool {
    statement.tag() == StmtTag::Expr && !statement.is_wrapper()
}
