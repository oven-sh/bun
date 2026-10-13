//! `isPromiseAggregatorMethod.ts`

use super::{get_constrained_type_at_location, is_promise_constructor_like};
use crate::ast::{Expr, ExprKind};
use crate::utils::ts_utils;

/// tsgolint's `isPromiseAggregatorMethod`: the callee is taken out of its parentheses, also where
/// they end an optional chain, and the name of the method is the checker's `getAccessedPropertyName`.
fn is_promise_aggregator_method_of_tsgolint(node: Expr) -> bool {
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

/// `isPromiseAggregatorMethod(context, services, node)`: whether the call `node` calls `all`,
/// `allSettled`, `race` or `any` of the `Promise` constructor.
pub fn is_promise_aggregator_method(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        return is_promise_aggregator_method_of_tsgolint(node);
    }
    ts_utils::is_promise_aggregator_method(node, |object| {
        is_promise_constructor_like(get_constrained_type_at_location(object))
    })
}
