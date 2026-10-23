use bun_sema::atom::Atom;
use bun_sema::bind::{PrivateNameId, SymbolId};
use bun_sema::check::aot::{ClassMemberSource, ClassRef};
use bun_sema::hir::{ClassId, Flags, MemberId, ParamId, PatKind, PropKey};
use smallvec::SmallVec;

use super::{ClassElement, FieldValue, class_plan, get_class_slot, is_auto_accessor};
use crate::ir::generated::{
    Field, FieldFlags, Function, FunctionFlags, FunctionKind, TypeSiteKind,
};
use crate::ir::{ClassSlot, DeclaredType, FunctionId, FunctionKey, LayoutId, TypeTable, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::{
    FileLowering, FunctionLowering, control, convert, decorators, expression, function, layouts,
    private_names, scope,
};

#[derive(Copy, Clone)]
enum FieldTarget {
    Property(PropertyName),
    Private(PrivateNameId),
}

pub(super) fn static_field_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
) -> DeclaredType {
    let shape = file.queries.class_shape(ClassRef {
        file: file.file,
        class,
    });
    let source = ClassMemberSource::Member(member);
    let Some(entry) = shape.members.iter().find(|entry| entry.source == source) else {
        return member_annotation_position(file, member, TypeSiteKind::StaticField);
    };
    let origin = SiteOrigin {
        kind: TypeSiteKind::StaticField,
        position: file.hir[member].name_pos,
    };
    positions::create_position(file, entry.types, origin)
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
    let reference = ClassRef {
        file: file.file,
        class,
    };
    let layout = layouts::class_layout(file, reference);
    let field = match is_auto_accessor(hir, member) {
        true => layouts::own_fields(file, layout).find_accessor_storage(member),
        false => find_named_field(file, layout, member),
    };
    match field {
        Some(field) => layouts::field_position(file, layout, field),
        None => member_annotation_position(file, member, TypeSiteKind::Field),
    }
}

fn find_named_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    member: MemberId,
) -> Option<u32> {
    let key = match file.hir.runtime_member_key(member) {
        PropKey::Name(name) => member::name_key(file, name),
        PropKey::Private(name) => layouts::private_key(file, layout, name),
        PropKey::Computed(_) | PropKey::None => return None,
    };
    layouts::find_field(file, layout, key)
}

fn member_annotation_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    member: MemberId,
    kind: TypeSiteKind,
) -> DeclaredType {
    match file.hir[member].ty.some() {
        Some(annotation) => positions::annotation_position(file, annotation, kind),
        None => DeclaredType::untyped(),
    }
}

// An entry of a collection that is private state of the class.
pub(in crate::lower) fn private_state_fields(
    file: &mut FileLowering<'_, '_, '_, '_>,
    layout: LayoutId,
    class: ClassRef,
) -> SmallVec<[Field; 4]> {
    let inputs = file.inputs;
    let files = file.queries.files();
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
        key: Some(layouts::private_key(file, layout, name)),
        declared: DeclaredType::untyped(),
        flags: FieldFlags::IS_PRIVATE | FieldFlags::IS_HIDDEN,
        ..Field::default()
    });
    fields.collect()
}

pub(in crate::lower) fn find_private_state_field(
    file: &mut FileLowering<'_, '_, '_, '_>,
    owner: ClassId,
    state: SymbolId,
) -> Option<(LayoutId, u32)> {
    let reference = ClassRef {
        file: file.file,
        class: owner,
    };
    let layout = layouts::class_layout(file, reference);
    let name = file.bound.symbol(state).name;
    let key = layouts::private_key(file, layout, name);
    let field = layouts::find_field(file, layout, key)?;
    Some((layout, field))
}

pub(super) fn declare_instance_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
) -> FunctionId {
    let reference = ClassRef {
        file: file.file,
        class,
    };
    let key = FunctionKey::InstanceInitializer(reference);
    file.declare_function(key, |file| {
        let this_type = positions::class_this_type(file, reference, None);
        create_initializer_header(file, key, class, this_type)
    })
}

