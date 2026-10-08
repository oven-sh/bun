//! `getTypeName.ts`

use super::MAX_DEPTH;
use crate::types::{SyntaxKind, Type, TypeFlags};

/// `getTypeName(typeChecker, type)`: `string` for what is a string, which is also a string literal
/// type, a union of those, an intersection with one, and a type parameter that extends one.
/// For any other type, [`Type::to_text`].
pub fn get_type_name(ty: Type) -> Vec<u8> {
    get_type_name_at(ty, 0)
}

fn get_type_name_at(ty: Type, depth: u32) -> Vec<u8> {
    if depth > MAX_DEPTH {
        return ty.to_text();
    }
    let flags = ty.flags();
    if flags.intersects(TypeFlags::STRING_LIKE) {
        return b"string".to_vec();
    }
    if flags.contains(TypeFlags::TYPE_PARAMETER)
        && let Some(constraint) = declared_constraint(ty)
    {
        return get_type_name_at(constraint, depth + 1);
    }
    let is_string = |value: Type| get_type_name_at(value, depth + 1) == b"string";
    if flags.contains(TypeFlags::UNION) && ty.types().iter().all(is_string) {
        return b"string".to_vec();
    }
    if flags.contains(TypeFlags::INTERSECTION) && ty.types().iter().any(is_string) {
        return b"string".to_vec();
    }
    ty.to_text()
}

/// `getTypeFromTypeNode(declaration.constraint)` for the first declaration of the type parameter.
fn declared_constraint(ty: Type<'_>) -> Option<Type<'_>> {
    let type_param_decl = ty.get_symbol()?.declarations().next()?;
    if type_param_decl.kind() != SyntaxKind::TypeParameter {
        return None;
    }
    Some(type_param_decl.constraint()?.get_type_from_type_node())
}
