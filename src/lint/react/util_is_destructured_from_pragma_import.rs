#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/isDestructuredFromPragmaImport.js` of eslint-plugin-react.

use crate::util_variable::{get_latest_variable_definition, get_variable_from_context};
use bun_lint::prelude::*;

/// `e.type === "MemberExpression"`, where `e` is reached from above.
fn is_member_expression(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index) && !e.is_chain_root()
}

/// `astUtil.isCallExpression(e)`, where `e` is reached from above.
fn is_call_expression(e: Expr) -> bool {
    e.tag() == ExprTag::Call && !e.is_chain_root()
}

/// Whether `init` is `pragma.a`, `pragma`, `require("pragma")` or `require("pragma").a`.
fn is_from_pragma(init: Expr, pragma: &[u8]) -> bool {
    let is_pragma = |e: Expr| e.as_ident().is_some_and(|it| it.bytes() == pragma);
    let object = init.object().filter(|_| is_member_expression(init));
    if is_pragma(init) || object.is_some_and(is_pragma) {
        return true;
    }
    let require_expression = Some(init).filter(|it| is_call_expression(*it));
    let require_expression =
        require_expression.or_else(|| object.filter(|it| is_call_expression(*it)));
    require_expression
        .and_then(Expr::as_call)
        .is_some_and(|it| {
            let module = it.args().first().and_then(Expr::as_string);
            it.callee().is_ident("require")
                && module.is_some_and(|module| module.bytes() == pragma.to_ascii_lowercase())
        })
}

/// `isDestructuredFromPragmaImport(context, node, variable)`
pub(crate) fn is_destructured_from_pragma_import<'a>(
    node: Node<'a>,
    variable: Name<'a>,
    pragma: &[u8],
) -> bool {
    let variable_in_scope = get_variable_from_context(node, variable);
    let Some(latest_def) = variable_in_scope.and_then(get_latest_variable_definition) else {
        return false;
    };
    let import = match latest_def {
        Declaration::Var(_) => match latest_def.node() {
            Some(Node::VarDecl(it)) if !latest_def.is_catch_parameter() => {
                return it.init().is_some_and(|init| is_from_pragma(init, pragma));
            }
            _ => return false,
        },
        Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) => import,
        Declaration::ImportSpec(specifier) => specifier.import(),
        _ => return false,
    };
    import.spec().bytes() == pragma.to_ascii_lowercase()
}
