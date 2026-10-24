use bun_sema::atom::{Atom, known};
use bun_sema::bind::Decl;
use bun_sema::fold::Constant;
use bun_sema::hir::{self, EnumId, EnumMemberId, Flags};
use smallvec::SmallVec;

use super::containers;
use super::enum_values::EnumMemberValue;
use crate::ir::ValueId;
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, object};

fn has_inherited_setter(name: Atom) -> bool {
    name == known::__proto__
}

fn can_define_members(hir: &hir::File<'_>, members: &[(EnumMemberId, EnumMemberValue)]) -> bool {
    members.iter().all(|&(id, value)| match value {
        EnumMemberValue::Number(_) | EnumMemberValue::String(_) | EnumMemberValue::Missing => {
            !has_inherited_setter(hir[id].name)
        }
        _ => false,
    })
}

// An integer key precedes every name in the order of an object's keys, wherever it is defined.
fn has_only_index_reverse_keys(members: &[(EnumMemberId, EnumMemberValue)]) -> bool {
    members.iter().all(|&(_, value)| match value {
        EnumMemberValue::Number(number) => {
            number.trunc() == number && (0.0..f64::from(u32::MAX)).contains(&number)
        }
        EnumMemberValue::String(_) => true,
        _ => false,
    })
}

pub(crate) fn lower_enum(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, declaration: EnumId) {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    let data = hir[declaration];
    if data.flags.contains(Flags::AMBIENT) {
        return;
    }
    let container = containers::find_container(lowering, Decl::Enum(declaration), data.name);
    let members = lowering.file.compute_enum_member_values(declaration);
    let is_only_declaration = lowering.has_single_declaration(container);
    if is_only_declaration && can_define_members(hir, &members) {
        let layout = lowering.file.container_layout(container.merged);
        let mut builder = lowering.begin_object(layout);
        let mut reverse_keys: SmallVec<[(PropertyName, ValueId); 16]> = SmallVec::new();
        let defines_names_first = has_only_index_reverse_keys(&members);
        lowering.lower_enum_members(&members, &mut |lowering, name, value| match name {
            PropertyName::Computed(_) if defines_names_first => reverse_keys.push((name, value)),
            PropertyName::Computed(_) | PropertyName::Constant(_) => {
                lowering.add_property(&mut builder, name, value);
            }
        });
        for (name, value) in reverse_keys {
            lowering.add_property(&mut builder, name, value);
        }
        lowering.set_position(data.name_pos);
        let created = object::finish_object(lowering, builder);
        lowering.initialize_container(container, created);
        return;
    }
    let container_object = lowering.ensure_container(container);
    let scope = bound.enum_scope[declaration.idx()];
    lowering.enter_scope(scope);
    lowering.lower_enum_members(&members, &mut |lowering, name, value| {
        lowering.emit_set(container_object, name, value);
    });
    lowering.leave_scope(scope);
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn lower_enum_members(
        &mut self,
        members: &[(EnumMemberId, EnumMemberValue)],
        put_property: &mut dyn FnMut(
            &mut FunctionLowering<'_, '_, '_, '_, '_>,
            PropertyName,
            ValueId,
        ),
    ) {
        let hir = self.file.hir;
        let mut previous = None;
        for &(id, value) in members {
            let data = hir[id];
            self.set_position(data.pos);
            let name = PropertyName::Constant(self.file.name_key(data.name));
            let lowered = self.lower_enum_member_value(value, previous);
            previous = Some(lowered);
            self.set_position(data.pos);
            put_property(self, name, lowered);
            if let Some(reverse_name) = self.emit_reverse_key(value, lowered) {
                let text = self.emit_constant(Constant::String(data.name));
                put_property(self, reverse_name, text);
            }
        }
    }

    fn lower_enum_member_value(
        &mut self,
        value: EnumMemberValue,
        previous: Option<ValueId>,
    ) -> ValueId {
        match value {
            EnumMemberValue::Number(number) => self.emit_constant(Constant::Number(number)),
            EnumMemberValue::String(text) => self.emit_constant(Constant::String(text)),
            EnumMemberValue::Computed(initializer)
            | EnumMemberValue::ComputedNumber(initializer)
            | EnumMemberValue::ComputedString(initializer) => self.lower_expression(initializer),
            EnumMemberValue::PreviousPlusOne => {
                let previous = previous.expect("a member with an initializer comes first");
                self.builder.increment(previous)
            }
            EnumMemberValue::Missing => self.emit_constant(Constant::Undefined),
        }
    }

    fn emit_reverse_key(
        &mut self,
        value: EnumMemberValue,
        lowered: ValueId,
    ) -> Option<PropertyName> {
        match value {
            EnumMemberValue::String(_) | EnumMemberValue::ComputedString(_) => None,
            EnumMemberValue::Computed(_) => Some(PropertyName::Computed(
                self.builder.to_property_key(lowered),
            )),
            EnumMemberValue::Missing => {
                let key = self.file.name_key(known::undefined);
                Some(PropertyName::Constant(key))
            }
            _ => Some(PropertyName::Computed(lowered)),
        }
    }
}
