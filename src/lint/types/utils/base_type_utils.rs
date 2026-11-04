//! `baseTypeUtils.ts`

use super::has_room_on_the_stack;
use crate::types::tsutils::{
    intersection_constituents, is_object_type, is_type_reference, union_constituents,
};
use crate::types::{IdSet, ObjectFlags, Type, TypeFlags};

/// Returns the base types of the class or interface that `ty` is or instantiates.
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

/// `hasBaseTypes(type)`: true if it's the declared type of a class or interface, so [`Type::get_base_types`] applies.
pub fn has_base_types(ty: Type) -> bool {
    is_object_type(ty)
        && ty
            .object_flags()
            .intersects(ObjectFlags::INTERFACE | ObjectFlags::CLASS)
}

/// True if every constituent of the union has one of `flags`, or is an intersection with a constituent that does.
fn is_like(ty: Type, flags: TypeFlags) -> bool {
    union_constituents(ty).iter().all(|union_part| {
        intersection_constituents(union_part)
            .iter()
            .any(|it| it.has_flags(flags))
    })
}

/// `isNumberLike(type)`: `number`, `1`, a numeric enum, `number & { brand }`, or a union of these.
pub fn is_number_like(ty: Type) -> bool {
    is_like(ty, TypeFlags::NUMBER_LIKE)
}

/// `isStringLike(type)`: `string`, `"a"`, a template literal type, a string enum, `string & { brand }`, or a union of
/// these.
pub fn is_string_like(ty: Type) -> bool {
    is_like(ty, TypeFlags::STRING_LIKE)
}

/// `matchesTypeOrBaseType(services, matcher, type)`: true if `matcher` accepts the type or anything it extends,
/// directly or indirectly.
pub fn matches_type_or_base_type<'a>(
    mut matcher: impl FnMut(Type<'a>) -> bool,
    ty: Type<'a>,
) -> bool {
    matches(&mut matcher, ty, &mut IdSet::new())
}

fn matches<'a>(
    matcher: &mut dyn FnMut(Type<'a>) -> bool,
    ty: Type<'a>,
    seen: &mut IdSet<Type<'a>>,
) -> bool {
    if !has_room_on_the_stack() || !seen.insert(ty) {
        return false;
    }
    matcher(ty) || get_base_types_for_type(ty).any(|base| matches(matcher, base, seen))
}
