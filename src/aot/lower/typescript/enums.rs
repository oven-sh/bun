use bun_sema::atom::known;
use bun_sema::bind::Decl;
use bun_sema::fold::Constant;
use bun_sema::hir::{self, EnumId, EnumMemberId, Flags};
use smallvec::SmallVec;

use super::enum_values::EnumMemberValue;
use crate::ir::ValueId;
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, object};

fn can_define_members(hir: &hir::File<'_>, members: &[(EnumMemberId, EnumMemberValue)]) -> bool {
    members.iter().all(|&(id, value)| match value {
        EnumMemberValue::Number(_) | EnumMemberValue::String(_) | EnumMemberValue::Missing => {
            // `Object.prototype` has a setter of this name.
            hir[id].name != known::__proto__
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_enum(&mut self, declaration: EnumId) {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let data = hir[declaration];
        if data.flags.contains(Flags::AMBIENT) {
            return;
        }
        let container = self.find_container(Decl::Enum(declaration), data.name);
        let members = self.file.compute_enum_member_values(declaration);
        if self.has_single_declaration(container) && can_define_members(hir, &members) {
            let layout = self.file.container_layout(container.merged);
            let mut builder = self.begin_object(layout);
            let mut reverse_keys: SmallVec<[(PropertyName, ValueId); 16]> = SmallVec::new();
            let defines_names_first = has_only_index_reverse_keys(&members);
            self.lower_enum_members(&members, &mut |lowering, name, value| match name {
                PropertyName::Computed(_) if defines_names_first => {
                    reverse_keys.push((name, value));
                }
                PropertyName::Computed(_) | PropertyName::Constant(_) => {
                    lowering.add_property(&mut builder, name, value, None);
                }
            });
            for (name, value) in reverse_keys {
                self.add_property(&mut builder, name, value, None);
            }
            self.set_position(data.name_pos);
            let created = object::finish_object(self, builder);
            self.initialize_container(container, created);
            return;
        }
        let container_object = self.ensure_container(container);
        let scope = bound.enum_scope[declaration.idx()];
        self.enter_scope(scope);
        self.lower_enum_members(&members, &mut |lowering, name, value| {
            lowering.emit_set(container_object, name, value);
        });
        self.leave_scope(scope);
    }

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
            let lowered = match value {
                EnumMemberValue::Number(number) => self.emit_constant(Constant::Number(number)),
                EnumMemberValue::String(text) => self.emit_constant(Constant::String(text)),
                EnumMemberValue::Computed(initializer)
                | EnumMemberValue::ComputedNumber(initializer)
                | EnumMemberValue::ComputedString(initializer) => {
                    self.lower_expression(initializer)
                }
                EnumMemberValue::PreviousPlusOne => {
                    let previous = previous.expect("a member with an initializer comes first");
                    self.builder.increment(previous)
                }
                EnumMemberValue::Missing => self.emit_constant(Constant::Undefined),
            };
            previous = Some(lowered);
            self.set_position(data.pos);
            put_property(self, name, lowered);
            let reverse_name = match value {
                EnumMemberValue::String(_) | EnumMemberValue::ComputedString(_) => continue,
                EnumMemberValue::Computed(_) => {
                    PropertyName::Computed(self.builder.to_property_key(lowered))
                }
                EnumMemberValue::Missing => {
                    PropertyName::Constant(self.file.name_key(known::undefined))
                }
                EnumMemberValue::Number(_)
                | EnumMemberValue::ComputedNumber(_)
                | EnumMemberValue::PreviousPlusOne => PropertyName::Computed(lowered),
            };
            let text = self.emit_constant(Constant::String(data.name));
            put_property(self, reverse_name, text);
        }
    }
}
