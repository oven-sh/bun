use bun_sema::bind::SymbolId;
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, MemberKey};

use crate::ir::generated::NameClass;
use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::expression::{
    find_constant, is_chain_root, is_statically_resolved, skip_type_syntax,
};
use crate::lower::{FileLowering, FunctionLowering, member, scope};

#[derive(Copy, Clone)]
pub(in crate::lower) struct TestedField {
    holder: SymbolId,
    holder_value: ValueId,
    key: PropertyKeyId,
}

// Call right after lowering `expression`: reading the holder can rebind it to a converted value.
pub(in crate::lower) fn find_tested_field(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<TestedField> {
    let access = skip_type_syntax(lowering.file, expression);
    let (object, member_key) = lowering.file.hir.member_key(access)?;
    if is_chain_root(lowering.file, access) {
        return None;
    }
    let identifier = super::tested_identifier(lowering.file, object)?;
    let holder = scope::find_tested_local(lowering, identifier)?;
    if !is_runtime_property_read(lowering.file, expression, access) {
        return None;
    }
    let key = find_field_key(lowering.file, member_key)?;
    Some(TestedField {
        holder,
        holder_value: scope::read_local(lowering, holder),
        key,
    })
}

pub(super) fn has_unit_type(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    let Ok(ty) = file.queries.expression_type(expression) else {
        return false;
    };
    let Ok(shape) = file.queries.type_shape(ty) else {
        return false;
    };
    matches!(
        shape.kind,
        ShapeKind::Undefined
            | ShapeKind::Null
            | ShapeKind::BooleanLiteral(_)
            | ShapeKind::NumberLiteral(_)
            | ShapeKind::NumericEnumMember(_)
            | ShapeKind::StringLiteral(_)
    )
}

pub(in crate::lower) fn is_holder_unchanged(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    field: TestedField,
) -> bool {
    scope::read_local(lowering, field.holder) == field.holder_value
}

// The store to the holder can split the current block, so continue in `builder.current_block()`.
pub(in crate::lower) fn narrow_holder(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    field: TestedField,
    read: ValueId,
) -> Option<TestedField> {
    if !is_holder_unchanged(lowering, field) {
        return None;
    }
    let narrowed = lowering
        .builder
        .narrow_by_field(field.holder_value, read, field.key);
    scope::rebind_local(lowering, field.holder, narrowed);
    Some(TestedField {
        holder_value: narrowed,
        ..field
    })
}

fn find_field_key(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member_key: MemberKey,
) -> Option<PropertyKeyId> {
    let name = match member_key {
        MemberKey::Name(name) => name,
        MemberKey::Computed(key) => match find_constant(file, key) {
            Some(Constant::String(name)) => name,
            Some(
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::Number(_)
                | Constant::BigInt(_),
            )
            | None => return None,
        },
        MemberKey::PrivateName(_) => return None,
    };
    let key = member::name_key(file, name);
    let text = member::find_key_text(file, key)?;
    (file.fragment.strings.name_class(text) != NameClass::Index).then_some(key)
}

// NarrowByField removes null and undefined from the holder, so the read must really run.
fn is_runtime_property_read(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
    access: ExprId,
) -> bool {
    let mut layer = Some(expression);
    while let Some(current) = layer {
        if is_statically_resolved(file, current) {
            return false;
        }
        layer = file.hir.type_assertion_operand(current);
    }
    if file
        .inputs
        .modules
        .member_binding(file.file, access)
        .is_some()
    {
        return false;
    }
    if !file.hir.has_typescript_semantics() {
        return true;
    }
    match file.queries.constant_enum_access(access) {
        Ok(Some(_)) => false,
        Ok(None) | Err(_) => true,
    }
}
