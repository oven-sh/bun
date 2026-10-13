//! `getConstraintInfo.ts`

use crate::types::Type;
use crate::types::tsutils::is_type_parameter;

/// `ConstraintTypeInfo`
#[derive(Copy, Clone, Debug)]
pub struct ConstraintTypeInfo<'a> {
    /// The type itself if it is no type parameter. `None` for a type parameter without a
    /// constraint.
    pub constraint_type: Option<Type<'a>>,
    pub is_type_parameter: bool,
}

/// `getConstraintInfo(checker, type)`: whether the type is a type parameter, and what its
/// constraint is.
pub fn get_constraint_info(ty: Type<'_>) -> ConstraintTypeInfo<'_> {
    match is_type_parameter(ty) {
        true => ConstraintTypeInfo {
            constraint_type: ty.get_base_constraint_of_type(),
            is_type_parameter: true,
        },
        false => ConstraintTypeInfo {
            constraint_type: Some(ty),
            is_type_parameter: false,
        },
    }
}
