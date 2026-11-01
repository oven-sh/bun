mod key;
mod reference;

use bun_sema::atom::known;
use bun_sema::bind::{Binding, CommonJsVariable, Parent};
use bun_sema::check::aot::ShapeKind;
use bun_sema::fold::Constant;
use bun_sema::hir::{
    Chain, ExprId, ExprKind, Flags, Member, MemberKey, NameKind, NodeData, Prop, PropKey,
};

use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::ir::generated::BlockFrequency;
use crate::ir::{BlockId, PropertyKeyId, TypeTable, ValueId, VariableKey};
use bun_sema::program::Sym;

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
        if let Some(value) = self.lower_member_of_answer(access) {
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

    // `a.default` and `a.n`, where `a` stands for the copy that a helper makes of what `require` answered and a variable of its own holds the answer: `default` is the answer, and the getter of a name reads the name there. Where that variable is empty the access is what it is written as.
    fn lower_member_of_answer(&mut self, access: ExprId) -> Option<ValueId> {
        let modules = self.file.inputs.modules;
        modules.answer_member(self.file.file, access)?;
        Some(self.lower_member_of_answer_below(access, None).0)
    }

    /// `base`: what `a` holds, where it is already read. The member, and once more what was read on the answer alone: nothing where the access ran as it is written.
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
        self.builder
            .set_frequency(split.taken, BlockFrequency::Unlikely);
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
    match name {
        PropertyName::Computed(key) if spells_require_for_holder(lowering, access) => {
            emit_read_that_may_find_require(lowering, access, object, key)
        }
        _ => emit_member_read_as_written(lowering, access, object, name),
    }
}

/// `module[("require" + Math.random()).slice(0, 7)]`, as React writes it "to get around the bundlers". What holds the loader is found by its name alone: a file that reads a
/// module object or `import.meta` under a key that nobody follows has spelled the name where a text of the file is the name.
fn spells_require_for_holder(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> bool {
    let (hir, bound) = (lowering.file.hir, lowering.file.bound);
    let Some((object, _)) = hir.member_key(access) else {
        return false;
    };
    let object = hir.skip_type_assertions(object);
    let own_module = Binding::CommonJs(CommonJsVariable::Module);
    let builtins = lowering.file.builtins;
    let holds_require = match hir[object].kind {
        ExprKind::ImportMeta => true,
        ExprKind::Ident(_) if bound.binding(object) == own_module => true,
        _ => builtins.module_object_mention(object).is_some(),
    };
    let is_name = |text| text == known::require;
    holds_require
        && (hir.exprs.iter()).any(|it| matches!(it.kind, ExprKind::String(text) if is_name(text)))
}

/// `key === "require" ? module.require : module[key]`: the same value, and the name stands in the code.
fn emit_read_that_may_find_require(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    holder: ValueId,
    key: ValueId,
) -> ValueId {
    let text = lowering.file.intern_bytes(b"require");
    let spelled = lowering.builder.string(text);
    let is_require = lowering.builder.strict_eq(key, spelled);
    let split = lowering.split_on_truthiness(is_require);
    let join = lowering.create_block();
    let result = lowering.builder.add_parameter(join, None);
    lowering.builder.switch_to(split.taken);
    let name = PropertyName::Constant(lowering.file.text_key(text));
    let require = emit_member_read_as_written(lowering, access, holder, name);
    lowering.jump_with(join, &[require]);
    lowering.builder.switch_to(split.not_taken);
    let other = emit_member_read_as_written(lowering, access, holder, PropertyName::Computed(key));
    lowering.jump_with(join, &[other]);
    lowering.continue_in(join);
    result
}

fn emit_member_read_as_written(
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
