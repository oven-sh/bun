//! oxlint's `utils/promise.rs`.

use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, static_property_name};

pub(crate) const PROMISE_STATIC_METHODS: [&str; 8] = [
    "all",
    "allSettled",
    "any",
    "race",
    "reject",
    "resolve",
    "try",
    "withResolvers",
];

/// The name of the method, if `hello.then()`, `hello.catch()`, `hello.finally()` or a static method of `Promise` is called.
pub(crate) fn is_promise(call_expr: Call<'_>) -> Option<Name<'_>> {
    let member_expr = get_member_expr(call_expr.callee())?;
    let prop_name = static_property_name(member_expr)?;
    let is_promise = prop_name.is_any(&["then", "catch", "finally"])
        || prop_name.is_any(&PROMISE_STATIC_METHODS)
            && get_inner_expression(member_expr.object()?).is_ident("Promise");
    is_promise.then_some(prop_name)
}

/// Like [`is_promise`], but not for a receiver that is known to be no promise.
pub(crate) fn is_promise_with_context(call_expr: Call<'_>) -> Option<Name<'_>> {
    let prop_name = is_promise(call_expr)?;
    if !prop_name.is_any(&["then", "catch", "finally"]) {
        return Some(prop_name);
    }
    let receiver = get_member_expr(call_expr.callee())?.object()?;
    (!is_not_promise(receiver)).then_some(prop_name)
}

/// `classify_receiver(..) == ReceiverKind::NotPromise`
fn is_not_promise(receiver: Expr) -> bool {
    let mut at = receiver;
    // Not further than anybody writes it: `const a = b, b = a` goes in a circle, and of `const b = a, c = b ..` each can be a receiver.
    for _ in 0..32 {
        at = get_inner_expression(at);
        match at.kind() {
            ExprKind::New(new_expr) => return !is_promise_constructor(new_expr),
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Class(_) => {
                return true;
            }
            ExprKind::Ident(_) => {
                let declaration = at
                    .symbol()
                    .and_then(|it| it.declarations().next())
                    .filter(|it| !it.is_catch_parameter());
                let Some((Declaration::Var(_), Some(Node::VarDecl(declarator)))) =
                    declaration.map(|it| (it, it.node()))
                else {
                    return false;
                };
                match declarator.init() {
                    Some(init) => at = init,
                    None => return false,
                }
            }
            _ => return false,
        }
    }
    false
}

pub(crate) fn is_promise_constructor(new_expr: Call) -> bool {
    get_inner_expression(new_expr.callee()).is_ident("Promise")
}
