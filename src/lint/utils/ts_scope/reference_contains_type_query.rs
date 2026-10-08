//! typescript-eslint's `util/referenceContainsTypeQuery.ts`.

use crate::ast::{ExprKind, Node};
use crate::semantic::Reference;

/// typescript-eslint's `referenceContainsTypeQuery`, of `reference.identifier`: the reference is
/// the `a` of a `typeof a` or a `typeof a.b.c` that is a type.
pub fn reference_contains_type_query(reference: Reference) -> bool {
    let Some(mut name) = reference.expr() else {
        return false;
    };
    // The whole names after `typeof` in types. Sorted.
    let operands = name.file().bound.type_query_operands;
    if operands.is_empty() {
        return false;
    }
    loop {
        if operands.binary_search(&name.id()).is_ok() {
            return true;
        }
        match name.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Dot { obj, .. } if obj == name) =>
            {
                name = parent;
            }
            _ => return false,
        }
    }
}
