#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/isCreateElement.js` of eslint-plugin-react.

use crate::util_is_destructured_from_pragma_import::is_destructured_from_pragma_import;
use bun_lint::prelude::*;

/// `callee.type === "MemberExpression" && callee.property.name === name`: also `a[name]` and
/// `a.#name`.
pub(crate) fn is_member_called(callee: Expr, name: &str) -> bool {
    !callee.is_chain_root()
        && match callee.kind() {
            ExprKind::Dot { name: property, .. } => {
                let written = property.bytes();
                written.strip_prefix(b"#").unwrap_or(written) == name.as_bytes()
            }
            ExprKind::Index { index, .. } => index.is_ident(name),
            _ => false,
        }
}

/// `isCreateElement(context, node)`, for a `Call` or a `New`.
pub(crate) fn is_create_element(node: Expr<'_>, pragma: &[u8]) -> bool {
    let Some(callee) = node.callee() else {
        return false;
    };
    let object = callee.object().and_then(Expr::as_ident);
    if is_member_called(callee, "createElement") && object.is_some_and(|it| it.bytes() == pragma) {
        return true;
    }
    callee.as_ident().is_some_and(|name| {
        name.is("createElement")
            && is_destructured_from_pragma_import(Node::Expr(node), name, pragma)
    })
}
