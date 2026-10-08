//! typescript-eslint's `util/referenceContainsTypePredicate.ts`.

use crate::ast::{Node, TypeTag};
use crate::semantic::Reference;

/// typescript-eslint's `referenceContainsTypePredicate`, of `reference.identifier`: the reference
/// is the `x` of `x is T` or `asserts x`.
pub fn reference_contains_type_predicate(reference: Reference) -> bool {
    matches!(reference.node(), Node::Type(ty) if ty.tag() == TypeTag::Predicate)
}
