use bun_sema::atom::{Atom, known};
use bun_sema::bind::{PrivateMembers, PrivateNameId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, ExprId, ExprKind, MemberId};
use smallvec::SmallVec;

use super::{AccessorStorage, PrivateBinding, PrivateHolder};
use crate::ir::generated::{BlockFrequency, RuntimeErrorKind};
use crate::ir::{ClassSlot, Edge, TypeTable, ValueId};
use crate::lower::call::{self, Arguments, CallSite};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, class, convert, layouts};

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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn get_token(&mut self, class: ClassId) -> ValueId {
        self.get_class_slot(class, ClassSlot::ClassToken)
    }

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

    fn emit_error(&mut self, error: RuntimeErrorKind) -> ValueId {
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
                let token = self.get_token(class);
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

    fn emit_stored_read(&mut self, stored: StoredValue, object: ValueId) -> ValueId {
        match stored.holder {
            PrivateHolder::Instance { layout, field } => {
                let token = self.get_token(stored.class);
                self.builder.private_get(object, token, layout, field)
            }
            PrivateHolder::ClassObject => {
                let error = RuntimeErrorKind::InvalidPrivateRead;
                self.get_defined_static_value(stored, object, error)
            }
        }
    }

    fn emit_stored_write(
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
                let token = self.get_token(stored.class);
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

    fn emit_stored_definition(&mut self, stored: StoredValue, object: ValueId, value: ValueId) {
        match stored.holder {
            PrivateHolder::Instance { layout, field } => {
                let token = self.get_token(stored.class);
                self.builder
                    .private_define(object, token, layout, field, value);
            }
            PrivateHolder::ClassObject => {
                let slot = ClassSlot::StaticField(stored.member);
                self.set_class_slot(stored.class, slot, value);
            }
        }
    }

    fn emit_function_call(
        &mut self,
        function: ValueId,
        object: ValueId,
        arguments: &[ValueId],
    ) -> ValueId {
        let arguments = Arguments::Values(SmallVec::from_slice(arguments));
        call::emit_call(self, function, Some(object), arguments, CallSite::default())
    }

    pub(in crate::lower) fn emit_name_get(
        &mut self,
        object: ValueId,
        name: PrivateNameId,
    ) -> ValueId {
        let binding = self.file.resolve_private_name(name);
        let PrivateBinding { class, holder, .. } = binding;
        match binding.members {
            PrivateMembers::Field(member) => {
                self.emit_stored_read(StoredValue::of_name(binding, member), object)
            }
            PrivateMembers::AutoAccessor(member) if !binding.is_decorated => {
                self.emit_stored_read(StoredValue::of_name(binding, member), object)
            }
            PrivateMembers::AutoAccessor(member) => {
                let error = RuntimeErrorKind::InvalidPrivateRead;
                self.emit_admission(class, holder, object, error);
                let getter = self.get_decorated_accessor_function(class, member, known::get);
                self.emit_function_call(getter, object, &[])
            }
            PrivateMembers::Method(member) => {
                let error = RuntimeErrorKind::InvalidPrivateBrand;
                self.emit_admission(class, holder, object, error);
                self.get_class_slot(class, ClassSlot::PrivateMethod(member))
            }
            PrivateMembers::Accessor { getter, .. } => {
                let error = RuntimeErrorKind::InvalidPrivateBrand;
                self.emit_admission(class, holder, object, error);
                let Some(getter) = getter else {
                    return self.emit_error(RuntimeErrorKind::PrivateAccessorWithoutGetter);
                };
                let getter = self.get_class_slot(class, ClassSlot::PrivateMethod(getter));
                self.emit_function_call(getter, object, &[])
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
            PrivateMembers::Field(member) => {
                let stored = StoredValue::of_name(binding, member);
                self.emit_stored_write(stored, object, value, source);
            }
            PrivateMembers::AutoAccessor(member) if !binding.is_decorated => {
                let stored = StoredValue::of_name(binding, member);
                self.emit_stored_write(stored, object, value, source);
            }
            PrivateMembers::AutoAccessor(member) => {
                let error = RuntimeErrorKind::InvalidPrivateWrite;
                self.emit_admission(class, holder, object, error);
                let setter = self.get_decorated_accessor_function(class, member, known::set);
                self.emit_function_call(setter, object, &[value]);
            }
            PrivateMembers::Method(_) => {
                let error = RuntimeErrorKind::InvalidPrivateBrand;
                self.emit_admission(class, holder, object, error);
                self.emit_error(RuntimeErrorKind::PrivateMethodWrite);
            }
            PrivateMembers::Accessor { setter, .. } => {
                let error = RuntimeErrorKind::InvalidPrivateBrand;
                self.emit_admission(class, holder, object, error);
                let Some(setter) = setter else {
                    self.emit_error(RuntimeErrorKind::PrivateAccessorWithoutSetter);
                    return;
                };
                let setter = self.get_class_slot(class, ClassSlot::PrivateMethod(setter));
                self.emit_function_call(setter, object, &[value]);
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
                let token = self.get_token(binding.class);
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

    // `in` throws the same error for every key when its right operand is not an object.
    fn emit_in_operand_check(&mut self, object: ValueId, name: PrivateNameId) -> ValueId {
        let split = self.split_on_type(object, TypeTable::OBJECT);
        self.builder
            .set_frequency(split.not_taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.not_taken);
        let name = self.file.bound.private_name(name).name;
        let key = self.file.name_key(name);
        self.builder.prop_has(split.not_taken_value, key);
        self.builder.unreachable();
        self.builder.switch_to(split.taken);
        split.taken_value
    }

    // Methods and accessors are on the class object before any static field is defined.
    fn emit_static_field_test(
        &mut self,
        name: PrivateNameId,
        class: ClassId,
        member: MemberId,
        object: ValueId,
    ) -> ValueId {
        let checked = self.emit_in_operand_check(object, name);
        let is_class_object = self.emit_class_object_comparison(class, checked);
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
            None => self.emit_undeclared_name_error(),
        }
    }

    pub(super) fn emit_undeclared_name_error(&mut self) -> ValueId {
        self.emit_error(RuntimeErrorKind::UnresolvableReference)
    }

    pub(in crate::lower) fn emit_brand_definition(&mut self, class: ClassId, object: ValueId) {
        let reference = ClassRef {
            file: self.file.file,
            class,
        };
        let layout = self.file.class_layout(reference);
        let brand = layouts::own_fields(self.file, layout).brand();
        let brand = brand.expect("a class with instance private state has a brand");
        let token = self.get_token(class);
        if !self.file.fails_at_first_private_field(class) {
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

    pub(in crate::lower) fn emit_storage_definition(
        &mut self,
        object: ValueId,
        member: MemberId,
        value: ValueId,
    ) {
        let stored = StoredValue::of_accessor(self.file.resolve_accessor_storage(member));
        self.emit_stored_definition(stored, object, value);
    }

    pub(in crate::lower) fn emit_storage_get(
        &mut self,
        object: ValueId,
        member: MemberId,
    ) -> ValueId {
        let stored = StoredValue::of_accessor(self.file.resolve_accessor_storage(member));
        self.emit_stored_read(stored, object)
    }

    pub(in crate::lower) fn emit_storage_set(
        &mut self,
        object: ValueId,
        member: MemberId,
        value: ValueId,
    ) {
        let stored = StoredValue::of_accessor(self.file.resolve_accessor_storage(member));
        self.emit_stored_write(stored, object, value, None);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    // A base constructor that returns an object lets a derived class initialize that object twice.
    fn fails_at_first_private_field(&self, class: ClassId) -> bool {
        let mut names = self.bound.private_names_of_class(class);
        class::is_derived_class(self.hir, class)
            && !names.any(|(_, name)| {
                !name.is_static && !matches!(name.members, PrivateMembers::Field(_))
            })
    }
}
