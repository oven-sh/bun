//! New cells.

use core::mem::offset_of;

use bun_engine_asm::Argument;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{Register, op};
use bun_engine_vm::code::metadata::{NewObject, WeakCell};
use bun_engine_vm::heap::{LARGE_CUTOFF, optimal_size};
use bun_engine_vm::{
    CellType, CodeBlock, Environment, FunctionExecutable, FunctionRareData, GlobalObject,
    InlineWatchpointSet, JsFunction, JsObject, RealmSlot, ScopeTemplate, Shape, Vm, quick_arrays,
};
use smallvec::SmallVec;

use super::{Compiler, metadata, slot};
use crate::emit::{Emit, UNDEFINED, WORD, at, cell_allocator, storage};
use crate::registers::*;

const FIRST_SLOT: i32 = size_of::<JsObject>() as i32;
const MOST_UNROLLED: u32 = 12;

impl Compiler<'_> {
    /// Clears the slots of the object in `T0` from `first` up to the number in `capacity`, which it overwrites.
    fn clear_slots(&mut self, first: u32, capacity: Gpr) {
        let done = self.m.new_label();
        self.m.branch32(Cond::BelowEq, capacity, first, done);
        let next = self.m.here();
        let last = Address::indexed(T0, capacity, Scale::Eight, FIRST_SLOT - WORD);
        self.m.store64(last, 0);
        self.m.sub32(capacity, capacity, 1);
        self.m.branch32(Cond::Above, capacity, first, next);
        self.m.bind(done);
    }

    /// With the allocator in `T1` and the shape in `T2`.
    fn allocate_object(&mut self) {
        let slow = self.slow();
        self.m.branch_if_zero64(T1, slow);
        self.m.bump_allocate(T0, at(T1, 0), None, T3, slow);
        self.m.store_header(T0, T2, T3);
        self.m.store64(storage(T0), 0);
    }

    pub(super) fn new_object(&mut self, dst: Register, values: Option<(Register, u32)>, word: u32) {
        let field = |offset: usize| metadata(word, offset);
        let capacity = field(offset_of!(NewObject, inline_capacity));
        let count = values.map_or(0, |(_, count)| count);
        let unrolled = (self.profiles.inline_capacity(word))
            .filter(|&it| it.saturating_sub(count) <= MOST_UNROLLED);
        if let Some(expected) = unrolled {
            let slow = self.slow();
            self.m.branch32(Cond::Ne, capacity, expected, slow);
        }
        self.m.load64(T1, field(offset_of!(NewObject, allocator)));
        self.m.load32(T2, field(offset_of!(NewObject, shape)));
        self.m.decode_shape(T2, T2);
        self.allocate_object();
        if let Some((first, count)) = values {
            for index in 0..count {
                let target = Address::new(T0, FIRST_SLOT + index as i32 * WORD);
                self.m.transfer64(target, slot(first.nth(index)));
            }
        }
        match unrolled {
            Some(capacity) => {
                for index in count..capacity {
                    (self.m).store64(Address::new(T0, FIRST_SLOT + index as i32 * WORD), 0);
                }
            }
            None => {
                self.m.load32(T1, capacity);
                self.clear_slots(count, T1);
            }
        }
        self.m.publish();
        self.store_result(dst);
    }

    pub(super) fn create_this(&mut self, op: op::CreateThis) {
        let (slow, known) = (self.slow(), self.m.new_label());
        self.load(T0, op.new_target);
        self.m.load64(T1, metadata(op.metadata, 0));
        self.m.branch64(Cond::Eq, T0, T1, known);
        self.m.branch64(Cond::Ne, T1, WeakCell::MANY, slow);
        self.m.bind(known);
        self.m.branch_if_not_type(T0, CellType::Function, slow);
        self.m.load64(T0, at(T0, JsFunction::OFFSET_OF_EXECUTABLE));
        (self.m).branch_if_not_type(T0, CellType::FunctionRareData, slow);
        (self.m).load64(T1, at(T0, FunctionRareData::OFFSET_OF_OBJECT_ALLOCATOR));
        (self.m).load64(T2, at(T0, FunctionRareData::OFFSET_OF_OBJECT_SHAPE));
        self.allocate_object();
        self.m.load8(T1, at(T2, Shape::OFFSET_OF_INLINE_CAPACITY));
        self.clear_slots(0, T1);
        self.m.publish();
        self.store_result(op.dst);
    }

    /// Loads what is made on first use, once its first instance is no longer the only one.
    fn load_template(&mut self, dst: Gpr, index: usize, watchpoints: usize) {
        let slow = self.slow();
        self.m.load64(dst, self.linked(index));
        self.m.branch_if_zero64(dst, slow);
        let invalidated = InlineWatchpointSet::THIN_INVALIDATED;
        (self.m).branch64(Cond::Ne, at(dst, watchpoints), invalidated, slow);
    }

    /// Of a size that is known, with the shape that the realm has in `shape`. Overwrites `T2` and `T3`.
    fn allocate_cell(&mut self, size: usize, shape: RealmSlot) {
        let slow = self.slow();
        self.m.load_global(T2);
        self.m
            .load64(T2, at(T2, GlobalObject::offset_of_slot(shape)));
        self.m.branch_if_zero64(T2, slow);
        (self.m).bump_allocate(T0, cell_allocator(size), Some(optimal_size(size)), T3, slow);
        self.m.store_header(T0, T2, T3);
    }

    pub(super) fn create_scope(&mut self, op: op::CreateScope) {
        let scope = &self.code.scopes[op.scope.index()];
        let (count, undefined) = (scope.slot_count(), scope.undefined_slots());
        let size = Environment::allocation_size(count);
        if count > 2 * MOST_UNROLLED || size > LARGE_CUTOFF {
            return self.call_slow_path();
        }
        let index = self.code.constants.len() + self.code.functions.len() + op.scope.index();
        self.load(T4, op.parent);
        self.load_template(T1, index, ScopeTemplate::OFFSET_OF_SINGLETON_WATCHPOINTS);
        self.allocate_cell(size, RealmSlot::environment_shape);
        (self.m).store_pair64(at(T0, Environment::OFFSET_OF_PARENT), T4, T1);
        for index in 0..count {
            let word = if index < undefined { UNDEFINED } else { 0 };
            (self.m).store64(at(T0, Environment::allocation_size(index)), word);
        }
        self.m.publish();
        self.store_result(op.dst);
    }

    /// One of `quick_arrays`, whose arguments after the realm these are.
    fn try_quickly(&mut self, dst: Register, function: *const (), arguments: &[Argument]) {
        let realm = Argument::Load64(at(CODE_BLOCK, CodeBlock::OFFSET_OF_GLOBAL));
        let all: SmallVec<[Argument; 5]> = [realm].iter().chain(arguments).copied().collect();
        self.m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        self.m.move_arguments(&all);
        self.m.call_address(function as usize);
        let slow = self.slow();
        self.m.branch_if_zero64(T0, slow);
        self.store_result(dst);
    }

    pub(super) fn new_array(&mut self, op: op::NewArray) {
        let profile = Argument::AddressOf(metadata(op.metadata, 0));
        let lowest = Argument::AddressOf(slot(op.first).plus((1 - op.count as i32) * WORD));
        let arguments = [profile, lowest, op.count.into(), (op.shape as u32).into()];
        self.try_quickly(op.dst, quick_arrays::try_new_array as _, &arguments);
    }

    pub(super) fn new_array_from_constant(&mut self, op: op::NewArrayFromConstant) {
        let profile = Argument::AddressOf(metadata(op.metadata, 0));
        let elements = Argument::Load64(self.linked(op.elements.0 as usize));
        let function = quick_arrays::try_new_array_from_constant;
        self.try_quickly(op.dst, function as _, &[profile, elements]);
    }

    pub(super) fn new_array_with_size(&mut self, op: op::NewArrayWithSize) {
        self.load(T2, op.length);
        let profile = Argument::AddressOf(metadata(op.metadata, 0));
        let function = quick_arrays::try_new_array_with_size;
        self.try_quickly(op.dst, function as _, &[profile, T2.into()]);
    }

    pub(super) fn create_rest(&mut self, op: op::CreateRest) {
        let arguments = [FP.into(), op.skip.into()];
        self.try_quickly(op.dst, quick_arrays::try_create_rest as _, &arguments);
    }

    pub(super) fn ensure_rest(&mut self, op: op::EnsureRest) {
        let (exists, dst, skip) = (self.m.new_label(), op.rest, op.skip);
        self.load(T0, dst);
        self.m.branch_if_not_empty(T0, exists);
        self.create_rest(op::CreateRest { dst, skip });
        self.m.bind(exists);
    }

    pub(super) fn create_direct_arguments(&mut self, op: op::CreateDirectArguments) {
        let arguments = [FP.into(), (self.body.parameters() - 1).into()];
        let function = quick_arrays::try_create_direct_arguments;
        self.try_quickly(op.dst, function as _, &arguments);
    }

    pub(super) fn new_function(&mut self, op: op::NewFunction) {
        let shape = FunctionExecutable::shape_slot_for(&self.code.functions[op.function.index()]);
        let index = self.code.constants.len() + op.function.index();
        self.load(T4, op.scope);
        (self).load_template(
            T1,
            index,
            FunctionExecutable::OFFSET_OF_SINGLETON_WATCHPOINTS,
        );
        self.allocate_cell(size_of::<JsFunction>(), shape);
        self.m.store64(storage(T0), 0);
        (self.m).store_pair64(at(T0, JsFunction::OFFSET_OF_SCOPE), T4, T1);
        self.m.publish();
        self.store_result(op.dst);
    }
}

const _: () = {
    assert!(Environment::OFFSET_OF_TEMPLATE == Environment::OFFSET_OF_PARENT + WORD as usize);
    assert!(JsFunction::OFFSET_OF_EXECUTABLE == JsFunction::OFFSET_OF_SCOPE + WORD as usize);
    assert!(size_of::<JsFunction>() == JsFunction::OFFSET_OF_EXECUTABLE + WORD as usize);
};
