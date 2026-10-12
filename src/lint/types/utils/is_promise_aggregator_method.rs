//! `isPromiseAggregatorMethod.ts`

use super::{get_constrained_type_at_location, is_promise_constructor_like};
use crate::ast::Expr;
use crate::utils::ts_utils;

/// `isPromiseAggregatorMethod(context, services, node)`: whether the call `node` calls `all`,
/// `allSettled`, `race` or `any` of the `Promise` constructor.
pub fn is_promise_aggregator_method(node: Expr) -> bool {
    ts_utils::is_promise_aggregator_method(node, |object| {
        is_promise_constructor_like(get_constrained_type_at_location(object))
    })
}
