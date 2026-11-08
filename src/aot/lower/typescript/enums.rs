use bun_sema::atom::known;
use bun_sema::bind::Decl;
use bun_sema::erasure::ReplacedText;
use bun_sema::fold::Constant;
use bun_sema::hir::{
    self, EnumId, EnumMemberId, ExprId, Flags, end_of_expr, is_parenthesized, start_of,
};
use smallvec::SmallVec;

use super::enum_values::EnumMemberValue;
use crate::ir::{FunctionKey, TypeTable, ValueId};
use crate::lower::function::{print_number, print_string};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, object};

#[cfg(test)]
mod tests;

fn has_only_constant_members(members: &[(EnumMemberId, EnumMemberValue)]) -> bool {
    members.iter().all(|&(_, value)| {
        matches!(
            value,
            EnumMemberValue::Number(_) | EnumMemberValue::String(_) | EnumMemberValue::Missing
        )
    })
}

fn has_only_index_reverse_keys(members: &[(EnumMemberId, EnumMemberValue)]) -> bool {
    members.iter().all(|&(_, value)| match value {
        EnumMemberValue::Number(number) => {
            number.trunc() == number && (0.0..f64::from(u32::MAX)).contains(&number)
        }
        EnumMemberValue::String(_) => true,
        _ => false,
    })
}

fn end_in_front_of_types(hir: &hir::File<'_>, mut expression: ExprId) -> u32 {
    while !is_parenthesized(hir, expression)
        && let Some(operand) = hir.type_assertion_operand(expression)
    {
        expression = operand;
    }
    end_of_expr(hir, expression)
}

impl FileLowering<'_, '_, '_, '_> {
    fn note_enum_as_code(
        &mut self,
        declaration: EnumId,
        members: &[(EnumMemberId, EnumMemberValue)],
    ) -> Option<()> {
        let (hir, bound) = (self.hir, self.bound);
        let data = hir[declaration];
        if !self.inputs.options.embeds_function_text || members.len() != data.members.len() {
            return None;
        }
        let atoms = &self.queries.files().atoms;
        let name = atoms.bytes(data.name);
        let (start, end) = (hir[data.stmt].start, hir[data.stmt].loc.end);
        let symbol = bound.symbol(bound.declared_symbol(Decl::Enum(declaration)));
        let head = match symbol.decls.first() == Some(&Decl::Enum(declaration)) {
            true => [&b"let "[..], name, b"; ((", name, b") => ["].concat(),
            false => [&b";(("[..], name, b") => ["].concat(),
        };
        let end_of_head = members.first().map_or(end - 1, |first| hir[first.0].pos);
        let mut parts = vec![
            (start, end_of_head, head),
            (end - 1, end, [&b"])("[..], name, b" ||= {});"].concat()),
        ];
        let mut previous = Vec::new();
        for &(id, value) in members {
            let member = hir[id];
            let key = print_string(atoms.bytes(member.name))?;
            let slot = [name, b"[", &key, b"]"].concat();
            let stored_both_ways =
                |value: &[u8]| [name, b"[", &slot, b" = ", value, b"] = ", &key].concat();
            let whole = match value {
                EnumMemberValue::Number(number) => stored_both_ways(&print_number(number, false)),
                EnumMemberValue::String(text) => {
                    [&slot[..], b" = ", &print_string(atoms.bytes(text))?].concat()
                }
                EnumMemberValue::Missing => stored_both_ways(b"void 0"),
                EnumMemberValue::PreviousPlusOne => {
                    stored_both_ways(&[&previous[..], b" + 1"].concat())
                }
                EnumMemberValue::Computed(initializer)
                | EnumMemberValue::ComputedNumber(initializer) => {
                    let in_front = [name, b"[", &slot, b" = "].concat();
                    parts.push((member.pos, start_of(hir, initializer), in_front));
                    let behind = end_in_front_of_types(hir, initializer);
                    parts.push((behind, behind, [&b"] = "[..], &key].concat()));
                    previous = slot;
                    continue;
                }
                EnumMemberValue::ComputedUnknown(initializer) => {
                    // `typeof (E["A"] = init) !== "string" && (E[E["A"]] = "A")`
                    let in_front = [&b"typeof ("[..], &slot, b" = "].concat();
                    parts.push((member.pos, start_of(hir, initializer), in_front));
                    let behind = end_in_front_of_types(hir, initializer);
                    let text = [
                        &b") !== \"string\" && ("[..],
                        name,
                        b"[",
                        &slot,
                        b"] = ",
                        &key,
                        b")",
                    ]
                    .concat();
                    parts.push((behind, behind, text));
                    previous = slot;
                    continue;
                }
                EnumMemberValue::ComputedString(initializer) => {
                    let in_front = [&slot[..], b" = "].concat();
                    parts.push((member.pos, start_of(hir, initializer), in_front));
                    previous = slot;
                    continue;
                }
            };
            parts.push((member.pos, member.loc.end, whole));
            previous = slot;
        }
        let parts = parts.into_iter().map(|(start, end, text)| ReplacedText {
            start,
            end,
            text: text.into_boxed_slice(),
        });
        self.enums_written_as_code.extend(parts);
        Some(())
    }
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
        let is_in_function = !matches!(
            self.key,
            FunctionKey::ModuleBody(_) | FunctionKey::WrappedModuleBody(_)
        );
        if is_in_function {
            self.file.note_enum_as_code(declaration, &members);
        }
        let can_define_members = has_only_constant_members(&members)
            && !(members.iter())
                .any(|&(id, _)| self.file.is_name_on_object_prototype(hir[id].name));
        if self.has_single_declaration(container) && can_define_members {
            let layout = self.file.container_layout(container.merged);
            let mut builder = self.begin_object(layout);
            let mut reverse_keys: SmallVec<[(PropertyName, ValueId); 16]> = SmallVec::new();
            let defines_names_first = has_only_index_reverse_keys(&members)
                && !members.iter().any(|&(id, _)| {
                    let name = self.file.name_key(hir[id].name);
                    self.file.find_element_index(name).is_some()
                });
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
        self.enter_container_scope(scope, container_object);
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
                | EnumMemberValue::ComputedUnknown(initializer)
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
                EnumMemberValue::ComputedUnknown(_) => {
                    // A string member has no reverse mapping. The type is only
                    // known at run time, so store the reverse key behind a check.
                    let is_string = self.builder.type_test(lowered, TypeTable::STRING);
                    let done = self.create_block();
                    self.go_on_if(is_string, false, done);
                    let reverse_name =
                        PropertyName::Computed(self.builder.to_property_key(lowered));
                    let text = self.emit_constant(Constant::String(data.name));
                    put_property(self, reverse_name, text);
                    self.jump(done);
                    self.continue_in(done);
                    continue;
                }
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
