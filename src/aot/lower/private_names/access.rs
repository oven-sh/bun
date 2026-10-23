use bun_sema::atom::{Atom, known};
use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, ExprId, ExprKind, MemberId};
use smallvec::SmallVec;

use super::{
    AccessorStorage, PrivateBinding, PrivateHolder, resolve_accessor_storage, resolve_private_name,
};
use crate::ir::generated::{BlockFrequency, RuntimeErrorKind};
use crate::ir::{ClassSlot, Edge, TypeTable, ValueId};
use crate::lower::call::{self, Arguments, CallSite};
use crate::lower::member::{self, PropertyName};
use crate::lower::{
    FileLowering, FunctionLowering, class, condition, convert, exception, expression, layouts,
};

#[derive(Copy, Clone)]
struct StoredValue {
    class: ClassId,
    member: MemberId,
    holder: PrivateHolder,
}

impl StoredValue {
    fn of_name(binding: PrivateBinding, member: MemberId) -> StoredValue {
        StoredValue {
            class: binding.class,
            member,
            holder: binding.holder,
        }
    }

    fn of_accessor(storage: AccessorStorage) -> StoredValue {
        StoredValue {
            class: storage.class,
            member: storage.member,
            holder: storage.holder,
        }
    }
}

fn get_token(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, class: ClassId) -> ValueId {
    class::get_class_slot(lowering, class, ClassSlot::ClassToken)
}

fn get_decorated_accessor_function(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
    name: Atom,
) -> ValueId {
    let pair = class::get_class_slot(lowering, class, ClassSlot::PrivateMethod(member));
    let key = member::name_key(lowering.file, name);
    member::emit_get(lowering, pair, PropertyName::Constant(key))
}

fn emit_error(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    error: RuntimeErrorKind,
) -> ValueId {
    exception::emit_throw_runtime_error(lowering, error, None);
    lowering.builder.undefined()
}

fn emit_class_object_comparison(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    object: ValueId,
) -> ValueId {
    let class_object = class::get_class_slot(lowering, class, ClassSlot::ClassObject);
    lowering.builder.strict_eq(object, class_object)
}

fn emit_class_object_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    object: ValueId,
    error: RuntimeErrorKind,
) {
    let is_class_object = emit_class_object_comparison(lowering, class, object);
    let admitted = lowering.create_block();
    let rejected = lowering.create_unlikely_block();
    lowering
        .builder
        .branch(is_class_object, Edge::to(admitted), Edge::to(rejected));
    lowering.continue_in(rejected);
    exception::emit_throw_runtime_error(lowering, error, None);
    lowering.continue_in(admitted);
}

fn emit_admission(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    holder: PrivateHolder,
    object: ValueId,
    error: RuntimeErrorKind,
) {
    match holder {
        PrivateHolder::Instance { layout, field } => {
            let token = get_token(lowering, class);
            lowering.builder.private_get(object, token, layout, field);
        }
        PrivateHolder::ClassObject => emit_class_object_test(lowering, class, object, error),
    }
}

fn get_defined_static_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    stored: StoredValue,
    object: ValueId,
    error: RuntimeErrorKind,
) -> ValueId {
    emit_class_object_test(lowering, stored.class, object, error);
    let slot = ClassSlot::StaticField(stored.member);
    let value = class::get_class_slot(lowering, stored.class, slot);
    let split = condition::split_on_type(lowering, value, TypeTable::ABSENT);
    lowering
        .builder
        .set_frequency(split.taken, BlockFrequency::Unlikely);
    lowering.builder.switch_to(split.taken);
    exception::emit_throw_runtime_error(lowering, error, None);
    lowering.builder.switch_to(split.not_taken);
    split.not_taken_value
}

fn emit_stored_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    stored: StoredValue,
    object: ValueId,
) -> ValueId {
    match stored.holder {
        PrivateHolder::Instance { layout, field } => {
            let token = get_token(lowering, stored.class);
            lowering.builder.private_get(object, token, layout, field)
        }
        PrivateHolder::ClassObject => {
            let error = RuntimeErrorKind::InvalidPrivateRead;
            get_defined_static_value(lowering, stored, object, error)
        }
    }
}

fn emit_stored_write(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    stored: StoredValue,
    object: ValueId,
    value: ValueId,
    source: Option<ExprId>,
) {
    match stored.holder {
        PrivateHolder::Instance { layout, field } => {
            let position = layouts::field_position(lowering.file, layout, field);
            let value = convert::convert(lowering, value, position, source);
            let token = get_token(lowering, stored.class);
            lowering
                .builder
                .private_set(object, token, layout, field, value);
        }
        PrivateHolder::ClassObject => {
            let error = RuntimeErrorKind::InvalidPrivateWrite;
            get_defined_static_value(lowering, stored, object, error);
            let position = class::static_field_position(lowering.file, stored.class, stored.member);
            let value = convert::convert(lowering, value, position, source);
            let slot = ClassSlot::StaticField(stored.member);
            class::set_class_slot(lowering, stored.class, slot, value);
        }
    }
}