pub(super) fn declare_static_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
) -> FunctionId {
    let reference = ClassRef {
        file: file.file,
        class,
    };
    let key = FunctionKey::StaticInitializer(reference);
    file.declare_function(key, |file| {
        let this_type = DeclaredType::from_compiler(TypeTable::FUNCTION);
        create_initializer_header(file, key, class, this_type)
    })
}

fn create_initializer_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    class: ClassId,
    this_type: DeclaredType,
) -> Function {
    let position = file.hir[class].name_pos;
    let mut header = function::create_header(file, key, FunctionKind::Initializer, position);
    header.flags |= FunctionFlags::HAS_THIS | FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
    header.this_type = this_type;
    header
}

pub(super) fn lower_instance_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
) {
    let plan = class_plan(file, class);
    lower_initializer_body(file, function, class, &plan.instance_elements);
}

pub(super) fn lower_static_initializer(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
) {
    let plan = class_plan(file, class);
    lower_initializer_body(file, function, class, &plan.static_elements);
}

fn lower_initializer_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    class: ClassId,
    elements: &[ClassElement],
) {
    let mut lowering = FunctionLowering::begin(file, function);
    let this = lowering.builder.this_value();
    let this = this.expect("an initializer function takes this");
    for &element in elements {
        emit_class_element(&mut lowering, class, element, this);
    }
    let undefined = lowering.builder.undefined();
    control::emit_return(&mut lowering, undefined, None);
    lowering.finish();
}

pub(super) fn emit_class_element(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    element: ClassElement,
    this: ValueId,
) {
    let caller_position = lowering.position();
    match element {
        ClassElement::Brand => private_names::emit_brand_definition(lowering, class, this),
        ClassElement::ParameterPropertyField(parameter) => {
            emit_parameter_property_field(lowering, parameter, this);
        }
        ClassElement::Field { member, value } => {
            lower_defined_field(lowering, class, member, value, this);
        }
        ClassElement::AssignedField { member } => {
            lower_assigned_field(lowering, class, member, this);
        }
        ClassElement::AccessorStorage { member, value } => {
            let value = lower_field_value(lowering, class, member, value, None, this);
            lowering.set_position(lowering.file.hir[member].name_pos);
            private_names::emit_storage_definition(lowering, this, member, value);
        }
        ClassElement::RunInitializers { initializers } => {
            let list = decorators::get_initializer_list(lowering, class, initializers);
            decorators::emit_initializer_run(lowering, list, this);
        }
        ClassElement::StaticBlock(member) => lower_static_block(lowering, member, this),
    }
    lowering.set_position(caller_position);
}

fn emit_parameter_property_field(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    this: ValueId,
) {
    let hir = lowering.file.hir;
    let name = match hir[hir[parameter].pat].kind {
        PatKind::Ident(name) => name,
        PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
            debug_assert!(false, "a parameter property binds an identifier");
            return;
        }
    };
    lowering.set_position(hir[parameter].pos);
    let key = member::name_key(lowering.file, name);
    let undefined = lowering.builder.undefined();
    member::emit_define(lowering, this, PropertyName::Constant(key), undefined);
}

fn lower_defined_field(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
    value: FieldValue,
    this: ValueId,
) {
    let target = find_field_target(lowering, class, member);
    let function_name = get_field_function_name(lowering.file, class, target);
    let value = lower_field_value(lowering, class, member, value, Some(function_name), this);
    lowering.set_position(lowering.file.hir[member].name_pos);
    match target {
        FieldTarget::Property(name) => member::emit_define(lowering, this, name, value),
        FieldTarget::Private(name) => {
            private_names::emit_field_definition(lowering, this, name, value);
        }
    }
}

