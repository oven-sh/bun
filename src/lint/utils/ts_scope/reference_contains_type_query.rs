//! typescript-eslint's `util/referenceContainsTypeQuery.ts`.

use crate::ast::{ExprKind, Node, TypeTag};
use crate::semantic::Reference;

/// typescript-eslint's `referenceContainsTypeQuery`, of `reference.identifier`: the reference is
/// the `a` of a `typeof a` or a `typeof a.b.c` that is a type.
pub fn reference_contains_type_query(reference: Reference) -> bool {
    let Some(mut name) = reference.expr() else {
        return false;
    };
    loop {
        match name.parent() {
            Node::Type(ty) => return ty.tag() == TypeTag::Typeof,
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == name) =>
            {
                name = parent;
            }
            _ => return false,
        }
    }
}
