//! `promiseUtils.ts`

use crate::ast::{Expr, ExprKind};
use crate::utils::ts_utils::is_static_member_access_of_value;

/// The result of [`parse_then_call`].
#[derive(Copy, Clone, Debug)]
pub struct ThenCall<'a> {
    pub object: Expr<'a>,
    pub on_fulfilled: Option<Expr<'a>>,
    pub on_rejected: Option<Expr<'a>>,
}

/// The result of [`parse_catch_call`].
#[derive(Copy, Clone, Debug)]
pub struct CatchCall<'a> {
    pub object: Expr<'a>,
    pub on_rejected: Option<Expr<'a>>,
}

/// The result of [`parse_finally_call`].
#[derive(Copy, Clone, Debug)]
pub struct FinallyCall<'a> {
    pub object: Expr<'a>,
    pub on_finally: Option<Expr<'a>>,
}

/// If the call `node` is `object.method_name(..)`, returns the object and the first two arguments. A spread argument
/// and everything after it are `None`.
fn parse_method_call<'a>(
    node: Expr<'a>,
    method_name: &str,
) -> Option<(Expr<'a>, [Option<Expr<'a>>; 2])> {
    let call = node.as_call()?;
    let callee = call.callee();
    // `(a?.b)()` calls a `ChainExpression`.
    if callee.is_chain_root() {
        return None;
    }
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
        return None;
    };
    if !is_static_member_access_of_value(callee, &[method_name]) {
        return None;
    }
    let mut arguments = call
        .args()
        .iter()
        .take_while(|argument| !matches!(argument.kind(), ExprKind::Spread(_)));
    Some((obj, [arguments.next(), arguments.next()]))
}

/// `parseThenCall(node, context)`: the parts of what looks like `promise.then(..)`. The object's type isn't checked.
pub fn parse_then_call(node: Expr<'_>) -> Option<ThenCall<'_>> {
    let (object, [on_fulfilled, on_rejected]) = parse_method_call(node, "then")?;
    Some(ThenCall {
        object,
        on_fulfilled,
        on_rejected,
    })
}

/// `parseCatchCall(node, context)`: the parts of what looks like `promise.catch(..)`.
pub fn parse_catch_call(node: Expr<'_>) -> Option<CatchCall<'_>> {
    let (object, [on_rejected, _]) = parse_method_call(node, "catch")?;
    Some(CatchCall {
        object,
        on_rejected,
    })
}

/// `parseFinallyCall(node, context)`: the parts of what looks like `promise.finally(..)`.
pub fn parse_finally_call(node: Expr<'_>) -> Option<FinallyCall<'_>> {
    let (object, [on_finally, _]) = parse_method_call(node, "finally")?;
    Some(FinallyCall { object, on_finally })
}
