mod key;
mod reference;

use bun_sema::atom::known;
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{Chain, ExprId, ExprKind, MemberKey, NodeData};
use bun_sema::types::EnumValue;

use super::FunctionLowering;
use crate::diagnostic_codes::Code;
use crate::ir::{BlockId, PropertyKeyId, ValueId};

pub(in crate::lower) use self::key::find_function_name;
pub(in crate::lower) use self::reference::{KeyConversion, Reference};

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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn resolve_access(&mut self, name: PropertyName) -> PropertyName {
        match name {
            PropertyName::Constant(key) => self.normalize_access_key(key),
            PropertyName::Computed(_) => name,
        }
    }

    pub(crate) fn emit_get(&mut self, object: ValueId, name: PropertyName) -> ValueId {
        match self.resolve_access(name) {
            PropertyName::Constant(key) => self.builder.prop_get(object, key, false, false),
            PropertyName::Computed(property) => self.builder.elem_get(object, property),
        }
    }

    pub(crate) fn emit_set(&mut self, object: ValueId, name: PropertyName, value: ValueId) {
        let mode = self.mode();
        match self.resolve_access(name) {
            PropertyName::Constant(key) => {
                self.file.fragment.note_write(key);
                self.builder.prop_set(object, key, mode, value, false)
            }
            PropertyName::Computed(property) => {
                self.builder.elem_set(object, property, mode, value)
            }
        };
    }

    pub(crate) fn emit_define(&mut self, object: ValueId, name: PropertyName, value: ValueId) {
        match self.resolve_access(name) {
            PropertyName::Constant(key) => {
                self.file.fragment.note_write(key);
                self.builder.prop_define(object, key, value)
            }
            PropertyName::Computed(property) => self.builder.elem_define(object, property, value),
        };
    }

    pub(in crate::lower) fn emit_has(&mut self, object: ValueId, name: PropertyName) -> ValueId {
        match self.resolve_access(name) {
            PropertyName::Constant(key) => self.builder.prop_has(object, key),
            PropertyName::Computed(property) => self.builder.elem_has(object, property),
        }
    }

    pub(in crate::lower) fn emit_delete(&mut self, object: ValueId, name: PropertyName) -> ValueId {
        let mode = self.mode();
        match self.resolve_access(name) {
            PropertyName::Constant(key) => self.builder.prop_delete(object, key, mode, false),
            PropertyName::Computed(property) => self.builder.elem_delete(object, property, mode),
        }
    }

    pub(in crate::lower) fn lower_member_base(
        &mut self,
        access: ExprId,
        object: ExprId,
        exit: Option<BlockId>,
    ) -> ValueId {
        let base = self.lower_chain_base(object, exit);
        let kind = self.file.hir[access].kind;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = kind else {
            unreachable!("lower_member_base takes a Dot or an Index expression");
        };
        match chain {
            Chain::Start => {
                let exit = exit.expect("an optional link has the exit of its chain");
                self.branch_if_expression_nullish(object, base, exit)
            }
            Chain::No | Chain::Continue => base,
        }
    }

    fn lower_static_member(&mut self, access: ExprId) -> Option<ValueId> {
        if let Some(value) = self.lower_namespace_member(access) {
            return Some(value);
        }
        if let Some(value) = self.lower_export_member(access) {
            return Some(value);
        }
        if !self.file.hir.has_typescript_semantics() {
            return None;
        }
        let value = match self.file.queries.constant_enum_access(access) {
            Ok(Some(EnumValue::Number(bits))) => self.emit_number(f64::from_bits(bits)),
            Ok(Some(EnumValue::String(text))) => self.emit_constant(Constant::String(text)),
            Ok(None) | Err(_) => return None,
        };
        self.enum_constants.insert(value);
        Some(value)
    }

    fn warn_function_introspection(&mut self, access: ExprId) {
        let Some((object, MemberKey::Name(name))) = self.file.hir.member_key(access) else {
            return;
        };
        if name != known::arguments && name != known::caller {
            return;
        }
        let Ok(ty) = self.file.queries.expression_type(object) else {
            return;
        };
        let Ok(shape) = self.file.queries.type_shape(ty) else {
            return;
        };
        if !matches!(shape.kind, ShapeKind::Function(_)) {
            return;
        }
        let span = self.file.span_of(NodeData::Expr(access));
        let text = self.file.queries.atom_bytes(name);
        self.file
            .diagnostics
            .report(Code::FunctionIntrospection, span, &[text]);
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
        let base = lowering.lower_member_base(access, object, exit);
        lowering.set_position(hir[access].pos);
        return lowering.emit_private_get(base, access);
    }
    if matches!(hir[object].kind, ExprKind::Super) {
        lowering.get_this();
        let reference = lowering.lower_reference(access, KeyConversion::AtAccess);
        lowering.set_position(hir[access].pos);
        return lowering.get_reference(&reference);
    }
    if let Some(value) = lowering.lower_static_member(access) {
        return value;
    }
    let (base, name) = lower_member_operands(lowering, access, exit);
    emit_member_read(lowering, access, base, name)
}

pub(in crate::lower) fn lower_member_operands(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    exit: Option<BlockId>,
) -> (ValueId, PropertyName) {
    let Some((object, member)) = lowering.file.hir.member_key(access) else {
        unreachable!("lower_member_operands takes a Dot or an Index expression");
    };
    let base = lowering.lower_member_base(access, object, exit);
    let name = lowering.lower_member_key(member);
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
    let object_position = lowering.file.last_mapped_position(object_expression);
    lowering.set_position(object_position);
    let value = lowering.emit_get(object, name);
    lowering.set_position(hir[access].pos);
    let value = lowering.claim_member_read(access, value);
    lowering.warn_function_introspection(access);
    value
}
