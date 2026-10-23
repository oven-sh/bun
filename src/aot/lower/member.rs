mod key;
mod reference;

use bun_sema::atom::{Atom, known};
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{Chain, ExprId, ExprKind, MemberKey, NodeData, PropKey};
use bun_sema::types::EnumValue;

use super::{
    FileLowering, FunctionLowering, call, commonjs, condition, convert, expression, function,
    module, private_names,
};
use crate::diagnostic_codes::Code;
use crate::ir::{BlockId, PropertyKeyId, ValueId};

pub(in crate::lower) use self::key::{
    created_symbol_key, find_function_name, find_key_text, find_name_under_symbol,
    lower_computed_key, lower_member_key,
};
pub(in crate::lower) use self::reference::{
    KeyConversion, Reference, get_reference, lower_reference, put_reference,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum PropertyName {
    Constant(PropertyKeyId),
    Computed(ValueId),
}

impl PropertyName {
    pub(crate) fn key_operands(self) -> (Option<ValueId>, Option<PropertyKeyId>) {
        match self {
            PropertyName::Constant(key) => (None, Some(key)),
            PropertyName::Computed(value) => (Some(value), None),
        }
    }
}

#[derive(Copy, Clone)]
enum Access {
    Property(PropertyKeyId),
    Element(ValueId),
}

fn resolve_access(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: PropertyName,
) -> Access {
    match name {
        PropertyName::Constant(key) => match key::find_element_index(lowering.file, key) {
            Some(index) => Access::Element(lowering.builder.integer(i64::from(index))),
            None => Access::Property(key),
        },
        PropertyName::Computed(value) => Access::Element(value),
    }
}

pub(crate) fn name_key(file: &mut FileLowering<'_, '_, '_, '_>, name: Atom) -> PropertyKeyId {
    key::name_key(file, name)
}

pub(crate) fn lower_property_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    key: PropKey,
) -> PropertyName {
    key::lower_property_name(lowering, key)
}

pub(crate) fn emit_name_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: PropertyName,
) -> ValueId {
    key::emit_name_value(lowering, name)
}

pub(crate) fn emit_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PropertyName,
) -> ValueId {
    match resolve_access(lowering, name) {
        Access::Property(key) => lowering.builder.prop_get(object, key, false, false),
        Access::Element(property) => lowering.builder.elem_get(object, property),
    }
}

pub(crate) fn emit_set(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PropertyName,
    value: ValueId,
) {
    let mode = lowering.mode();
    match resolve_access(lowering, name) {
        Access::Property(key) => {
            lowering.file.fragment.note_write(key);
            lowering.builder.prop_set(object, key, mode, value, false)
        }
        Access::Element(property) => lowering.builder.elem_set(object, property, mode, value),
    };
}

pub(crate) fn emit_define(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PropertyName,
    value: ValueId,
) {
    match resolve_access(lowering, name) {
        Access::Property(key) => {
            lowering.file.fragment.note_write(key);
            lowering.builder.prop_define(object, key, value)
        }
        Access::Element(property) => lowering.builder.elem_define(object, property, value),
    };
}

pub(in crate::lower) fn emit_has(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PropertyName,
) -> ValueId {
    match resolve_access(lowering, name) {
        Access::Property(key) => lowering.builder.prop_has(object, key),
        Access::Element(property) => lowering.builder.elem_has(object, property),
    }
}

pub(in crate::lower) fn emit_delete(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PropertyName,
) -> ValueId {
    let mode = lowering.mode();
    match resolve_access(lowering, name) {
        Access::Property(key) => lowering.builder.prop_delete(object, key, mode, false),
        Access::Element(property) => lowering.builder.elem_delete(object, property, mode),
    }
}

pub(in crate::lower) fn lower_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    exit: Option<BlockId>,
) -> ValueId {
    let hir = lowering.file.hir;
    let Some((object, member)) = hir.member_key(access) else {
        unreachable!("lower_member takes a Dot or an Index expression");
    };
    if matches!(member, MemberKey::PrivateName(_)) {
        let base = lower_member_base(lowering, access, object, exit);
        lowering.set_position(hir[access].pos);
        return private_names::emit_private_get(lowering, base, access);
    }
    if matches!(hir[object].kind, ExprKind::Super) {
        function::get_this(lowering);
        let reference = lower_reference(lowering, access, KeyConversion::AtAccess);
        lowering.set_position(hir[access].pos);
        return get_reference(lowering, &reference);
    }
    if let Some(value) = lower_static_member(lowering, access) {
        return value;
    }
    let (base, name) = lower_member_operands(lowering, access, exit);
    emit_member_read(lowering, access, base, name)
}