fn emit_stored_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    stored: StoredValue,
    object: ValueId,
    value: ValueId,
) {
    match stored.holder {
        PrivateHolder::Instance { layout, field } => {
            let token = get_token(lowering, stored.class);
            lowering
                .builder
                .private_define(object, token, layout, field, value);
        }
        PrivateHolder::ClassObject => {
            let slot = ClassSlot::StaticField(stored.member);
            class::set_class_slot(lowering, stored.class, slot, value);
        }
    }
}

fn emit_function_call(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: ValueId,
    object: ValueId,
    arguments: &[ValueId],
) -> ValueId {
    let arguments = Arguments::Values(SmallVec::from_slice(arguments));
    call::emit_call(
        lowering,
        function,
        Some(object),
        arguments,
        CallSite::default(),
    )
}

pub(in crate::lower) fn emit_name_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PrivateNameId,
) -> ValueId {
    let binding = resolve_private_name(lowering.file, name);
    let PrivateBinding { class, holder, .. } = binding;
    match binding.members {
        PrivateMembers::Field(member) => {
            emit_stored_read(lowering, StoredValue::of_name(binding, member), object)
        }
        PrivateMembers::AutoAccessor(member) if !binding.is_decorated => {
            emit_stored_read(lowering, StoredValue::of_name(binding, member), object)
        }
        PrivateMembers::AutoAccessor(member) => {
            let error = RuntimeErrorKind::InvalidPrivateRead;
            emit_admission(lowering, class, holder, object, error);
            let getter = get_decorated_accessor_function(lowering, class, member, known::get);
            emit_function_call(lowering, getter, object, &[])
        }
        PrivateMembers::Method(member) => {
            let error = RuntimeErrorKind::InvalidPrivateBrand;
            emit_admission(lowering, class, holder, object, error);
            class::get_class_slot(lowering, class, ClassSlot::PrivateMethod(member))
        }
        PrivateMembers::Accessor { getter, .. } => {
            let error = RuntimeErrorKind::InvalidPrivateBrand;
            emit_admission(lowering, class, holder, object, error);
            let Some(getter) = getter else {
                return emit_error(lowering, RuntimeErrorKind::PrivateAccessorWithoutGetter);
            };
            let getter = class::get_class_slot(lowering, class, ClassSlot::PrivateMethod(getter));
            emit_function_call(lowering, getter, object, &[])
        }
    }
}

pub(in crate::lower) fn emit_name_set(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PrivateNameId,
    value: ValueId,
    source: Option<ExprId>,
) {
    let binding = resolve_private_name(lowering.file, name);
    let PrivateBinding { class, holder, .. } = binding;
    match binding.members {
        PrivateMembers::Field(member) => {
            let stored = StoredValue::of_name(binding, member);
            emit_stored_write(lowering, stored, object, value, source);
        }
        PrivateMembers::AutoAccessor(member) if !binding.is_decorated => {
            let stored = StoredValue::of_name(binding, member);
            emit_stored_write(lowering, stored, object, value, source);
        }
        PrivateMembers::AutoAccessor(member) => {
            let error = RuntimeErrorKind::InvalidPrivateWrite;
            emit_admission(lowering, class, holder, object, error);
            let setter = get_decorated_accessor_function(lowering, class, member, known::set);
            emit_function_call(lowering, setter, object, &[value]);
        }
        PrivateMembers::Method(_) => {
            let error = RuntimeErrorKind::InvalidPrivateBrand;
            emit_admission(lowering, class, holder, object, error);
            emit_error(lowering, RuntimeErrorKind::PrivateMethodWrite);
        }
        PrivateMembers::Accessor { setter, .. } => {
            let error = RuntimeErrorKind::InvalidPrivateBrand;
            emit_admission(lowering, class, holder, object, error);
            let Some(setter) = setter else {
                emit_error(lowering, RuntimeErrorKind::PrivateAccessorWithoutSetter);
                return;
            };
            let setter = class::get_class_slot(lowering, class, ClassSlot::PrivateMethod(setter));
            emit_function_call(lowering, setter, object, &[value]);
        }
    }
}

pub(in crate::lower) fn emit_name_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PrivateNameId,
) -> ValueId {
    let binding = resolve_private_name(lowering.file, name);
    match binding.holder {
        PrivateHolder::Instance { layout, field } => {
            let token = get_token(lowering, binding.class);
            lowering.builder.private_has(object, token, layout, field)
        }
        PrivateHolder::ClassObject => match binding.members {
            PrivateMembers::Field(member) => {
                emit_static_field_test(lowering, name, binding.class, member, object)
            }
            PrivateMembers::AutoAccessor(member) if !binding.is_decorated => {
                emit_static_field_test(lowering, name, binding.class, member, object)
            }
            _ => {
                let error = RuntimeErrorKind::PrivateStaticTestOfNonObject;
                let checked = lowering.builder.require_object(object, error);
                emit_class_object_comparison(lowering, binding.class, checked)
            }
        },
    }
}