fn lower_assigned_field(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
    this: ValueId,
) {
    let target = find_field_target(lowering, class, member);
    let value = lower_field_value(lowering, class, member, FieldValue::Initializer, None, this);
    lowering.set_position(lowering.file.hir[member].name_pos);
    match target {
        FieldTarget::Property(name) => member::emit_set(lowering, this, name, value),
        FieldTarget::Private(name) => {
            private_names::emit_name_set(lowering, this, name, value, None);
        }
    }
}

fn find_field_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
) -> FieldTarget {
    match lowering.file.hir.runtime_member_key(member) {
        PropKey::Private(_) => {
            let name = lowering.file.bound.private_name_of_member(member);
            FieldTarget::Private(name.expect("the binder records the name of a private member"))
        }
        PropKey::Name(name) => {
            let key = member::name_key(lowering.file, name);
            FieldTarget::Property(PropertyName::Constant(key))
        }
        PropKey::Computed(_) => {
            let constant_key = lowering.file.classes.constant_keys.get(&member).copied();
            FieldTarget::Property(match constant_key {
                Some(key) => PropertyName::Constant(key),
                None => {
                    let slot = ClassSlot::ComputedKey(member);
                    PropertyName::Computed(get_class_slot(lowering, class, slot))
                }
            })
        }
        PropKey::None => {
            debug_assert!(false, "a class field has a key");
            let text = lowering.file.intern_bytes(b"");
            FieldTarget::Property(PropertyName::Constant(lowering.file.text_key(text)))
        }
    }
}

fn get_field_function_name(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassId,
    target: FieldTarget,
) -> PropertyName {
    match target {
        FieldTarget::Property(name) => name,
        FieldTarget::Private(id) => {
            let reference = ClassRef {
                file: file.file,
                class,
            };
            let layout = layouts::class_layout(file, reference);
            let name = file.bound.private_name(id).name;
            PropertyName::Constant(layouts::private_key(file, layout, name))
        }
    }
}

fn lower_field_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
    value: FieldValue,
    function_name: Option<PropertyName>,
    this: ValueId,
) -> ValueId {
    let source = lowering.file.hir[member].init.some();
    let initial = match value {
        FieldValue::Undefined => return lowering.builder.undefined(),
        FieldValue::Initializer => {
            lower_field_initializer_expression(lowering, member, function_name)
        }
        FieldValue::Decorated { initializers } => {
            let undecorated = match source {
                Some(_) => lower_field_initializer_expression(lowering, member, None),
                None => lowering.builder.undefined(),
            };
            let list = decorators::get_initializer_list(lowering, class, initializers);
            decorators::emit_value_initializer_run(lowering, list, this, undecorated)
        }
    };
    let position = member_field_position(lowering.file, class, member);
    let subject = convert::Int32Subject::ClassField(member);
    convert::describe_int32_flow(lowering, position, subject, source);
    convert::convert_initializer(lowering, initial, position, source)
}

fn lower_field_initializer_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberId,
    function_name: Option<PropertyName>,
) -> ValueId {
    let initializer = lowering.file.hir[member].init;
    let scope = lowering.file.bound.field_initializer_scope(member);
    if let Some(scope) = scope {
        scope::enter_scope(lowering, scope);
    }
    let value = match function_name {
        Some(name) => expression::lower_named_evaluation(lowering, initializer, name),
        None => expression::lower_expression(lowering, initializer),
    };
    if let Some(scope) = scope {
        scope::leave_scope(lowering, scope);
    }
    value
}

// A block is a function of its own, so that a stack trace has a frame for it. The frame of the initializer is hidden.
fn lower_static_block(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberId,
    this: ValueId,
) {
    let function = lowering.file.hir[member].func;
    if lowering.file.decisions().is_dead_function(function) {
        return;
    }
    let block = function::declare_source_function(lowering.file, function, None);
    let arguments = function::EntryArguments {
        this: Some(this),
        ..Default::default()
    };
    function::emit_direct_call(lowering, block, arguments);
}