pub(in crate::lower) fn lower_member_base(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    object: ExprId,
    exit: Option<BlockId>,
) -> ValueId {
    let base = expression::lower_chain_base(lowering, object, exit);
    match chain_of(lowering.file, access) {
        Chain::Start => {
            let exit = exit.expect("an optional link has the exit of its chain");
            condition::branch_if_expression_nullish(lowering, object, base, exit)
        }
        Chain::No | Chain::Continue => base,
    }
}

pub(in crate::lower) fn lower_member_operands(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    exit: Option<BlockId>,
) -> (ValueId, PropertyName) {
    let Some((object, member)) = lowering.file.hir.member_key(access) else {
        unreachable!("lower_member_operands takes a Dot or an Index expression");
    };
    let base = lower_member_base(lowering, access, object, exit);
    let name = lower_member_key(lowering, member);
    (base, name)
}

pub(in crate::lower) fn emit_member_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    object: ValueId,
    name: PropertyName,
) -> ValueId {
    let hir = lowering.file.hir;
    let Some((object_expression, _)) = hir.member_key(access) else {
        unreachable!("emit_member_read takes a Dot or an Index expression");
    };
    let object_position = call::last_mapped_position(lowering.file, object_expression);
    lowering.set_position(object_position);
    let value = emit_get(lowering, object, name);
    lowering.set_position(hir[access].pos);
    let value = convert::claim_member_read(lowering, access, value);
    warn_function_introspection(lowering, access);
    value
}

fn chain_of(file: &FileLowering<'_, '_, '_, '_>, access: ExprId) -> Chain {
    let kind = file.hir[access].kind;
    let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = kind else {
        unreachable!("chain_of takes a Dot or an Index expression");
    };
    chain
}

fn lower_static_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    if let Some(value) = module::lower_namespace_member(lowering, access) {
        return Some(value);
    }
    if let Some(value) = commonjs::lower_export_member(lowering, access) {
        return Some(value);
    }
    if !lowering.file.hir.has_typescript_semantics() {
        return None;
    }
    let value = match lowering.file.queries.constant_enum_access(access) {
        Ok(Some(EnumValue::Number(bits))) => {
            expression::emit_number(lowering, f64::from_bits(bits))
        }
        Ok(Some(EnumValue::String(text))) => {
            expression::emit_constant(lowering, Constant::String(text))
        }
        Ok(None) | Err(_) => return None,
    };
    lowering.enum_constants.insert(value);
    Some(value)
}

fn warn_function_introspection(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) {
    let Some((object, MemberKey::Name(name))) = lowering.file.hir.member_key(access) else {
        return;
    };
    if name != known::arguments && name != known::caller {
        return;
    }
    let Ok(ty) = lowering.file.queries.expression_type(object) else {
        return;
    };
    let Ok(shape) = lowering.file.queries.type_shape(ty) else {
        return;
    };
    if !is_function_shape(shape.kind) {
        return;
    }
    let span = lowering.file.span_of(NodeData::Expr(access));
    let text = lowering.file.queries.atom_bytes(name);
    lowering
        .file
        .diagnostics
        .report(Code::FunctionIntrospection, span, &[text]);
}

fn is_function_shape(kind: ShapeKind<'_>) -> bool {
    match kind {
        ShapeKind::Function(_) => true,
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable { .. }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::Number
        | ShapeKind::NumberLiteral(_)
        | ShapeKind::NumericEnumMember(_)
        | ShapeKind::BigInt
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::String
        | ShapeKind::StringLiteral(_)
        | ShapeKind::TemplateLiteral { .. }
        | ShapeKind::Symbol
        | ShapeKind::AnyObject
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Class(_)
        | ShapeKind::Object
        | ShapeKind::Union(_)
        | ShapeKind::Constrained { .. } => false,
    }
}
