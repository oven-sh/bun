//! `isArrayMethodCallWithPredicate.ts`

use super::get_constrained_type_at_location;
use crate::ast::Expr;
use crate::types::tsutils::{intersection_constituents, union_constituents};
use crate::utils::ts_utils;

/// `isArrayMethodCallWithPredicate(context, services, node)`: whether the call `node` calls
/// `every`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex` or `some` of an array or a
/// tuple.
pub fn is_array_method_call_with_predicate(node: Expr) -> bool {
    ts_utils::is_array_method_call_with_predicate(node, |object| {
        union_constituents(get_constrained_type_at_location(object))
            .iter()
            .flat_map(intersection_constituents)
            .any(|t| t.is_array_type() || t.is_tuple_type())
    })
}
