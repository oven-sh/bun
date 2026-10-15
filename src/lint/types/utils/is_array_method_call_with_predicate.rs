//! `isArrayMethodCallWithPredicate.ts`

use super::get_constrained_type_at_location;
use crate::ast::Expr;
use crate::types::tsutils::{intersection_constituents, union_constituents};
use crate::utils::ts_utils;

/// Whether a constituent of the constrained type at `object` is an array or a tuple type.
fn is_array_or_tuple_type_at_location(object: Expr<'_>) -> bool {
    union_constituents(get_constrained_type_at_location(object))
        .iter()
        .flat_map(intersection_constituents)
        .any(|t| t.is_array_type() || t.is_tuple_type())
}

/// tsgolint's `IsArrayMethodCallWithPredicate`: the name of the callee is what the checker's
/// `getAccessedPropertyName` says.
fn is_array_method_call_with_predicate_of_tsgolint(node: Expr<'_>) -> bool {
    let Some(call) = node.as_call() else {
        return false;
    };
    let callee = call.callee();
    // `(a?.filter)(f)`: the parentheses end the chain, and the call is not a part of it.
    if callee.is_chain_root() {
        return false;
    }
    let Some(object) = callee.object() else {
        return false;
    };
    matches!(
        callee
            .file()
            .type_checker()
            .get_accessed_property_name(callee),
        Some(
            b"every"
                | b"filter"
                | b"find"
                | b"findIndex"
                | b"findLast"
                | b"findLastIndex"
                | b"some"
        )
    ) && is_array_or_tuple_type_at_location(object)
}

/// `isArrayMethodCallWithPredicate(context, services, node)`: whether the call `node` calls
/// `every`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex` or `some` of an array or a
/// tuple.
///
/// With a configuration of oxlint it is tsgolint's `IsArrayMethodCallWithPredicate`.
pub fn is_array_method_call_with_predicate(node: Expr) -> bool {
    if node.file().language().is_oxlint {
        return is_array_method_call_with_predicate_of_tsgolint(node);
    }
    ts_utils::is_array_method_call_with_predicate(node, is_array_or_tuple_type_at_location)
}
