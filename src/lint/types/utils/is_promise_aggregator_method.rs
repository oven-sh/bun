//! `isPromiseAggregatorMethod.ts`

use super::{get_constrained_type_at_location, is_promise_constructor_like};
use crate::ast::{Expr, ExprKind};
use crate::utils::ts_utils;

/// tsgolint's `isPromiseAggregatorMethod`: unwraps the callee's parentheses, even where they end an optional chain, and
/// takes the method's name from the checker's `getAccessedPropertyName`.
fn tsgolint_is_promise_aggregator_method(node: Expr) -> bool {
    let ExprKind::Call(call) = node.kind() else {
        return false;
    };
    let callee = call.callee();
    let Some(object) = callee.object() else {
        return false;
    };
    matches!(
        callee
            .file()
            .type_checker()
            .get_accessed_property_name(callee),
        Some(b"all" | b"allSettled" | b"race" | b"any")
    ) && is_promise_constructor_like(get_constrained_type_at_location(object))
}

/// `isPromiseAggregatorMethod(context, services, node)`: true if the call `node` calls `all`, `allSettled`, `race` or
/// `any` on the `Promise` constructor.
pub fn is_promise_aggregator_method(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        return tsgolint_is_promise_aggregator_method(node);
    }
    ts_utils::is_promise_aggregator_method(node, |object| {
        is_promise_constructor_like(get_constrained_type_at_location(object))
    })
}
