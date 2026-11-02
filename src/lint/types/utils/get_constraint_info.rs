//! `getConstraintInfo.ts`

use crate::types::tsutils::is_type_parameter;
use crate::types::{SyntaxKind, Type};

/// `ConstraintTypeInfo`
#[derive(Copy, Clone, Debug)]
pub struct ConstraintTypeInfo<'a> {
    /// The type itself if it isn't a type parameter. `None` for a type parameter without a constraint.
    pub constraint_type: Option<Type<'a>>,
    pub is_type_parameter: bool,
}

/// `getConstraintInfo(checker, type)`: whether the type is a type parameter, and its constraint.
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

/// `checker.getConstraintOfTypeParameter(type)`: the constraint as declared, which can itself be a type parameter.
pub fn get_constraint_of_type_parameter(ty: Type<'_>) -> Option<Type<'_>> {
    if !is_type_parameter(ty) {
        return None;
    }
    let constraint = ty
        .get_symbol()?
        .declarations()
        .filter(|it| it.kind() == SyntaxKind::TypeParameter)
        .find_map(|it| it.constraint())?;
    Some(constraint.get_type_from_type_node())
}
