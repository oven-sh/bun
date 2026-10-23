use bun_sema::atom::{Atom, known};
use bun_sema::bind::Decl;
use bun_sema::fold::Constant;
use bun_sema::hir::{self, EnumId, EnumMemberId, Flags};
use smallvec::SmallVec;

use super::containers;
use super::enum_values::{self, EnumMemberValue};
use crate::ir::ValueId;
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, expression, layouts, object, scope};

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

pub(super) fn lower_enum(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, declaration: EnumId) {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    let data = hir[declaration];
    if data.flags.contains(Flags::AMBIENT) {
        return;
    }
    let container = containers::find_container(lowering, Decl::Enum(declaration), data.name);
    let members = enum_values::compute_enum_member_values(lowering.file, declaration);
    let is_only_declaration = containers::has_single_declaration(lowering, container);
    if is_only_declaration && can_define_members(hir, &members) {
        let layout = layouts::container_layout(lowering.file, container.merged);
        let mut builder = object::begin_object(lowering, layout);
        let mut reverse_keys: SmallVec<[(PropertyName, ValueId); 16]> = SmallVec::new();
        let defines_names_first = has_only_index_reverse_keys(&members);
        lower_enum_members(
            lowering,
            &members,
            &mut |lowering, name, value| match name {
                PropertyName::Computed(_) if defines_names_first => {
                    reverse_keys.push((name, value))
                }
                PropertyName::Computed(_) | PropertyName::Constant(_) => {
                    object::add_property(lowering, &mut builder, name, value);
                }
            },
        );
        for (name, value) in reverse_keys {
            object::add_property(lowering, &mut builder, name, value);
        }
        lowering.set_position(data.name_pos);
        let created = object::finish_object(lowering, builder);
        containers::initialize_container(lowering, container, created);
        return;
    }
    let container_object = containers::ensure_container(lowering, container);
    let scope = bound.enum_scope[declaration.idx()];
    scope::enter_scope(lowering, scope);
    lower_enum_members(lowering, &members, &mut |lowering, name, value| {
        member::emit_set(lowering, container_object, name, value);
    });
    scope::leave_scope(lowering, scope);
}

fn lower_enum_members(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    members: &[(EnumMemberId, EnumMemberValue)],
    put_property: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, PropertyName, ValueId),
) {
    let hir = lowering.file.hir;
    let mut previous = None;
    for &(id, value) in members {
        let data = hir[id];
        lowering.set_position(data.pos);
        let name = PropertyName::Constant(member::name_key(lowering.file, data.name));
        let lowered = lower_enum_member_value(lowering, value, previous);
        previous = Some(lowered);
        lowering.set_position(data.pos);
        put_property(lowering, name, lowered);
        if let Some(reverse_name) = emit_reverse_key(lowering, value, lowered) {
            let text = expression::emit_constant(lowering, Constant::String(data.name));
            put_property(lowering, reverse_name, text);
        }
    }
}

fn lower_enum_member_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: EnumMemberValue,
    previous: Option<ValueId>,
) -> ValueId {
    match value {
        EnumMemberValue::Number(number) => {
            expression::emit_constant(lowering, Constant::Number(number))
        }
        EnumMemberValue::String(text) => {
            expression::emit_constant(lowering, Constant::String(text))
        }
        EnumMemberValue::Computed(initializer)
        | EnumMemberValue::ComputedNumber(initializer)
        | EnumMemberValue::ComputedString(initializer) => {
            expression::lower_expression(lowering, initializer)
        }
        EnumMemberValue::PreviousPlusOne => {
            let previous = previous.expect("a member with an initializer comes first");
            lowering.builder.increment(previous)
        }
        EnumMemberValue::Missing => expression::emit_constant(lowering, Constant::Undefined),
    }
}

fn emit_reverse_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: EnumMemberValue,
    lowered: ValueId,
) -> Option<PropertyName> {
    match value {
        EnumMemberValue::String(_) | EnumMemberValue::ComputedString(_) => None,
        EnumMemberValue::Computed(_) => Some(PropertyName::Computed(
            lowering.builder.to_property_key(lowered),
        )),
        EnumMemberValue::Missing => {
            let key = member::name_key(lowering.file, known::undefined);
            Some(PropertyName::Constant(key))
        }
        _ => Some(PropertyName::Computed(lowered)),
    }
}
