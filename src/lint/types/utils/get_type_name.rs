//! `getTypeName.ts`

use super::has_room_on_the_stack;
use crate::types::{IdSet, SyntaxKind, Type, TypeFlags};

/// `getTypeName(typeChecker, type)`: `string` for what is a string, which is also a string literal
/// type, a union of those, an intersection with one, and a type parameter that extends one.
/// For any other type, [`Type::to_text`].
pub fn get_type_name(ty: Type) -> Vec<u8> {
    get_type_name_in(ty, &mut IdSet::new())
}

/// `on_the_way`: the type parameters whose constraints `ty` is in. `<T extends U, U extends T>` has no end.
fn get_type_name_in<'a>(ty: Type<'a>, on_the_way: &mut IdSet<Type<'a>>) -> Vec<u8> {
    if !has_room_on_the_stack() {
        return ty.to_text();
    }
    let flags = ty.flags();
    if flags.intersects(TypeFlags::STRING_LIKE) {
        return b"string".to_vec();
    }
    if flags.contains(TypeFlags::TYPE_PARAMETER)
        && !on_the_way.contains(ty)
        && let Some(constraint) = declared_constraint(ty)
    {
        on_the_way.insert(ty);
        let name = get_type_name_in(constraint, on_the_way);
        on_the_way.remove(ty);
        return name;
    }
    let mut is_string = |value: Type<'a>| get_type_name_in(value, on_the_way) == b"string";
    if flags.contains(TypeFlags::UNION) && ty.types().iter().all(&mut is_string) {
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
