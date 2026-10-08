//! `typeFlagUtils.ts`

use crate::types::{Type, TypeFlags};

/// `getTypeFlags(type)`: the flags of the type, which for a union are those of all its constituents
/// and not `UNION`. So `boolean` has `BOOLEAN_LITERAL`, not `BOOLEAN`.
pub fn get_type_flags(ty: Type) -> TypeFlags {
    let flags = ty.flags();
    if !flags.contains(TypeFlags::UNION) {
        return flags;
    }
    ty.types()
        .iter()
        .fold(TypeFlags::empty(), |flags, t| flags | t.flags())
}

/// `isTypeFlagSet(type, flagsToCheck)`: whether the type, or a constituent of the union that it is,
/// has one of the flags. For the type itself,
/// [`tsutils::is_type_flag_set`](crate::types::tsutils::is_type_flag_set).
#[inline]
pub fn is_type_flag_set(ty: Type, flags_to_check: TypeFlags) -> bool {
    get_type_flags(ty).intersects(flags_to_check)
}
