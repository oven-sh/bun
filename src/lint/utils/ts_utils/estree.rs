//! Which typescript-estree node a handle corresponds to, where the answer depends on it.

use crate::ast::{Expr, ExprKind, ExprTag, List, Node, PropKind, Stmt, StmtKind};

/// True if typescript-estree converts `e` as a pattern: it's the left side of an assignment or of a
/// `for`-`in` or `for`-`of`, or an element, a property value or a rest argument of such a pattern.
/// Parentheses stop this: the object in `({ a }) = b` is an `ObjectExpression`.
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
            Node::Prop(prop) => {
                // The `a = 1` in `{ a = 1 }` is an `AssignmentPattern` wherever the object is.
                if prop.kind() == PropKind::Shorthand && matches!(at.tag(), ExprTag::Assign) {
                    return true;
                }
                match prop.parent() {
                    Node::Expr(object) if prop.value() == Some(at) && !prop.is_jsx_attribute() => {
                        at = object;
                    }
                    _ => return false,
                }
            }
            Node::Stmt(statement) => {
                return matches!(
                    statement.kind(),
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }
                        if matches!(left.as_expr(), Some(head) if head == at)
                );
            }
            _ => return false,
        }
    }
}

/// The `body` of the `Program`, `BlockStatement` or `TSModuleBlock` that directly contains
/// `statement`.
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
