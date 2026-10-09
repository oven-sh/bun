#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/isCreateContext.js` of eslint-plugin-react.

use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;

/// `isCreateContext(node)`, for a `VarDecl` or an expression statement.
pub(crate) fn is_create_context(node: Node<'_>) -> bool {
    let is_call = |e: Expr| e.tag() == ExprTag::Call && !e.is_chain_root();
    let is_called = |callee: Expr| callee.is_ident("createContext");
    let is_member = |callee: Expr| is_member_called(callee, "createContext");
    match node {
        // A `new` expression has a `callee` too.
        Node::VarDecl(declaration) => declaration.init().is_some_and(|init| {
            let callee = init.callee().filter(|_| !init.is_chain_root());
            callee.is_some_and(|it| (is_call(init) && is_called(it)) || is_member(it))
        }),
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Expr(e) => match e.kind() {
                ExprKind::Assign {
                    op: None, value, ..
                } if is_call(value) => value
                    .callee()
                    .is_some_and(|it| is_called(it) || is_member(it)),
                _ => false,
            },
            _ => false,
        },
        _ => false,
    }
}
