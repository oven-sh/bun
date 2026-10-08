//! `containsAllTypesByName.ts`

use super::{MAX_DEPTH, Names, is_type_flag_set};
use crate::types::tsutils::{is_type_reference, is_union_or_intersection_type};
use crate::types::{Type, TypeFlags};

/// `containsAllTypesByName(type, allowAny, allowedNames, matchAnyInstead)`: whether the type is,
/// extends, or is made of nothing but types with one of the names.
///
/// - `allow_any`: `any` and `unknown` do not count as a match. A type that the checker gave up on
///   never does.
/// - `match_any_instead`: one constituent or base type that matches is enough.
pub fn contains_all_types_by_name(
    ty: Type,
    allow_any: bool,
    allowed_names: impl Names,
    match_any_instead: bool,
) -> bool {
    contains(ty, allow_any, allowed_names, match_any_instead, 0)
}

fn contains(
    mut ty: Type,
    allow_any: bool,
    allowed_names: impl Names,
    match_any_instead: bool,
    depth: u32,
) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    if is_type_flag_set(ty, TypeFlags::ANY | TypeFlags::UNKNOWN) {
        return !allow_any && !ty.is_unresolved();
    }
    if is_type_reference(ty) {
        ty = ty.target().unwrap_or(ty);
    }
    if ty
        .get_symbol()
        .is_some_and(|symbol| allowed_names.includes(symbol.name()))
    {
        return true;
    }
    let predicate = |t: Type| contains(t, allow_any, allowed_names, match_any_instead, depth + 1);
    if is_union_or_intersection_type(ty) {
        return match match_any_instead {
            true => ty.types().iter().any(predicate),
            false => ty.types().iter().all(predicate),
        };
    }
    let bases = ty.get_base_types();
    match match_any_instead {
        true => bases.iter().any(predicate),
        false => !bases.is_empty() && bases.iter().all(predicate),
    }
}
