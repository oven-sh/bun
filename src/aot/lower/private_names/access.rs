use bun_sema::atom::{Atom, known};
use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::hir::{ClassId, ExprId, ExprKind, MemberId};

use super::{PrivateBinding, PrivateHolder, StoredValue};
use crate::ir::generated::{BlockFrequency, RuntimeErrorKind};
use crate::ir::{ClassSlot, Edge, TypeTable, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FunctionLowering, call, class, convert, layouts};

impl StoredValue {
    pub(in crate::lower) fn of_name(binding: PrivateBinding, member: MemberId) -> StoredValue {
        StoredValue {
            class: binding.class,
            member,
            holder: binding.holder,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn get_decorated_accessor_function(
        &mut self,
        class: ClassId,
        member: MemberId,
        name: Atom,
    ) -> ValueId {
        let pair = self.get_class_slot(class, ClassSlot::PrivateMethod(member));
        let key = self.file.name_key(name);
        self.emit_get(pair, PropertyName::Constant(key))
    }

    pub(super) fn emit_error(&mut self, error: RuntimeErrorKind) -> ValueId {
        self.emit_throw_runtime_error(error, None);
        self.builder.undefined()
    }

    fn emit_class_object_comparison(&mut self, class: ClassId, object: ValueId) -> ValueId {
        let class_object = self.get_class_slot(class, ClassSlot::ClassObject);
        self.builder.strict_eq(object, class_object)
    }

    fn emit_class_object_test(&mut self, class: ClassId, object: ValueId, error: RuntimeErrorKind) {
        let is_class_object = self.emit_class_object_comparison(class, object);
        let admitted = self.create_block();
        let rejected = self.create_unlikely_block();
        self.builder
            .branch(is_class_object, Edge::to(admitted), Edge::to(rejected));
        self.continue_in(rejected);
        self.emit_throw_runtime_error(error, None);
        self.continue_in(admitted);
    }

    fn emit_admission(
        &mut self,
        class: ClassId,
        holder: PrivateHolder,
        object: ValueId,
        error: RuntimeErrorKind,
    ) {
        match holder {
            PrivateHolder::Instance { layout, field } => {
                let token = self.get_class_slot(class, ClassSlot::ClassToken);
                self.builder.private_get(object, token, layout, field);
            }
            PrivateHolder::ClassObject => self.emit_class_object_test(class, object, error),
        }
    }

    fn get_defined_static_value(
        &mut self,
        stored: StoredValue,
        object: ValueId,
        error: RuntimeErrorKind,
    ) -> ValueId {
        self.emit_class_object_test(stored.class, object, error);
        let slot = ClassSlot::StaticField(stored.member);
        let value = self.get_class_slot(stored.class, slot);
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder
            .set_frequency(split.taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.taken);
        self.emit_throw_runtime_error(error, None);
        self.builder.switch_to(split.not_taken);
        split.not_taken_value
    }

    pub(in crate::lower) fn emit_stored_read(
        &mut self,
        stored: StoredValue,
        object: ValueId,
    ) -> ValueId {
        match stored.holder {
            PrivateHolder::Instance { layout, field } => {
                let token = self.get_class_slot(stored.class, ClassSlot::ClassToken);
                self.builder.private_get(object, token, layout, field)
            }
            PrivateHolder::ClassObject => {
                self.get_defined_static_value(stored, object, RuntimeErrorKind::InvalidPrivateRead)
            }
        }
    }

    pub(in crate::lower) fn emit_stored_write(
        &mut self,
        stored: StoredValue,
        object: ValueId,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        match stored.holder {
            PrivateHolder::Instance { layout, field } => {
                let position = self.file.field_position(layout, field);
                let value = convert::convert(self, value, position, source);
                let token = self.get_class_slot(stored.class, ClassSlot::ClassToken);
                self.builder
                    .private_set(object, token, layout, field, value);
            }
            PrivateHolder::ClassObject => {
                let error = RuntimeErrorKind::InvalidPrivateWrite;
                self.get_defined_static_value(stored, object, error);
                let position = class::static_field_position(self.file, stored.class, stored.member);
                let value = convert::convert(self, value, position, source);
                let slot = ClassSlot::StaticField(stored.member);
                self.set_class_slot(stored.class, slot, value);
            }
        }
    }

    pub(in crate::lower) fn emit_stored_definition(
        &mut self,
        stored: StoredValue,
        object: ValueId,
        value: ValueId,
    ) {
        match stored.holder {
            PrivateHolder::Instance { layout, field } => {
                let token = self.get_class_slot(stored.class, ClassSlot::ClassToken);
                self.builder
                    .private_define(object, token, layout, field, value);
            }
            PrivateHolder::ClassObject => {
                let slot = ClassSlot::StaticField(stored.member);
                self.set_class_slot(stored.class, slot, value);
            }
        }
    }

    pub(in crate::lower) fn emit_name_get(
        &mut self,
        object: ValueId,
        name: PrivateNameId,
    ) -> ValueId {
        let binding = self.file.resolve_private_name(name);
        let PrivateBinding { class, holder, .. } = binding;
        match binding.members {
            PrivateMembers::AutoAccessor(member) if binding.is_decorated => {
                self.emit_admission(class, holder, object, RuntimeErrorKind::InvalidPrivateRead);
                let getter = self.get_decorated_accessor_function(class, member, known::get);
                call::emit_call(self, getter, Some(object), &[])
            }
            PrivateMembers::Field(member) | PrivateMembers::AutoAccessor(member) => {
                self.emit_stored_read(StoredValue::of_name(binding, member), object)
            }
            PrivateMembers::Method(member) => {
                self.emit_admission(class, holder, object, RuntimeErrorKind::InvalidPrivateBrand);
                self.get_class_slot(class, ClassSlot::PrivateMethod(member))
            }
            PrivateMembers::Accessor { getter, .. } => {
                self.emit_admission(class, holder, object, RuntimeErrorKind::InvalidPrivateBrand);
                let Some(getter) = getter else {
                    return self.emit_error(RuntimeErrorKind::PrivateAccessorWithoutGetter);
                };
                let getter = self.get_class_slot(class, ClassSlot::PrivateMethod(getter));
                call::emit_call(self, getter, Some(object), &[])
            }
        }
    }

    pub(in crate::lower) fn emit_name_set(
        &mut self,
        object: ValueId,
        name: PrivateNameId,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        let binding = self.file.resolve_private_name(name);
        let PrivateBinding { class, holder, .. } = binding;
        match binding.members {
            PrivateMembers::AutoAccessor(member) if binding.is_decorated => {
                self.emit_admission(class, holder, object, RuntimeErrorKind::InvalidPrivateWrite);
                let setter = self.get_decorated_accessor_function(class, member, known::set);
                call::emit_call(self, setter, Some(object), &[value]);
            }
            PrivateMembers::Field(member) | PrivateMembers::AutoAccessor(member) => {
                let stored = StoredValue::of_name(binding, member);
                self.emit_stored_write(stored, object, value, source);
            }
            PrivateMembers::Method(_) => {
                self.emit_admission(class, holder, object, RuntimeErrorKind::InvalidPrivateBrand);
                self.emit_error(RuntimeErrorKind::PrivateMethodWrite);
            }
            PrivateMembers::Accessor { setter, .. } => {
                self.emit_admission(class, holder, object, RuntimeErrorKind::InvalidPrivateBrand);
                let Some(setter) = setter else {
                    self.emit_error(RuntimeErrorKind::PrivateAccessorWithoutSetter);
                    return;
                };
                let setter = self.get_class_slot(class, ClassSlot::PrivateMethod(setter));
                call::emit_call(self, setter, Some(object), &[value]);
            }
        }
    }

    pub(in crate::lower) fn emit_name_test(
        &mut self,
        object: ValueId,
        name: PrivateNameId,
    ) -> ValueId {
        let binding = self.file.resolve_private_name(name);
        match binding.holder {
            PrivateHolder::Instance { layout, field } => {
                let token = self.get_class_slot(binding.class, ClassSlot::ClassToken);
                self.builder.private_has(object, token, layout, field)
            }
            PrivateHolder::ClassObject => match binding.members {
                PrivateMembers::Field(member) => {
                    self.emit_static_field_test(name, binding.class, member, object)
                }
                PrivateMembers::AutoAccessor(member) if !binding.is_decorated => {
                    self.emit_static_field_test(name, binding.class, member, object)
                }
                _ => {
                    let error = RuntimeErrorKind::PrivateStaticTestOfNonObject;
                    let checked = self.builder.require_object(object, error);
                    self.emit_class_object_comparison(binding.class, checked)
                }
            },
        }
    }

    // Methods and accessors are on the class object before any static field is defined.
    fn emit_static_field_test(
        &mut self,
        name: PrivateNameId,
        class: ClassId,
        member: MemberId,
        object: ValueId,
    ) -> ValueId {
        // `in` throws the same error for every key when its right operand is not an object.
        let split = self.split_on_type(object, TypeTable::OBJECT);
        self.builder
            .set_frequency(split.not_taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.not_taken);
        let name = self.file.bound.private_name(name).name;
        let key = self.file.name_key(name);
        self.builder.prop_has(split.not_taken_value, key);
        self.builder.unreachable();
        self.builder.switch_to(split.taken);
        let is_class_object = self.emit_class_object_comparison(class, split.taken_value);
        let result = self.builder.create_variable(None);
        let admitted = self.create_block();
        let join = self.create_block();
        self.builder.write_variable(result, is_class_object);
        self.builder
            .branch(is_class_object, Edge::to(admitted), Edge::to(join));
        self.continue_in(admitted);
        let value = self.get_class_slot(class, ClassSlot::StaticField(member));
        let is_absent = self.builder.type_test(value, TypeTable::ABSENT);
        let is_defined = self.builder.logical_not(is_absent);
        self.builder.write_variable(result, is_defined);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    pub(crate) fn lower_private_in(&mut self, expression: ExprId) -> ValueId {
        let hir = self.file.hir;
        let ExprKind::Binary { left, right, .. } = hir[expression].kind else {
            debug_assert!(false, "a private `in` test is a Binary expression");
            return self.builder.undefined();
        };
        let object = self.lower_expression(right);
        self.set_position(hir[expression].pos);
        match self.file.bound.private_name_of_reference(left) {
            Some(name) => self.emit_name_test(object, name),
            None => self.emit_error(RuntimeErrorKind::UnresolvableReference),
        }
    }

    pub(in crate::lower) fn emit_brand_definition(&mut self, class: ClassId, object: ValueId) {
        let layout = self.file.own_class_layout(class);
        let brand = layouts::own_fields(self.file, layout).brand();
        let brand = brand.expect("a class with instance private state has a brand");
        let token = self.get_class_slot(class, ClassSlot::ClassToken);
        // A base constructor that returns an object lets a derived class initialize that object twice.
        let mut names = self.file.bound.private_names_of_class(class);
        let fails_at_first_private_field = class::is_derived_class(self.file.hir, class)
            && !names.any(|(_, name)| {
                !name.is_static && !matches!(name.members, PrivateMembers::Field(_))
            });
        if !fails_at_first_private_field {
            self.builder
                .private_define(object, token, layout, brand, token);
            return;
        }
        let has_brand = self.builder.private_has(object, token, layout, brand);
        let define = self.create_block();
        let join = self.create_block();
        self.builder
            .branch(has_brand, Edge::to(join), Edge::to(define));
        self.continue_in(define);
        self.builder
            .private_define(object, token, layout, brand, token);
        self.jump(join);
        self.continue_in(join);
    }

    pub(in crate::lower) fn emit_field_definition(
        &mut self,
        object: ValueId,
        name: PrivateNameId,
        value: ValueId,
    ) {
        let binding = self.file.resolve_private_name(name);
        match binding.members {
            PrivateMembers::Field(member) | PrivateMembers::AutoAccessor(member) => {
                let stored = StoredValue::of_name(binding, member);
                self.emit_stored_definition(stored, object, value);
            }
            PrivateMembers::Method(_) | PrivateMembers::Accessor { .. } => {
                debug_assert!(false, "only a field or an accessor field stores a value");
            }
        }
    }
}
