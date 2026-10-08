//! Which node of typescript-estree a handle stands for, where that decides an answer.

use crate::ast::{Chain, Expr, ExprKind, List, Node, Stmt, StmtKind};

/// A member access, a call or a `!` after the first `?.` of an optional chain.
fn is_chain_link(e: Expr<'_>) -> bool {
    let mut at = e;
    while let ExprKind::NonNull(inner) = at.kind() {
        if inner.is_parenthesized() {
            return false;
        }
        at = inner;
    }
    at.chain() != Chain::No
}

/// Whether typescript-estree has a `ChainExpression` around `e`: it is all of `a?.b.c()` or of
/// `a?.b!`, not a part of it.
pub(super) fn is_chain_expression(e: Expr<'_>) -> bool {
    if !is_chain_link(e) {
        return false;
    }
    if e.is_parenthesized() {
        return true;
    }
    let Node::Expr(parent) = e.parent() else {
        return true;
    };
    match parent.kind() {
        ExprKind::NonNull(_) => false,
        ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
            obj != e || chain == Chain::No
        }
        ExprKind::Call(call) => call.callee() != e || call.chain() == Chain::No,
        _ => true,
    }
}

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
                    statement.parent().as_stmt().map(Stmt::kind),
                    Some(StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. })
                        if left == statement
                );
            }
            _ => return false,
        }
    }
}

/// Whether `statement` is an `ExpressionStatement`. The initializer of a `for`, the left of a
/// `for`-`in` or a `for`-`of` and the object of a `with` are `StmtKind::Expr` too.
pub(super) fn is_expression_statement(statement: Stmt<'_>) -> bool {
    if !matches!(statement.kind(), StmtKind::Expr(_)) {
        return false;
    }
    match statement.parent().as_stmt().map(Stmt::kind) {
        Some(StmtKind::For { init, .. }) => init != Some(statement),
        Some(StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) => left != statement,
        Some(StmtKind::With { body, .. }) => body == statement,
        _ => true,
    }
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
