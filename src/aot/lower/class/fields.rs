use bun_sema::atom::Atom;
use bun_sema::bind::{CodeUnit, PrivateNameId};
use bun_sema::check::aot::{ClassMemberSource, ClassRef};
use bun_sema::hir::{ClassId, Flags, MemberId, ParamId, PatKind, PropKey};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::{ClassElement, FieldValue, is_auto_accessor, is_derived_class};
use crate::builtins::id::BuiltinId;
use crate::ir::generated::{
    Field, FieldFlags, FunctionFlags, FunctionKind, OperandKind, TypeSiteKind,
};
use crate::ir::{ClassSlot, DeclaredType, FunctionId, FunctionKey, LayoutId, TypeTable, ValueId};
use crate::lower::member::{GivenName, PropertyName};
use crate::lower::positions::SiteOrigin;
use crate::lower::{FileLowering, FunctionLowering, convert, function, layouts};

#[derive(Copy, Clone)]
enum FieldTarget {
    Property(PropertyName),
    Private(PrivateNameId),
}

pub(crate) fn static_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
) -> DeclaredType {
    let written = written_static_field_position(file, class, member);
    let starts_undefined = file.hir[member].init.is_none();
    match starts_undefined {
        true => file.add_undefined(written),
        false => written,
    }
}

fn written_static_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
) -> DeclaredType {
    let shape = file.queries.class_shape(file.own_class(class));
    let entries = file.classes.entries_of_members.entry(class);
    let entries = entries.or_insert_with(|| {
        let mut entries = FxHashMap::default();
        for (index, entry) in shape.members.iter().enumerate() {
            if let ClassMemberSource::Member(member) = entry.source {
                entries.entry(member).or_insert(index as u32);
            }
        }
        entries
    });
    let Some(&entry) = entries.get(&member) else {
        return file.member_annotation_position(member, TypeSiteKind::StaticField);
    };
    let entry = &shape.members[entry as usize];
    let origin = SiteOrigin {
        kind: TypeSiteKind::StaticField,
        position: file.hir[member].name_pos,
    };
    file.create_position(entry.types, origin)
}