// `in` throws the same error for every key when its right operand is not an object.
fn emit_in_operand_check(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PrivateNameId,
) -> ValueId {
    let split = condition::split_on_type(lowering, object, TypeTable::OBJECT);
    lowering
        .builder
        .set_frequency(split.not_taken, BlockFrequency::Unlikely);
    lowering.builder.switch_to(split.not_taken);
    let name = lowering.file.bound.private_name(name).name;
    let key = member::name_key(lowering.file, name);
    lowering.builder.prop_has(split.not_taken_value, key);
    lowering.builder.unreachable();
    lowering.builder.switch_to(split.taken);
    split.taken_value
}

// Methods and accessors are on the class object before any static field is defined.
fn emit_static_field_test(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    name: PrivateNameId,
    class: ClassId,
    member: MemberId,
    object: ValueId,
) -> ValueId {
    let checked = emit_in_operand_check(lowering, object, name);
    let is_class_object = emit_class_object_comparison(lowering, class, checked);
    let result = lowering.builder.create_variable(None);
    let admitted = lowering.create_block();
    let join = lowering.create_block();
    lowering.builder.write_variable(result, is_class_object);
    lowering
        .builder
        .branch(is_class_object, Edge::to(admitted), Edge::to(join));
    lowering.continue_in(admitted);
    let value = class::get_class_slot(lowering, class, ClassSlot::StaticField(member));
    let is_absent = lowering.builder.type_test(value, TypeTable::ABSENT);
    let is_defined = lowering.builder.logical_not(is_absent);
    lowering.builder.write_variable(result, is_defined);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

pub(super) fn lower_private_in(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Binary { left, right, .. } = hir[expression].kind else {
        debug_assert!(false, "a private `in` test is a Binary expression");
        return lowering.builder.undefined();
    };
    let object = expression::lower_expression(lowering, right);
    lowering.set_position(hir[expression].pos);
    match lowering.file.bound.private_name_of_reference(left) {
        Some(name) => emit_name_test(lowering, object, name),
        None => emit_undeclared_name_error(lowering),
    }
}

pub(super) fn emit_undeclared_name_error(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> ValueId {
    emit_error(lowering, RuntimeErrorKind::UnresolvableReference)
}

pub(in crate::lower) fn emit_brand_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    object: ValueId,
) {
    let reference = ClassRef {
        file: lowering.file.file,
        class,
    };
    let layout = layouts::class_layout(lowering.file, reference);
    let brand = layouts::own_fields(lowering.file, layout).brand();
    let brand = brand.expect("a class with instance private state has a brand");
    let token = get_token(lowering, class);
    if !fails_at_first_private_field(lowering.file, class) {
        lowering
            .builder
            .private_define(object, token, layout, brand, token);
        return;
    }
    let has_brand = lowering.builder.private_has(object, token, layout, brand);
    let define = lowering.create_block();
    let join = lowering.create_block();
    lowering
        .builder
        .branch(has_brand, Edge::to(join), Edge::to(define));
    lowering.continue_in(define);
    lowering
        .builder
        .private_define(object, token, layout, brand, token);
    lowering.jump(join);
    lowering.continue_in(join);
}

// A base constructor that returns an object lets a derived class initialize that object twice.
fn fails_at_first_private_field(file: &FileLowering<'_, '_, '_, '_>, class: ClassId) -> bool {
    let mut names = file.bound.private_names_of_class(class);
    class::is_derived_class(file.hir, class)
        && !names.any(|(_, name)| {
            !name.is_static
                && match name.members {
                    PrivateMembers::Field(_) => false,
                    _ => true,
                }
        })
}

pub(in crate::lower) fn emit_field_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PrivateNameId,
    value: ValueId,
) {
    let binding = resolve_private_name(lowering.file, name);
    match binding.members {
        PrivateMembers::Field(member) | PrivateMembers::AutoAccessor(member) => {
            let stored = StoredValue::of_name(binding, member);
            emit_stored_definition(lowering, stored, object, value);
        }
        PrivateMembers::Method(_) | PrivateMembers::Accessor { .. } => {
            debug_assert!(false, "only a field or an accessor field stores a value");
        }
    }
}

pub(in crate::lower) fn emit_storage_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    member: MemberId,
    value: ValueId,
) {
    let stored = StoredValue::of_accessor(resolve_accessor_storage(lowering.file, member));
    emit_stored_definition(lowering, stored, object, value);
}

pub(in crate::lower) fn emit_storage_get(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    member: MemberId,
) -> ValueId {
    let stored = StoredValue::of_accessor(resolve_accessor_storage(lowering.file, member));
    emit_stored_read(lowering, stored, object)
}

pub(in crate::lower) fn emit_storage_set(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    member: MemberId,
    value: ValueId,
) {
    let stored = StoredValue::of_accessor(resolve_accessor_storage(lowering.file, member));
    emit_stored_write(lowering, stored, object, value, None);
}
