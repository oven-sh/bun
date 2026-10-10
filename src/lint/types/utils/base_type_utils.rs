//! `baseTypeUtils.ts`

use super::MAX_DEPTH;
use crate::types::tsutils::{
    intersection_constituents, is_object_type, is_type_reference, union_constituents,
};
use crate::types::{ObjectFlags, Type, TypeFlags};
use smallvec::SmallVec;

/// What the class or the interface extends that `ty` is, or is an instantiation of.
fn get_base_types_for_type(ty: Type<'_>) -> impl Iterator<Item = Type<'_>> {
    let interface_target = match is_type_reference(ty) {
        true => ty.target().unwrap_or(ty),
        false => ty,
    };
    let interface_type = Some(interface_target).filter(|&it| has_base_types(it));
    interface_type
        .into_iter()
        .flat_map(|it| it.get_base_types())
}

/// `hasBaseTypes(type)`: it is the declared type of a class or an interface, of which
/// [`Type::get_base_types`] can be asked.
pub fn has_base_types(ty: Type) -> bool {
    is_object_type(ty)
        && ty
            .object_flags()
            .intersects(ObjectFlags::INTERFACE | ObjectFlags::CLASS)
}

/// Whether every constituent of the union is, or as an intersection has, a type with one of
/// `flags`.
fn is_like(ty: Type, flags: TypeFlags) -> bool {
    union_constituents(ty).iter().all(|union_part| {
        intersection_constituents(union_part)
            .iter()
            .any(|it| it.has_flags(flags))
    })
}

/// `isNumberLike(type)`: `number`, `1`, a numeric enum, `number & { brand }`, a union of these.
pub fn is_number_like(ty: Type) -> bool {
    is_like(ty, TypeFlags::NUMBER_LIKE)
}

/// `isStringLike(type)`: `string`, `"a"`, a template literal type, a string enum,
/// `string & { brand }`, a union of these.
pub fn is_string_like(ty: Type) -> bool {
    is_like(ty, TypeFlags::STRING_LIKE)
}

/// `matchesTypeOrBaseType(services, matcher, type)`: whether `matcher` holds for the type, or for
/// anything that it extends, directly or not.
pub fn matches_type_or_base_type<'a>(
    mut matcher: impl FnMut(Type<'a>) -> bool,
    ty: Type<'a>,
) -> bool {
    matches(&mut matcher, ty, &mut SmallVec::new(), 0)
}

fn matches<'a>(
    matcher: &mut dyn FnMut(Type<'a>) -> bool,
    ty: Type<'a>,
    seen: &mut SmallVec<[Type<'a>; 8]>,
    depth: u32,
) -> bool {
    if depth > MAX_DEPTH || seen.contains(&ty) {
        return false;
    }
    seen.push(ty);
    matcher(ty) || get_base_types_for_type(ty).any(|base| matches(matcher, base, seen, depth + 1))
}
