mod key;
mod reference;

use bun_sema::atom::{Atom, known};
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{
    Chain, ExprId, ExprKind, Flags, Member, MemberKey, NameKind, NodeData, Prop, PropKey,
};
use bun_sema::program::Sym;

use super::{FunctionLowering, parameters};
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::ir::{BlockId, FunctionKey, PropertyKeyId, TypeTable, ValueId, VariableKey};

pub(in crate::lower) use self::key::find_function_name;
pub(in crate::lower) use self::reference::{Holder, KeyConversion, Reference};

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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct GivenName {
    pub(crate) name: PropertyName,
    pub(crate) is_under_computed_key: bool,
    pub(crate) written_name: Option<Atom>,
}

impl GivenName {
    pub(crate) fn under_property(property: &Prop, name: PropertyName) -> GivenName {
        let is_literal_in_brackets = matches!(
            property.name_kind,
            NameKind::ComputedString | NameKind::ComputedNumber
        );
        GivenName {
            is_under_computed_key: is_literal_in_brackets
                || matches!(property.key, PropKey::Computed(_)),
            ..GivenName::from(name)
        }
    }

    pub(crate) fn under_member(member: &Member, name: PropertyName) -> GivenName {
        GivenName {
            is_under_computed_key: member.flags.contains(Flags::COMPUTED_NAME),
            ..GivenName::from(name)
        }
    }

    pub(crate) fn of_binding(written: Atom, shown: PropertyName) -> GivenName {
        GivenName {
            written_name: Some(written),
            ..GivenName::from(shown)
        }
    }
}

impl From<PropertyName> for GivenName {
    fn from(name: PropertyName) -> GivenName {
        GivenName {
            name,
            is_under_computed_key: false,
            written_name: None,
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
        self.emit_define_inside(object, name, value, None);
    }

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
        if let Some(value) = self.lower_member_of_answer(access) {
            return Some(value);
        }
        if let Some(constant) = self.file.find_data_member_read(access) {
            return Some(self.emit_constant(constant));
        }
        let constant = self.file.find_enum_member_read(access)?;
        if let Some(member) = self.file.find_member_of_loaded_module(access) {
            self.check_member_root(member);
        }
        let value = match constant {
            Constant::Number(number) => self.emit_number(number),
            constant => self.emit_constant(constant),
        };
        Some(value)
    }

