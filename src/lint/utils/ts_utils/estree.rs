//! Which node of typescript-estree a handle stands for, where that decides an answer.

use crate::ast::{Expr, ExprKind, List, Node, Stmt, StmtKind};

/// Whether typescript-estree converts `e` as a pattern: it is the left of an assignment or of a
/// `for`-`in` or `for`-`of`, or an element, a property value or a rest argument of such a pattern.
/// Parentheses end it: the object of `({ a }) = b` is an `ObjectExpression`.
pub(super) fn is_pattern(e: Expr<'_>) -> bool {
    let mut at = e;
    loop {
        if at.is_parenthesized() {
            return false;
        }
        match at.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, .. } => return target == at,
                ExprKind::Array(_) | ExprKind::Spread(_) => at = parent,
                _ => return false,
            },
            Node::Prop(prop) => match prop.parent() {
                Node::Expr(object) if prop.value() == Some(at) && !prop.is_jsx_attribute() => {
                    at = object;
                }
                _ => return false,
            },
            Node::Stmt(statement) => {
                return matches!(
                    statement.kind(),
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }
                        if matches!(left.kind(), StmtKind::Expr(head) if head == at)
                );
            }
            _ => return false,
        }
    }
}

/// Whether `statement` is an `ExpressionStatement`.
#[inline]
pub(super) fn is_expression_statement(statement: Stmt<'_>) -> bool {
    matches!(statement.kind(), StmtKind::Expr(_)) && !statement.is_wrapper()
}

/// The `body` of the `Program`, the `BlockStatement` or the `TSModuleBlock` that `statement` is
/// directly in.
pub(super) fn sibling_statements<'a>(statement: Stmt<'a>) -> Option<List<'a, Stmt<'a>>> {
    match statement.parent() {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Block(statements) => Some(statements),
            StmtKind::Module(module) => Some(module.body()),
            _ => None,
        },
        _ => None,
    }
}
