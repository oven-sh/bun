//! typescript-eslint's `util/referenceContainsTypeQuery.ts`.

use crate::ast::Expr;
use crate::semantic::Reference;

/// typescript-eslint's `referenceContainsTypeQuery`, for `reference.identifier`: the reference is
/// the `a` in a type `typeof a` or `typeof a.b.c`.
#[inline]
pub fn reference_contains_type_query(reference: Reference) -> bool {
    reference.expr().is_some_and(Expr::is_in_type_query)
}
