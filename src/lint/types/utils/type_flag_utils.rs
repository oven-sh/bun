//! `typeFlagUtils.ts`

use crate::types::{Type, TypeFlags};

/// `getTypeFlags(type)`: the type's flags. For a union they're the flags of all its constituents, without `UNION`. So
/// `boolean` has `BOOLEAN_LITERAL`, not `BOOLEAN`.
#[inline]
pub fn get_type_flags(ty: Type) -> TypeFlags {
    ty.flags_of_constituents()
}

/// `isTypeFlagSet(type, flagsToCheck)`: true if the type, or a constituent if it's a union, has one of the flags. For
/// the type's own flags, use [`tsutils::is_type_flag_set`](crate::types::tsutils::is_type_flag_set).
#[inline]
pub fn is_type_flag_set(ty: Type, flags_to_check: TypeFlags) -> bool {
    get_type_flags(ty).intersects(flags_to_check)
}
