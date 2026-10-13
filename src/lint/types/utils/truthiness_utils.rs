//! `truthinessUtils.ts`

use crate::types::tsutils::{
    intersection_constituents, is_falsy_type, is_true_literal_type, union_constituents,
};
use crate::types::{Literal, Type, TypeFlags};

fn is_truthy_literal(ty: Type) -> bool {
    is_true_literal_type(ty)
        || ty.is_literal()
            && match ty.value() {
                Some(Literal::String(value)) => !value.is_empty(),
                Some(Literal::Number(value)) => value != 0.0 && !value.is_nan(),
                Some(Literal::BigInt { base10, .. }) => base10 != b"0",
                None => false,
            }
}

/// `isPossiblyFalsy(type)`: some value of the type is falsy. An intersection such as `string & {}`
/// is looked into.
pub fn is_possibly_falsy(ty: Type) -> bool {
    union_constituents(ty)
        .iter()
        .flat_map(intersection_constituents)
        // `POSSIBLY_FALSY` includes all literal types.
        .any(|t| t.has_flags(TypeFlags::POSSIBLY_FALSY) && !is_truthy_literal(t))
}

/// `isPossiblyTruthy(type)`: some value of the type is truthy. An intersection with a type that is
/// always falsy, such as `"" & { __brand: string }`, is always falsy.
pub fn is_possibly_truthy(ty: Type) -> bool {
    union_constituents(ty).iter().any(|union_part| {
        intersection_constituents(union_part)
            .iter()
            .all(|t| !is_falsy_type(t))
    })
}