    fn lower_member_of_answer(&mut self, access: ExprId) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        modules.answer_member(self.file.file, access)?;
        Some(self.lower_member_of_answer_below(access, None).0)
    }

    pub(in crate::lower) fn lower_member_of_answer_below(
        &mut self,
        access: ExprId,
        base: Option<ValueId>,
    ) -> (ValueId, ValueId) {
        let file = &*self.file;
        let member = file.inputs.modules.answer_member(file.file, access);
        let member = member.expect("the access is bound to what `require` answered");
        let holder = Sym {
            file: file.file,
            id: member.holder,
        };
        let Some((_, key)) = file.hir.member_key(access) else {
            unreachable!("a member of an answer is a Dot or an Index expression");
        };
        self.set_position(file.hir[access].pos);
        let variable = self
            .file
            .ensure_variable(VariableKey::RequiredAnswer(holder));
        let answer = self.builder.get_module_variable(variable);
        let result = self.builder.create_variable(None);
        let result_on_answer = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(answer, TypeTable::ABSENT);
        self.builder.switch_to(split.taken);
        let (base, property) = match base {
            Some(base) => (base, self.lower_member_key(key)),
            None => lower_member_operands(self, access, None),
        };
        let written = emit_member_read(self, access, base, property);
        self.builder.write_variable(result, written);
        let nothing = self.builder.absent();
        self.builder.write_variable(result_on_answer, nothing);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        let read = match member.name {
            Some(_) => {
                let property = self.lower_member_key(key);
                emit_member_read(self, access, split.not_taken_value, property)
            }
            None => split.not_taken_value,
        };
        self.builder.write_variable(result, read);
        self.builder.write_variable(result_on_answer, read);
        self.jump(join);
        self.continue_in(join);
        let result = self.builder.read_variable(result);
        (result, self.builder.read_variable(result_on_answer))
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
    let counted =
        parameters::find_function_whose_arguments_are_counted(hir, lowering.file.bound, access);
    if let Some(function) = counted
        && matches!(lowering.key, FunctionKey::Source(source) if source.function == function)
        && let Some(count) = lowering.builder.argument_count()
    {
        return count;
    }
    if matches!(member, MemberKey::PrivateName(_)) {
        let base = lowering.lower_member_base(access, object, exit);
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

fn warn_of_function_introspection(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) {
    let Some((object, MemberKey::Name(name))) = lowering.file.hir.member_key(access) else {
        return;
    };
    if name != known::arguments && name != known::caller {
        return;
    }
    let text = lowering.file.queries.atom_bytes(name);
    let Ok(ty) = lowering.file.queries.expression_type(object) else {
        return;
    };
    let Ok(shape) = lowering.file.queries.type_shape(ty) else {
        return;
    };
    if matches!(shape.kind, ShapeKind::Function(_)) {
        let span = lowering.file.span_of(NodeData::Expr(access));
        lowering
            .file
            .diagnostics
            .report(Code::FunctionIntrospection, span, &[text]);
    }
}

pub(in crate::lower) fn emit_member_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    object: ValueId,
    name: PropertyName,
) -> ValueId {
    lowering.report_at_member(access);
    let value = lowering.emit_get(object, name);
    lowering.set_position(lowering.file.hir[access].pos);
    warn_of_function_introspection(lowering, access);
    value
}

#[cfg(test)]
mod tests {
    use bun_core::strings::index_of;

    use crate::compile::testing::{default_settings, lower_program_with_settings};
    use crate::ir::Opcode;

    fn positions_of_member_reads(source: &str) -> Vec<u32> {
        let lowered = lower_program_with_settings(&[("main.ts", source)], &default_settings());
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let functions = fragments.flat_map(|fragment| &fragment.functions);
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        let reads =
            values.filter(|value| matches!(value.opcode, Opcode::PropGet | Opcode::ElemGet));
        reads.filter_map(|value| value.position).collect()
    }

    #[track_caller]
    fn offset_of(source: &str, text: &str) -> u32 {
        let offset = index_of(source.as_bytes(), text.as_bytes());
        offset.expect("the source has the text") as u32
    }

    #[test]
    fn each_read_of_a_chain_over_several_lines_reports_on_the_line_of_its_object() {
        let source = "export function probe(holder: any, key: any) {
  return holder
    .items
    [key]
    .run();
}
";
        let expected = ["holder\n", "items", "key]"].map(|text| offset_of(source, text));
        assert_eq!(positions_of_member_reads(source), expected);
    }

    fn count_tests_of_updated_objects(source: &str) -> usize {
        let lowered = lower_program_with_settings(&[("main.js", source)], &default_settings());
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let functions = fragments.flat_map(|fragment| &fragment.functions);
        let blocks = functions.flat_map(|(_, function)| function.body.blocks());
        let values = blocks.flat_map(|block| block.values());
        values
            .filter(|value| matches!(value.opcode, Opcode::RequireObjectCoercible))
            .count()
    }

    #[test]
    fn update_under_a_key_that_only_minified_syntax_folds_tests_its_object() {
        let source = r#"export function written(holder) {
  holder[`name`]++;
  holder[`na${"me"}`]++;
  holder[`n${1}`] += 1;
  holder[`n${null}`] ||= 1;
  holder[`n${`a${"b"}`}`]++;
  holder[`a${"b"}` + "c"]++;
  holder["na" + "me"]++;
  holder["a" + "b" + "c"]++;
  holder[1 + 2]++;
  holder[-(1 + 2)]++;
  holder[(0, "a")]++;
  holder["ab".length]++;
  holder[["e", "f"][1]] ??= 1;
}
export function constant(holder) {
  const text = "name";
  const template = `na${"me"}`;
  const sum = 1 + 2;
  holder[text]++;
  holder[template] ??= 1;
  holder[sum] += 2;
  holder[text + ""]--;
}
"#;
        assert_eq!(count_tests_of_updated_objects(source), 15);
    }

    #[test]
    fn update_under_a_key_that_no_build_folds_tests_its_object() {
        let source = r#"export function written(holder, free) {
  holder[`${free}`]++;
  holder[`n${free}`] += 1;
  holder[free + "a"] ??= 1;
  holder[true]++;
  holder[0 / 0]--;
}
export function behindAStatement(holder, free) {
  free();
  const text = "name";
  holder[text] ??= 1;
  holder[`n${text}`]++;
}
export function inTwoPieces(holder) {
  const text = "na" + "me";
  holder[text]++;
}
"#;
        assert_eq!(count_tests_of_updated_objects(source), 7);
    }
}
