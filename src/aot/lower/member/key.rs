use bun_sema::atom::{Atom, number_to_string};
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, MemberKey, PropKey};

use super::PropertyName;
use crate::builtins::table;
use crate::builtins::{
    BuiltinName, BuiltinNames, Intrinsic, IntrinsicPosition, Mutability, Resolved, SourceDialect,
    find_intrinsic, find_symbol_key,
};
use crate::ir::generated::NameClass;
use crate::ir::{PropertyKey, PropertyKeyId, PropertyKeyKind, StringId, ValueId};
use crate::lower::{FileLowering, FunctionLowering, expression};
use crate::modules::ModuleRef;

pub(super) fn name_key(file: &mut FileLowering<'_, '_, '_, '_>, name: Atom) -> PropertyKeyId {
    match file.source.dialect() {
        SourceDialect::Program => file.atom_key(name),
        SourceDialect::Runtime => runtime_name_key(file, name),
    }
}

// The key that the engine gives the symbol of `const name = Symbol(..)`: where the call stands, and the description.
pub(in crate::lower) fn created_symbol_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    name: Atom,
) -> Option<PropertyKeyId> {
    let creation = file.queries.symbol_creation(name)?;
    if !file.queries.files().is_compiled(creation.file) || file.inputs.is_left_out(creation.file) {
        return None;
    }
    let module = file.fragment.declare_module(ModuleRef::File(creation.file));
    let description = creation.description.map(|text| file.intern_atom(text));
    let key = PropertyKey::from_created_symbol(module, creation.position, description);
    Some(file.fragment.property_keys.intern(key))
}

fn runtime_name_key(file: &mut FileLowering<'_, '_, '_, '_>, name: Atom) -> PropertyKeyId {
    let names = file.inputs.builtin_names;
    if let Some(symbol) = find_symbol_key(names, name) {
        return file.symbol_key(symbol);
    }
    let Some(private_name) = find_engine_private_name(names, name) else {
        return file.atom_key(name);
    };
    let text = file.intern_bytes(table::text_of_name(private_name));
    let key = PropertyKey::from_engine_private_name(text);
    file.fragment.property_keys.intern(key)
}

fn find_engine_private_name(names: &BuiltinNames, spelling: Atom) -> Option<BuiltinName> {
    match find_intrinsic(names, spelling, IntrinsicPosition::Member) {
        Some(Intrinsic::PrivateName) => names.get_private(spelling),
        Some(_) | None => None,
    }
}

fn find_constant_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: ExprId,
) -> Option<PropertyKeyId> {
    match expression::find_constant(file, key) {
        Some(Constant::String(name)) => Some(name_key(file, name)),
        Some(Constant::Number(number)) => {
            let text = file.intern_bytes(&number_to_string(number));
            Some(file.text_key(text))
        }
        Some(Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_)) => {
            None
        }
        None => find_locked_symbol_key(file, key),
    }
}

fn find_locked_symbol_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: ExprId,
) -> Option<PropertyKeyId> {
    let path = match file
        .builtins
        .of_expr(expression::skip_type_syntax(file, key))
    {
        Some(Resolved::Builtin(path)) => path,
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => return None,
    };
    match path.mutability {
        Mutability::AlwaysLocked => {
            let symbol = table::well_known_symbol(path.id)?;
            Some(file.symbol_key(symbol))
        }
        Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn => None,
    }
}

pub(super) fn lower_property_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: PropKey,
) -> PropertyName {
    match key {
        PropKey::Name(name) => PropertyName::Constant(name_key(lowering.file, name)),
        PropKey::Computed(computed) => lower_converted_key(lowering, computed),
        PropKey::Private(_) | PropKey::None => {
            debug_assert!(false, "the caller handles private names");
            PropertyName::Computed(lowering.builder.undefined())
        }
    }
}

fn lower_converted_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: ExprId,
) -> PropertyName {
    if let Some(found) = find_constant_key(lowering.file, key) {
        return PropertyName::Constant(found);
    }
    let value = expression::lower_expression(lowering, key);
    lowering.set_position(lowering.file.hir[key].pos);
    PropertyName::Computed(lowering.builder.to_property_key(value))
}

pub(super) fn emit_name_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: PropertyName,
) -> ValueId {
    let key = match name {
        PropertyName::Constant(key) => *lowering.file.fragment.property_keys.get(key),
        PropertyName::Computed(value) => return value,
    };
    match key.kind {
        PropertyKeyKind::Text => {
            let text = key.text.expect("a text key has its text");
            lowering.builder.string(text)
        }
        PropertyKeyKind::WellKnownSymbol => {
            let symbol = key
                .symbol
                .expect("a well-known symbol key names its symbol");
            expression::emit_locked_builtin(lowering, table::symbol_constant(symbol))
        }
        _ => {
            debug_assert!(false, "no constant is the value of a key of this kind");
            lowering.builder.undefined()
        }
    }
}

pub(super) fn find_element_index(
    file: &FileLowering<'_, '_, '_, '_>,
    key: PropertyKeyId,
) -> Option<u32> {
    let key = file.fragment.property_keys.get(key);
    let text = match key.kind {
        PropertyKeyKind::Text => key.text?,
        _ => return None,
    };
    let strings = &file.fragment.strings;
    if strings.name_class(text) != NameClass::Index {
        return None;
    }
    let digits = strings.get(text).iter();
    Some(digits.fold(0, |index, digit| index * 10 + u32::from(digit - b'0')))
}

pub(in crate::lower) fn find_key_text(
    file: &FileLowering<'_, '_, '_, '_>,
    key: PropertyKeyId,
) -> Option<StringId> {
    file.fragment.property_keys.get(key).string_name()
}

/// The name in the header of a function defined under the key.
pub(in crate::lower) fn find_function_name(
    file: &FileLowering<'_, '_, '_, '_>,
    key: PropertyKeyId,
) -> Option<StringId> {
    let key = file.fragment.property_keys.get(key);
    match key.kind {
        PropertyKeyKind::WellKnownSymbol | PropertyKeyKind::CreatedSymbol => None,
        _ => key.string_name(),
    }
}

/// What the property `name` of a function defined under a well-known symbol holds: "[Symbol.dispose]".
pub(in crate::lower) fn find_name_under_symbol(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: PropertyKeyId,
) -> Option<StringId> {
    let key = file.fragment.property_keys.get(key);
    if key.kind != PropertyKeyKind::WellKnownSymbol {
        return None;
    }
    let (first, rest) = key.symbol?.name().split_at(1);
    let name = format!("[Symbol.{}{rest}]", first.to_ascii_lowercase());
    Some(file.intern_bytes(name.as_bytes()))
}

pub(in crate::lower) fn lower_member_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberKey,
) -> PropertyName {
    match member {
        MemberKey::Name(name) => {
            let key = name_key(lowering.file, name);
            normalize_access_key(lowering, key)
        }
        MemberKey::Computed(key) => lower_computed_key(lowering, key),
        MemberKey::PrivateName(_) => {
            debug_assert!(false, "the caller handles private names");
            PropertyName::Computed(lowering.builder.undefined())
        }
    }
}

pub(in crate::lower) fn lower_computed_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: ExprId,
) -> PropertyName {
    match find_constant_key(lowering.file, key) {
        Some(found) => normalize_access_key(lowering, found),
        None => PropertyName::Computed(expression::lower_expression(lowering, key)),
    }
}

fn normalize_access_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: PropertyKeyId,
) -> PropertyName {
    match find_element_index(lowering.file, key) {
        Some(index) => PropertyName::Computed(lowering.builder.integer(i64::from(index))),
        None => PropertyName::Constant(key),
    }
}
