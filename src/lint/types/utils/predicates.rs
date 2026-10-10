//! `predicates.ts`

use super::is_type_flag_set;
use crate::types::tsutils::union_constituents;
use crate::types::{ObjectFlags, Type, TypeFlags};

/// `isNullableType(type)`: it is, or as a union has, `any`, `unknown`, `null`, `undefined` or
/// `void`.
pub fn is_nullable_type(ty: Type) -> bool {
    is_type_flag_set(
        ty,
        TypeFlags::ANY
            | TypeFlags::UNKNOWN
            | TypeFlags::NULL
            | TypeFlags::UNDEFINED
            | TypeFlags::VOID,
    )
}

/// `isTypeArrayTypeOrUnionOfArrayTypes(type, checker)`: an array type, or a union of nothing but
/// array types.
pub fn is_type_array_type_or_union_of_array_types(ty: Type) -> bool {
    union_constituents(ty).iter().all(|t| t.is_array_type())
}

/// `isTypeNeverType(type)`
#[inline]
pub fn is_type_never_type(ty: Type) -> bool {
    is_type_flag_set(ty, TypeFlags::NEVER)
}

/// `isTypeUnknownType(type)`
#[inline]
pub fn is_type_unknown_type(ty: Type) -> bool {
    is_type_flag_set(ty, TypeFlags::UNKNOWN)
}

/// `isTypeReferenceType(type)`: a reference to a generic class or interface, an array or a tuple
/// type.
pub fn is_type_reference_type(ty: Type) -> bool {
    ty.flags().intersects(TypeFlags::OBJECT_FLAGS_TYPE)
        && ty.object_flags().intersects(ObjectFlags::REFERENCE)
}

/// `isTypeAnyType(type)`: `any`, which the error type is too. A type that the checker gave up on
/// is not.
pub fn is_type_any_type(ty: Type) -> bool {
    is_type_flag_set(ty, TypeFlags::ANY) && !ty.is_unresolved()
}

/// `isTypeAnyArrayType(type, checker)`: `any[]` or `readonly any[]`
pub fn is_type_any_array_type(ty: Type) -> bool {
    ty.is_array_type()
        && ty
            .get_type_arguments()
            .first()
            .is_some_and(is_type_any_type)
}

/// `isTypeUnknownArrayType(type, checker)`: `unknown[]` or `readonly unknown[]`
pub fn is_type_unknown_array_type(ty: Type) -> bool {
    ty.is_array_type()
        && ty
            .get_type_arguments()
            .first()
            .is_some_and(is_type_unknown_type)
}

/// `typeIsOrHasBaseType(type, parentType)`: whether the type, or one of the types that it directly
/// extends, has the name of `parent_type`.
pub fn type_is_or_has_base_type<'a>(ty: Type<'a>, parent_type: Type<'a>) -> bool {
    let (Some(symbol), Some(parent_symbol)) = (ty.get_symbol(), parent_type.get_symbol()) else {
        return false;
    };
    let parent_name = parent_symbol.name();
    symbol.name() == parent_name
        || ty.get_base_types().iter().any(|base_type| {
            base_type
                .get_symbol()
                .is_some_and(|it| it.name() == parent_name)
        })
}
