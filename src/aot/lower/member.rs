mod key;
mod reference;

use bun_sema::atom::known;
use bun_sema::bind::Parent;
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{
    Chain, ExprId, ExprKind, Flags, Member, MemberKey, NameKind, NodeData, Prop, PropKey,
};

use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
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

/// The name that a function or a class takes from the place where it stands.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct GivenName {
    pub(crate) name: PropertyName,
    pub(crate) is_under_computed_key: bool,
}

impl GivenName {
    pub(crate) fn under_property(property: &Prop, name: PropertyName) -> GivenName {
        let is_literal_in_brackets = matches!(
            property.name_kind,
            NameKind::ComputedString | NameKind::ComputedNumber
        );
        GivenName {
            name,
            is_under_computed_key: is_literal_in_brackets
                || matches!(property.key, PropKey::Computed(_)),
        }
    }

    pub(crate) fn under_member(member: &Member, name: PropertyName) -> GivenName {
        GivenName {
            name,
            is_under_computed_key: member.flags.contains(Flags::COMPUTED_NAME),
        }
    }
}

impl From<PropertyName> for GivenName {
    fn from(name: PropertyName) -> GivenName {
        GivenName {
            name,
            is_under_computed_key: false,
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn is_tag(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        match self.bound.parent_of_expr(expression) {
            Parent::Expr(parent) => {
                matches!(hir[parent].kind, ExprKind::TaggedTemplate(site) if hir[site].callee == expression)
            }
            _ => false,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // Where the member is known ahead of time: JSC reads it from the object, and records the read, but for the tag of a template.
    pub(in crate::lower) fn record_read_from_object(&mut self, access: ExprId) {
        if let (Some((object, _)), false) =
            (self.file.hir.member_key(access), self.file.is_tag(access))
        {
            let position = self.file.member_position(object);
            self.builder.record_position(position);
        }
    }

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
        self.emit_define_inside(object, name, value, None);
    }

    // The conversion of the key runs inside the built-in function that the definition stands for.
    pub(crate) fn emit_define_inside(
        &mut self,
        object: ValueId,
        name: PropertyName,
        value: ValueId,
        function: Option<BuiltinId>,
    ) {
        match self.resolve_access(name) {
            PropertyName::Constant(key) => {
                self.file.fragment.note_write(key);
                self.builder.prop_define(object, key, value)
            }
            PropertyName::Computed(property) => {
                self.builder.elem_define(object, property, value, function)
            }
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
        if let Some(constant) = self.file.find_data_member_read(access) {
            return Some(self.emit_constant(constant));
        }
        if !self.file.hir.has_typescript_semantics() {
            return None;
        }
        let value = match self.file.find_enum_member_read(access)? {
            Constant::Number(number) => self.emit_number(number),
            constant => self.emit_constant(constant),
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
    let object_position = lowering.file.member_position(object_expression);
    // JSC records no position for the read of the tag of a template.
    let is_tag = lowering.file.is_tag(access);
    if is_tag {
        lowering.set_position_to_last_recorded();
    }
    // In `o[k]++` JSC tests `o` behind `k` and records no position for the test. The read that follows has one.
    if !lowering.builder.is_at_last_recorded_position() {
        lowering.set_position(object_position);
        // A constant that Bun's transpiler prints as its value is reported where the value is written. The read stands where the name is.
        if object_position < hir[access].pos {
            lowering.builder.set_written_position(hir[access].pos);
        }
    }
    let value = lowering.emit_get(object, name);
    if !is_tag {
        lowering.builder.record_position(object_position);
    }
    lowering.set_position(hir[access].pos);
    let value = lowering.claim_member_read(access, value);
    lowering.warn_function_introspection(access);
    value
}
