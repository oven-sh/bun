//! `propertyTypes.ts`

use crate::types::{SymbolFlags, TsSymbol, Type};

/// `getTypeOfPropertyOfName(checker, type, name, escapedName)`: the type of the property `name`.
///
/// As upstream, for an `escaped_name` that stands for a symbol or a private name (`__@iterator`,
/// `__#1@#a`) it is `getDeclaredTypeOfSymbol` of the property, which for a property is the error
/// type.
pub fn get_type_of_property_of_name<'a>(
    ty: Type<'a>,
    name: &[u8],
    escaped_name: Option<&[u8]>,
) -> Option<Type<'a>> {
    let Some(escaped_name) = escaped_name.filter(|it| is_symbol(it)) else {
        return ty.get_type_of_property(name);
    };
    let escaped_property = ty
        .get_properties()
        .iter()
        .find(|property| property.escaped_name() == escaped_name)?;
    const DECLARES_A_TYPE: SymbolFlags = SymbolFlags::CLASS
        .union(SymbolFlags::INTERFACE)
        .union(SymbolFlags::TYPE_ALIAS)
        .union(SymbolFlags::TYPE_PARAMETER)
        .union(SymbolFlags::ENUM)
        .union(SymbolFlags::ENUM_MEMBER)
        .union(SymbolFlags::ALIAS);
    Some(match escaped_property.has_flags(DECLARES_A_TYPE) {
        true => escaped_property.get_declared_type(),
        false => ty.file().type_checker().get_error_type(),
    })
}

/// `getTypeOfPropertyOfType(checker, type, property)`
pub fn get_type_of_property_of_type<'a>(ty: Type<'a>, property: TsSymbol<'a>) -> Option<Type<'a>> {
    get_type_of_property_of_name(ty, property.name(), Some(property.escaped_name()))
}

fn is_symbol(escaped_name: &[u8]) -> bool {
    is_known_symbol(escaped_name) || is_private_identifier_symbol(escaped_name)
}

/// `__@foo@10`
fn is_known_symbol(escaped_name: &[u8]) -> bool {
    escaped_name.starts_with(b"__@")
}

/// `__#1@#foo`
fn is_private_identifier_symbol(escaped_name: &[u8]) -> bool {
    escaped_name.starts_with(b"__#")
}