pub(super) fn member_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
) -> DeclaredType {
    let hir = file.hir;
    if hir[member].flags.contains(Flags::STATIC) {
        return static_field_position(file, class, member);
    }
    let layout = file.own_class_layout(class);
    let field = match is_auto_accessor(hir, member) {
        true => layouts::own_fields(file, layout).find_accessor_storage(member),
        false => file.find_named_field(layout, member),
    };
    match field {
        Some(field) => file.field_position(layout, field),
        None => file.member_annotation_position(member, TypeSiteKind::Field),
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_named_field(&mut self, layout: LayoutId, member: MemberId) -> Option<u32> {
        let key = match self.hir.runtime_member_key(member) {
            PropKey::Name(name) => self.name_key(name),
            PropKey::Private(name) => layouts::private_key(self, layout, name),
            PropKey::Computed(_) | PropKey::None => return None,
        };
        self.find_field(layout, key)
    }

    fn member_annotation_position(&mut self, member: MemberId, kind: TypeSiteKind) -> DeclaredType {
        match self.hir[member].ty.some() {
            Some(annotation) => self.annotation_position(annotation, kind),
            None => DeclaredType::untyped(),
        }
    }

    // An entry of a collection that is private state of the class.
    pub(in crate::lower) fn private_state_fields(
        &mut self,
        layout: LayoutId,
        class: ClassRef,
    ) -> SmallVec<[Field; 4]> {
        let inputs = self.inputs;
        let files = self.queries.files();
        let states = inputs
            .known_helpers
            .private_states(files, inputs.modules, class.file);
        let Some(states) = states else {
            return SmallVec::new();
        };
        let bound = files.bound(class.file);
        let states = states.states_of_class(class.class).iter();
        let names: SmallVec<[Atom; 4]> = states
            .map(|state| bound.symbol(state.symbol).name)
            .collect();
        let fields = names.into_iter().map(|name| Field {
            key: Some(layouts::private_key(self, layout, name)),
            declared: DeclaredType::untyped(),
            flags: FieldFlags::IS_PRIVATE | FieldFlags::IS_HIDDEN,
            ..Field::default()
        });
        fields.collect()
    }

    pub(crate) fn lower_initializer(
        &mut self,
        function: FunctionId,
        class: ClassId,
        is_static: bool,
    ) {
        let plan = self.class_plan(class);
        let elements = match is_static {
            true => &plan.static_elements,
            false => &plan.instance_elements,
        };
        let mut lowering = FunctionLowering::begin(self, function);
        let this = lowering.builder.this_value();
        let mut this = this.expect("an initializer function takes this");
        if lowering.builder.function().kind != FunctionKind::Initializer {
            let split = lowering.split_on_type(this, TypeTable::OBJECT);
            lowering.builder.switch_to(split.not_taken);
            let undefined = lowering.builder.undefined();
            lowering.emit_return(undefined, None);
            lowering.builder.switch_to(split.taken);
            this = split.taken_value;
        } else {
            this = lowering.claim_operand_kind(this, OperandKind::Object);
        }
        for &element in elements {
            lowering.emit_class_element(class, element, this);
        }
        let undefined = lowering.builder.undefined();
        lowering.emit_return(undefined, None);
        lowering.finish();
    }
}

// A super call in evaluated text hands the initializer whatever the parent returned.
pub(in crate::lower) fn is_called_by_evaluated_text(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
) -> bool {
    let evals = file.bound.runtime.eval_scopes();
    if evals.is_empty() || !is_derived_class(file.hir, class) {
        return false;
    }
    let Some(constructor) = file.class_plan(class).constructor else {
        return false;
    };
    evals.iter().any(|(_, eval)| {
        let owner = file.scopes.lexical_owner(eval.scope);
        file.bound.code_unit(owner) == CodeUnit::Function(constructor)
    })
}

pub(super) fn declare_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    is_static: bool,
) -> FunctionId {
    let reference = file.own_class(class);
    let key = match is_static {
        true => FunctionKey::StaticInitializer(reference),
        false => FunctionKey::InstanceInitializer(reference),
    };
    file.declare_function(key, |file| {
        let (kind, this_type) = match is_static {
            true => {
                let this_type = DeclaredType::from_compiler(TypeTable::FUNCTION);
                (FunctionKind::Initializer, this_type)
            }
            false if is_called_by_evaluated_text(file, class) => {
                (FunctionKind::Method, DeclaredType::untyped())
            }
            false => {
                let this_type = file.class_this_type(reference, None);
                (FunctionKind::Initializer, this_type)
            }
        };
        let position = file.hir[class].name_pos;
        let mut header = function::create_header(file, key, kind, position);
        header.flags |= FunctionFlags::HAS_THIS | FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
        header.this_type = this_type;
        header
    })
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn emit_call_on(&mut self, function: FunctionId, this: ValueId) {
        let arguments = function::EntryArguments {
            this: Some(this),
            ..Default::default()
        };
        self.emit_direct_call(function, arguments);
    }

    pub(super) fn emit_class_element(
        &mut self,
        class: ClassId,
        element: ClassElement,
        this: ValueId,
    ) {
        let caller_position = self.position();
        match element {
            ClassElement::Brand => self.emit_brand_definition(class, this),
            ClassElement::ParameterPropertyField(parameter) => {
                self.emit_parameter_property_field(parameter, this);
            }
            ClassElement::Field { member, value } => {
                self.lower_field(class, member, value, true, this);
            }
            ClassElement::AssignedField { member } => {
                self.lower_field(class, member, FieldValue::Initializer, false, this);
            }
            ClassElement::AccessorStorage { member, value } => {
                let name = self.file.bound.private_name_of_member(member);
                let function_name = name.map(|name| self.name_under_private_name(class, name));
                let value = self.lower_field_value(class, member, value, function_name, this);
                self.set_position(self.file.hir[member].name_pos);
                let stored = self.file.resolve_accessor_storage(member);
                self.emit_stored_definition(stored, this, value);
            }
            ClassElement::RunInitializers { initializers } => {
                let list = self.get_initializer_list(class, initializers);
                self.emit_initializer_run(list, this);
            }
            ClassElement::StaticBlock(member) => self.lower_static_block(member, this),
        }
        self.set_position(caller_position);
    }

    fn emit_parameter_property_field(&mut self, parameter: ParamId, this: ValueId) {
        let hir = self.file.hir;
        let name = match hir[hir[parameter].pat].kind {
            PatKind::Ident(name) => name,
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
                debug_assert!(false, "a parameter property binds an identifier");
                return;
            }
        };
        self.set_position(hir[parameter].pos);
        let key = self.file.name_key(name);
        let undefined = self.builder.undefined();
        self.emit_define(this, PropertyName::Constant(key), undefined);
    }

    fn lower_field(
        &mut self,
        class: ClassId,
        member: MemberId,
        value: FieldValue,
        is_defined: bool,
        this: ValueId,
    ) {
        let target = self.find_field_target(class, member);
        let function_name = is_defined.then(|| match target {
            FieldTarget::Property(name) => GivenName::under_member(&self.file.hir[member], name),
            FieldTarget::Private(name) => self.name_under_private_name(class, name),
        });
        let value = self.lower_field_value(class, member, value, function_name, this);
        self.set_position(self.file.hir[member].name_pos);
        match (target, is_defined) {
            (FieldTarget::Property(name), true) => self.emit_define(this, name, value),
            (FieldTarget::Property(name), false) => self.emit_set(this, name, value),
            (FieldTarget::Private(name), true) => self.emit_field_definition(this, name, value),
            (FieldTarget::Private(name), false) => self.emit_name_set(this, name, value, None),
        }
    }

    fn name_under_private_name(&mut self, class: ClassId, name: PrivateNameId) -> GivenName {
        let layout = self.file.own_class_layout(class);
        let name = self.file.bound.private_name(name).name;
        PropertyName::Constant(layouts::private_key(self.file, layout, name)).into()
    }

    fn find_field_target(&mut self, class: ClassId, member: MemberId) -> FieldTarget {
        match self.file.hir.runtime_member_key(member) {
            PropKey::Private(_) => {
                let name = self.file.bound.private_name_of_member(member);
                FieldTarget::Private(name.expect("the binder records the name of a private member"))
            }
            PropKey::Name(name) => {
                let key = self.file.name_key(name);
                FieldTarget::Property(PropertyName::Constant(key))
            }
            PropKey::Computed(_) => {
                let constant_key = self.file.classes.constant_keys.get(&member).copied();
                FieldTarget::Property(match constant_key {
                    Some(key) => PropertyName::Constant(key),
                    None => {
                        let slot = ClassSlot::ComputedKey(member);
                        PropertyName::Computed(self.get_class_slot(class, slot))
                    }
                })
            }
            PropKey::None => {
                debug_assert!(false, "a class field has a key");
                let text = self.file.intern_bytes(b"");
                FieldTarget::Property(PropertyName::Constant(self.file.text_key(text)))
            }
        }
    }

    fn lower_field_value(
        &mut self,
        class: ClassId,
        member: MemberId,
        value: FieldValue,
        function_name: Option<GivenName>,
        this: ValueId,
    ) -> ValueId {
        let source = self.file.hir[member].init.some();
        let initial = match value {
            FieldValue::Undefined => return self.builder.undefined(),
            FieldValue::Initializer => {
                self.lower_field_initializer_expression(member, function_name)
            }
            FieldValue::Decorated { initializers } => {
                let undecorated = match source {
                    Some(_) => self.lower_field_initializer_expression(member, None),
                    None => self.builder.undefined(),
                };
                let list = self.get_initializer_list(class, initializers);
                let arguments = [list, this, undecorated];
                self.emit_builtin_call(BuiltinId::CompilerHelpersRunValueInitializers, &arguments)
            }
        };
        let position = member_field_position(self.file, class, member);
        let subject = convert::Int32Subject::ClassField(member);
        self.describe_int32_flow(position, subject, source);
        self.convert_initializer(initial, position, source)
    }

    fn lower_field_initializer_expression(
        &mut self,
        member: MemberId,
        function_name: Option<GivenName>,
    ) -> ValueId {
        let initializer = self.file.hir[member].init;
        let scope = self.file.bound.field_initializer_scope(member);
        if let Some(scope) = scope {
            self.enter_scope(scope);
        }
        let value = match function_name {
            Some(name) => self.lower_named_evaluation(initializer, name),
            None => self.lower_expression(initializer),
        };
        if let Some(scope) = scope {
            self.leave_scope(scope);
        }
        value
    }

    // A block is a function of its own, so that a stack trace has a frame for it. The frame of the initializer is hidden.
    fn lower_static_block(&mut self, member: MemberId, this: ValueId) {
        let function = self.file.hir[member].func;
        if self.file.decisions().is_dead_function(function) {
            return;
        }
        let block = function::declare_source_function(self.file, function, None);
        self.emit_call_on(block, this);
    }
}
