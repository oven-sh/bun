//! `isTypeBrandedLiteralLike.ts`

use crate::types::tsutils::is_object_type;
use crate::types::{Type, TypeFlags};

fn is_literal_or_taggable_primitive_like(ty: Type) -> bool {
    ty.is_literal()
        || ty.has_flags(
            TypeFlags::BIG_INT
                | TypeFlags::NUMBER
                | TypeFlags::STRING
                | TypeFlags::TEMPLATE_LITERAL,
        )
}

fn is_object_literal_like(ty: Type) -> bool {
    is_object_type(ty)
        && ty.get_call_signatures().is_empty()
        && ty.get_construct_signatures().is_empty()
}

fn is_type_branded_literal(ty: Type) -> bool {
    if !ty.is_intersection() {
        return false;
    }
    let (mut had_object_like, mut had_primitive_like) = (false, false);
    for constituent in ty.types() {
        if is_object_literal_like(constituent) {
            had_object_like = true;
        } else if is_literal_or_taggable_primitive_like(constituent) {
            had_primitive_like = true;
        } else {
            return false;
        }
    }
    had_primitive_like && had_object_like
}

/// `isTypeBrandedLiteralLike(type)`: `string & { __brand: "a" }`, or a union of such types.
pub fn is_type_branded_literal_like(ty: Type) -> bool {
    match ty.is_union() {
        true => ty.types().iter().all(is_type_branded_literal),
        false => is_type_branded_literal(ty),
    }
}
