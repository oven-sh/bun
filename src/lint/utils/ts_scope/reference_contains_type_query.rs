//! typescript-eslint's `util/referenceContainsTypeQuery.ts`.

use crate::ast::Expr;
use crate::semantic::Reference;

/// typescript-eslint's `referenceContainsTypeQuery`, of `reference.identifier`: the reference is
/// the `a` of a `typeof a` or a `typeof a.b.c` that is a type.
#[inline]
pub fn reference_contains_type_query(reference: Reference) -> bool {
    reference.expr().is_some_and(Expr::is_in_type_query)
}
