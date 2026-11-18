//! `for`-`in` and iterators.

use core::mem::offset_of;

use bun_engine_asm::Argument;
use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{CloseMode, Instruction, Jump, Register, op};
use bun_engine_vm::code::metadata::{ForIn, ForInGet, IteratorNext};
use bun_engine_vm::{
    self as vm, ArrayModes, CellType, EnumerationMode, GlobalObject, ImmutableArray, IterationMode,
    IteratorRecord, JsObject, NumberStrings, PropertyNameEnumerator, RealmSlot, RealmWatchpoint,
    Shape, ShapeFlags, ShapeRareData, Step, Value, Vm, registers,
};

use super::{Cold, Compiler, metadata, slot};
use crate::emit::{Emit, FALSE, TRUE, UNDEFINED, WORD, at, shape_id, storage};
use crate::ic::abi::{BASE, KEY, VALUE};
use crate::ic::{Absent, Elements, has_element, load_element};
use crate::registers::*;

const INDEXED: i32 = EnumerationMode::Indexed as i32;
const OWN_SHAPE: i32 = EnumerationMode::OwnShape as i32;
const ENUMERATOR: Gpr = T2;
const INDEX: Gpr = T3;

const fn enumerator(field: usize) -> Address {
    at(ENUMERATOR, field)
}

const fn registers_at(state: Register) -> Argument {
    Argument::AddressOf(slot(state.nth(2)))
}

const fn entry_at(word: u32) -> Argument {
    Argument::AddressOf(metadata(word, 0))
}

macro_rules! address {
    ($function:path) => {
        $function as *const () as usize
    };
}

/// The operands of the instruction that cold code is for.
macro_rules! operands {
    ($c:ident, $Op:ident) => {
        match $c.instruction($c.offset) {
            Instruction::$Op(op) => op,
            _ => unreachable!(),
        }
    };
}

fn is_likely_own_shape(modes: u32) -> bool {
    modes == 0 || modes & (OWN_SHAPE as u32 | vm::ForIn::SHAPE_MISMATCH) == OWN_SHAPE as u32
}

impl Compiler<'_> {
    fn branch_unless_seen(&mut self, modes: Address, flag: u32, target: Label) {
        if self.records {
            self.m.branch_test32(TestCond::Zero, modes, flag, target);
        }
    }

    /// After a function that returns a `Step`. Goes on with the value.
    fn take_step(&mut self, done: Jump) {
        let done = self.target(done);
        self.m.branch64(Cond::Eq, T0, Step::DONE.bits(), done);
        self.throw_if_zero();
    }

    pub(super) fn for_in_open(&mut self, op: op::ForInOpen) {
        let other = self.cold_operation(|c, cold| {
            let op = operands!(c, ForInOpen);
            let arguments = [registers_at(op.state), BASE.into()];
            c.call_operation(address!(vm::for_in_open), &arguments);
            let empty = c.target(op.empty);
            c.m.branch32(Cond::Eq, T0, FALSE, empty);
            c.m.jump(cold.resume);
        });
        self.load(BASE, op.base);
        self.m.branch_if_not_cell(BASE, other);
        self.m.load32(T0, shape_id(BASE));
        self.m.decode_shape(T0, T0);
        self.m.load64(T0, at(T0, Shape::OFFSET_OF_RARE_DATA));
        self.m.branch_if_zero64(T0, other);
        (self.m).load64(T3, at(VM, Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH));
        let epoch = at(T0, ShapeRareData::OFFSET_OF_ENUMERATOR_EPOCH);
        self.m.branch64(Cond::Ne, T3, epoch, other);
        (self.m).load64(ENUMERATOR, at(T0, ShapeRareData::OFFSET_OF_ENUMERATOR));
        self.store(op.state, ENUMERATOR);
        self.store(op.state.nth(1), Value::int32(OWN_SHAPE).to_bits());
        self.store(op.state.nth(2), Value::int32(-1).to_bits());
        let count = enumerator(PropertyNameEnumerator::OFFSET_OF_NAME_COUNT);
        let empty = self.target(op.empty);
        self.m.branch_if_zero32(count, empty);
    }

    /// Goes on if the base has the shape of the enumerator, with the position in `INDEX`.
    fn check_subject(&mut self, state: Register, step: i32, otherwise: Label) {
        self.m.load64(ENUMERATOR, slot(state));
        self.m.load32(INDEX, slot(state.nth(2)));
        if step != 0 {
            self.m.add32(INDEX, INDEX, step);
        }
        self.m.branch_if_not_cell(BASE, otherwise);
        self.m.load32(T0, shape_id(BASE));
        let shape = enumerator(PropertyNameEnumerator::OFFSET_OF_SUBJECT_SHAPE);
        self.m.branch32(Cond::Ne, T0, shape, otherwise);
    }

    /// Goes on if it also has a slot numbered `INDEX`, and the profile knows of the mode.
    fn check_own_slot(&mut self, state: Register, step: i32, modes: Address, otherwise: Label) {
        self.check_subject(state, step, otherwise);
        (self.m).branch32(Cond::Ne, slot(state.nth(1)), OWN_SHAPE, otherwise);
        let count = enumerator(PropertyNameEnumerator::OFFSET_OF_OWN_SHAPE_COUNT);
        self.m.branch32(Cond::AboveEq, INDEX, count, otherwise);
        self.branch_unless_seen(modes, OWN_SHAPE as u32, otherwise);
    }

    /// The address of that slot, in `T4`.
    fn find_own_slot(&mut self) {
        let (outside, found) = (self.m.new_label(), self.m.new_label());
        let capacity = enumerator(PropertyNameEnumerator::OFFSET_OF_INLINE_CAPACITY);
        self.m.load32(T4, capacity);
        self.m.branch32(Cond::AboveEq, INDEX, T4, outside);
        let first = size_of::<JsObject>() as i32;
        (self.m).compute_address(T4, Address::indexed(BASE, INDEX, Scale::Eight, first));
        self.m.jump(found);
        self.m.bind(outside);
        self.m.sub64(T4, T4, INDEX);
        self.m.load64(T5, storage(BASE));
        (self.m).compute_address(T4, Address::indexed(T5, T4, Scale::Eight, -2 * WORD));
        self.m.bind(found);
    }

    fn call_for_in_next(&mut self) {
        let op = operands!(self, ForInNext);
        let arguments = [registers_at(op.state), entry_at(op.metadata), BASE.into()];
        self.call_unchecked_operation(address!(vm::for_in_next), &arguments);
        self.take_step(op.done);
    }

    pub(super) fn for_in_next(&mut self, op: op::ForInNext) {
        let (seen, array) = self.profiles.for_in(op.metadata);
        let (modes, found) = (
            metadata(op.metadata, offset_of!(ForIn, modes)),
            self.m.new_label(),
        );
        self.load(BASE, op.base);
        if is_likely_own_shape(seen) {
            let other = self.cold_alone(found, |c, cold| {
                let op = operands!(c, ForInNext);
                let (call, done) = (c.m.new_label(), c.target(op.done));
                (c.m).branch32(Cond::Eq, slot(op.state.nth(1)), INDEXED, call);
                let count = enumerator(PropertyNameEnumerator::OFFSET_OF_NAME_COUNT);
                c.m.branch32(Cond::AboveEq, INDEX, count, done);
                c.m.bind(call);
                c.call_for_in_next();
                c.m.jump(cold.resume);
            });
            self.check_own_slot(op.state, 1, modes, other);
            self.m.store32(slot(op.state.nth(2)), INDEX);
            (self.m).load64(T0, enumerator(PropertyNameEnumerator::OFFSET_OF_NAMES));
            let first = ImmutableArray::OFFSET_OF_ELEMENTS as i32;
            (self.m).load64(T0, Address::indexed(T0, INDEX, Scale::Eight, first));
        } else if let (INDEXED, Some(kind)) = (seen as i32, Elements::likely(&self.m, array)) {
            let other = self.cold_alone(found, |c, cold| {
                c.call_for_in_next();
                c.m.jump(cold.resume);
            });
            self.m.load64(ENUMERATOR, slot(op.state));
            self.m.load32(INDEX, slot(op.state.nth(2)));
            self.m.add32(INDEX, INDEX, 1);
            (self.m).branch32(Cond::Ne, slot(op.state.nth(1)), INDEXED, other);
            let length = enumerator(PropertyNameEnumerator::OFFSET_OF_INDEXED_LENGTH);
            self.m.branch32(Cond::AboveEq, INDEX, length, other);
            self.branch_unless_seen(modes, INDEXED as u32, other);
            has_element(&mut self.m, kind, other, Absent::both(other));
            (self.m).branch32(Cond::AboveEq, INDEX, NumberStrings::SMALL_COUNT, other);
            let strings = Vm::OFFSET_OF_NUMBER_STRINGS + NumberStrings::OFFSET_OF_SMALL;
            (self.m).load64(
                T0,
                Address::indexed(VM, INDEX, Scale::Eight, strings as i32),
            );
            self.m.branch_if_zero64(T0, other);
            self.record_shape(metadata(op.metadata, offset_of!(ForIn, access.array)));
            self.m.store32(slot(op.state.nth(2)), INDEX);
        } else {
            self.call_for_in_next();
        }
        self.m.bind(found);
        self.store_result(op.name);
    }

    /// For an access like any other. Leaves the base and the value alone.
    fn load_key(&mut self, name: Register, state: Register, modes: Address) {
        if self.records {
            let [mismatch, record] = core::array::from_fn(|_| self.m.new_label());
            self.m.load32(T4, slot(state.nth(1)));
            self.m.branch32(Cond::Ne, T4, OWN_SHAPE, record);
            self.check_subject(state, 0, mismatch);
            let count = enumerator(PropertyNameEnumerator::OFFSET_OF_OWN_SHAPE_COUNT);
            self.m.branch32(Cond::Below, INDEX, count, record);
            self.m.bind(mismatch);
            self.m.or32(T4, T4, vm::ForIn::SHAPE_MISMATCH);
            self.m.bind(record);
            self.m.or_to_memory(Size::S32, modes, T4);
        }
        self.m.load32(T0, slot(state.nth(1)));
        self.m.load64(KEY, slot(name));
        self.m.load32(T3, slot(state.nth(2)));
        self.m.box_int32(T3, T3);
        self.m.select32(Cond::Eq, KEY, T0, INDEXED, T3, KEY);
    }

    pub(super) fn for_in_get(&mut self, op: op::ForInGet) {
        const MODES: usize = offset_of!(ForInGet, for_in.modes);
        let ((seen, array), found) = (self.profiles.for_in_get(op.metadata), self.m.new_label());
        let modes = metadata(op.metadata, MODES);
        self.load(BASE, op.base);
        if is_likely_own_shape(seen) {
            let other = self.cold_alone(found, |c, cold| {
                let op = operands!(c, ForInGet);
                c.load_key(op.name, op.state, metadata(op.metadata, MODES));
                c.both_steps(cold);
            });
            self.check_own_slot(op.state, 0, modes, other);
            self.find_own_slot();
            self.m.load64(T0, at(T4, 0));
            self.m.branch_if_empty(T0, other);
        } else {
            self.load_key(op.name, op.state, modes);
            let profile = metadata(op.metadata, offset_of!(ForInGet, for_in.access.array));
            self.read_by_value(load_element, (array, profile), false, found);
        }
        self.m.bind(found);
        self.store_profiled_result(op.dst, op.metadata);
    }

    pub(super) fn for_in_put(&mut self, op: op::ForInPut) {
        let (seen, array) = self.profiles.for_in(op.metadata);
        let modes = metadata(op.metadata, offset_of!(ForIn, modes));
        self.load(VALUE, op.value);
        self.load(BASE, op.base);
        if !is_likely_own_shape(seen) {
            self.load_key(op.name, op.state, modes);
            let profile = metadata(op.metadata, offset_of!(ForIn, access.array));
            return self.write_by_value((array, profile), false, op.value);
        }
        let other = self.cold_operation(|c, cold| {
            let op = operands!(c, ForInPut);
            let modes = metadata(op.metadata, offset_of!(ForIn, modes));
            c.load_key(op.name, op.state, modes);
            c.both_steps(cold);
        });
        self.check_own_slot(op.state, 0, modes, other);
        let is_writable = enumerator(PropertyNameEnumerator::OFFSET_OF_IS_WRITABLE);
        self.m.branch8(Cond::Eq, is_writable, 0, other);
        self.m.decode_shape(T0, T0);
        let (flags, watched) = (
            at(T0, Shape::OFFSET_OF_FLAGS),
            ShapeFlags::IS_WATCHING_REPLACEMENT.bits(),
        );
        (self.m).branch_test32(TestCond::NonZero, flags, watched, other);
        self.find_own_slot();
        self.m.store64(at(T4, 0), VALUE);
        self.barrier_for(op.value, VALUE);
    }

    pub(super) fn for_in_has(&mut self, op: op::ForInHas) {
        let ((seen, array), found) = (self.profiles.for_in(op.metadata), self.m.new_label());
        let modes = metadata(op.metadata, offset_of!(ForIn, modes));
        self.load(BASE, op.base);
        if is_likely_own_shape(seen) {
            let other = self.cold_alone(found, |c, cold| {
                let op = operands!(c, ForInHas);
                let modes = metadata(op.metadata, offset_of!(ForIn, modes));
                c.load_key(op.name, op.state, modes);
                c.both_steps(cold);
            });
            self.check_own_slot(op.state, 0, modes, other);
            self.m.move32(T0, TRUE);
        } else {
            self.load_key(op.name, op.state, modes);
            let profile = metadata(op.metadata, offset_of!(ForIn, access.array));
            let array = array - ArrayModes::STRING;
            self.read_by_value(has_element, (array, profile), false, found);
        }
        self.m.bind(found);
        self.store_result(op.dst);
        self.carries_boolean = true;
    }

    pub(super) fn for_in_has_own(&mut self, op: op::ForInHasOwn) {
        let found = self.m.new_label();
        let other = self.cold_alone(found, |c, cold| {
            let op = operands!(c, ForInHasOwn);
            let (state, name) = (registers_at(op.state), Argument::Load64(slot(op.name)));
            let arguments = [state, entry_at(op.metadata), BASE.into(), name];
            c.call_operation(address!(vm::for_in_has_own), &arguments);
            c.m.jump(cold.resume);
        });
        self.load(BASE, op.base);
        self.check_subject(op.state, 0, other);
        self.m.load32(T0, slot(op.state.nth(1)));
        self.m.branch32(Cond::Eq, T0, INDEXED, other);
        let count = enumerator(PropertyNameEnumerator::OFFSET_OF_OWN_COUNT);
        self.m.branch32(Cond::AboveEq, INDEX, count, other);
        if self.records {
            let modes = metadata(op.metadata, offset_of!(ForIn, modes));
            self.m.branch_test32(TestCond::Zero, modes, T0, other);
        }
        self.m.move32(T0, TRUE);
        self.m.bind(found);
        self.store_result(op.dst);
        self.carries_boolean = true;
    }

    // Iterators

    fn cold_operation(&mut self, emit: fn(&mut Compiler<'_>, &Cold)) -> Label {
        let end = self.end();
        self.cold_alone(end, emit)
    }

    /// The mode that is worth a place in the template, and the kind of elements that it goes through.
    fn likely_sequence(&self, word: u32) -> Option<(IterationMode, Elements)> {
        let (seen, array) = self.profiles.iterator_next(word);
        let kind = Elements::likely(&self.m, array);
        if seen == 0 || seen & IterationMode::Array.flag() != 0 {
            let is_double = kind == Some(Elements::Double);
            let kind = if is_double {
                Elements::Double
            } else {
                Elements::Values
            };
            Some((IterationMode::Array, kind))
        } else if seen == IterationMode::String.flag() {
            Some((IterationMode::String, Elements::String))
        } else if seen == IterationMode::TypedArray.flag() {
            kind.map(|kind| (IterationMode::TypedArray, kind))
        } else {
            None
        }
    }

    /// Loads the next element into `T0`. Goes to `end` with the subject in `BASE` and the index in `INDEX`.
    fn step_sequence(
        &mut self,
        (mode, kind): (IterationMode, Elements),
        state: Register,
        word: u32,
        other: Label,
        end: Label,
    ) {
        let marker = mode.marker().to_bits();
        (self.m).branch64(Cond::Ne, slot(state.nth(1)), marker, other);
        let modes = metadata(word, offset_of!(IteratorNext, modes));
        self.branch_unless_seen(modes, mode.flag(), other);
        self.m.load64(BASE, slot(state));
        self.m.load32(INDEX, slot(state.nth(2)));
        let outside = if mode == IterationMode::Array {
            end
        } else {
            other
        };
        let hole = other;
        load_element(&mut self.m, kind, other, Absent { hole, outside });
        if mode != IterationMode::String {
            self.record_shape(metadata(word, offset_of!(IteratorNext, array)));
        }
        self.m.add32(INDEX, INDEX, 1);
        self.m.store32(slot(state.nth(2)), INDEX);
    }

    fn call_iterator_next(&mut self) {
        let op = operands!(self, IteratorNext);
        let markers = IterationMode::LAST_MARKER - IterationMode::FIRST_MARKER;
        let generic = self.target(op.generic);
        self.m.load64(T0, slot(op.state.nth(1)));
        self.m.sub64(T0, T0, IterationMode::FIRST_MARKER);
        if self.records {
            let builtin = self.m.new_label();
            self.m.branch64(Cond::BelowEq, T0, markers, builtin);
            let modes = metadata(op.metadata, offset_of!(IteratorNext, modes));
            (self.m).or_to_memory(Size::S32, modes, IterationMode::Generic.flag());
            self.m.jump(generic);
            self.m.bind(builtin);
        } else {
            self.m.branch64(Cond::Above, T0, markers, generic);
        }
        let arguments = [registers_at(op.state), entry_at(op.metadata)];
        self.call_unchecked_operation(address!(registers::iterator_next), &arguments);
        self.take_step(op.done);
    }

    pub(super) fn iterator_next(&mut self, op: op::IteratorNext) {
        let found = self.m.new_label();
        match self.likely_sequence(op.metadata) {
            Some(sequence) => {
                let other = self.cold_alone(found, |c, cold| {
                    c.call_iterator_next();
                    c.m.jump(cold.resume);
                });
                let end = self.cold_alone(found, |c, _| {
                    let op = operands!(c, IteratorNext);
                    c.store(op.state.nth(2), IteratorRecord::DONE.to_bits());
                    let done = c.target(op.done);
                    c.m.jump(done);
                });
                self.step_sequence(sequence, op.state, op.metadata, other, end);
            }
            None => self.call_iterator_next(),
        }
        self.m.bind(found);
        self.store_profiled_result(op.value, op.metadata);
    }

    fn call_iterator_step(&mut self) {
        let op = operands!(self, IteratorStep);
        let arguments = [registers_at(op.state), entry_at(op.metadata)];
        self.call_operation(address!(registers::iterator_step), &arguments);
    }

    pub(super) fn iterator_step(&mut self, op: op::IteratorStep) {
        let found = self.m.new_label();
        match self.likely_sequence(op.metadata) {
            Some(sequence) => {
                let other = self.cold_alone(found, |c, cold| {
                    c.call_iterator_step();
                    c.m.jump(cold.resume);
                });
                let end = self.cold_alone(found, |c, cold| {
                    let op = operands!(c, IteratorStep);
                    c.store(op.state.nth(2), IteratorRecord::DONE.to_bits());
                    c.m.move32(T0, UNDEFINED);
                    c.m.jump(cold.resume);
                });
                self.step_sequence(sequence, op.state, op.metadata, other, end);
            }
            None => self.call_iterator_step(),
        }
        self.m.bind(found);
        self.store_profiled_result(op.value, op.metadata);
    }

    pub(super) fn iterator_skip(&mut self, op: op::IteratorSkip) {
        let other = self.cold_operation(|c, cold| {
            let state = registers_at(operands!(c, IteratorSkip).state);
            c.call_operation(address!(registers::iterator_skip), &[state]);
            c.m.jump(cold.resume);
        });
        let marker = IterationMode::Array.marker().to_bits();
        (self.m).branch64(Cond::Ne, slot(op.state.nth(1)), marker, other);
        self.m.load64(BASE, slot(op.state));
        self.m.load32(INDEX, slot(op.state.nth(2)));
        has_element(&mut self.m, Elements::Values, other, Absent::both(other));
        self.m.add32(INDEX, INDEX, 1);
        self.m.store32(slot(op.state.nth(2)), INDEX);
    }

    pub(super) fn iterator_rest(&mut self, op: op::IteratorRest) {
        self.call_operation(
            address!(registers::iterator_rest),
            &[registers_at(op.state)],
        );
        self.store_result(op.dst);
    }

    pub(super) fn spread(&mut self, op: op::Spread) {
        self.load(T1, op.iterable);
        self.call_operation(address!(registers::spread), &[T1.into()]);
        self.store_result(op.dst);
    }

    pub(super) fn new_array_with_spread(&mut self, op: op::NewArrayWithSpread) {
        let lowest = Argument::AddressOf(slot(op.first).plus((1 - op.count as i32) * WORD));
        let arguments = [lowest, op.count.into()];
        self.call_operation(address!(registers::new_array_with_spread), &arguments);
        self.store_result(op.dst);
    }

    fn is_likely_array(&self, word: u32) -> bool {
        let seen = self.profiles.iteration_modes(word);
        seen == 0 || seen & IterationMode::Array.flag() != 0
    }

    fn call_iterator_begin(&mut self) {
        let op = operands!(self, IteratorBegin);
        let arguments = [registers_at(op.state), entry_at(op.metadata), T1.into()];
        self.call_operation(address!(registers::iterator_begin), &arguments);
    }

    pub(super) fn iterator_begin(&mut self, op: op::IteratorBegin) {
        self.load(T1, op.iterable);
        if !self.is_likely_array(op.metadata) {
            return self.call_iterator_begin();
        }
        let other = self.cold_operation(|c, cold| {
            c.call_iterator_begin();
            c.m.jump(cold.resume);
        });
        let seen = metadata(op.metadata, 0);
        self.branch_unless_seen(seen, IterationMode::Array.flag(), other);
        self.m.call_address(self.thunks.is_pristine_array);
        self.m.branch_if_zero32(T0, other);
        self.open_array(op.state);
    }

    /// The one in `T1`.
    fn open_array(&mut self, state: Register) {
        self.store(state, T1);
        self.store(state.nth(1), IterationMode::Array.marker().to_bits());
        self.store(state.nth(2), IteratorRecord::START.to_bits());
    }

    fn branch_unless_array_iteration_is_pristine(&mut self, global: Gpr, target: Label) {
        let protocol = GlobalObject::offset_of_watchpoints(RealmWatchpoint::ArrayIteratorProtocol);
        self.m.load64(global, at(global, protocol));
        self.m.branch_unless_watched(global, target);
    }

    /// With the method in `T0` and the iterable in `T1`.
    fn call_iterator_open(&mut self) {
        let op = operands!(self, IteratorOpen);
        let (state, entry) = (registers_at(op.state), entry_at(op.metadata));
        let arguments = [state, entry, T1.into(), T0.into()];
        self.call_operation(address!(registers::iterator_open), &arguments);
        let opened = self.target(op.opened);
        self.m.branch32(Cond::Eq, T0, TRUE, opened);
    }

    pub(super) fn spread_arguments(&mut self, op: op::SpreadArguments) {
        let (end, done) = (self.end(), self.target(op.done));
        self.m.branch_if_not_empty(slot(op.arguments), end);
        if !op.for_call {
            return self.call_slow_path();
        }
        self.m.load_global(T2);
        self.branch_unless_array_iteration_is_pristine(T2, end);
        self.store(op.dst, 0);
        self.m.jump(done);
    }

    pub(super) fn iterator_open(&mut self, op: op::IteratorOpen) {
        self.load_both(op.method.into(), op.iterable);
        if !self.is_likely_array(op.metadata) {
            return self.call_iterator_open();
        }
        let other = self.cold_operation(|c, cold| {
            c.call_iterator_open();
            c.m.jump(cold.resume);
        });
        self.m.branch_if_not_cell(T1, other);
        self.m.branch_if_not_type(T1, CellType::Array, other);
        let seen = metadata(op.metadata, 0);
        self.branch_unless_seen(seen, IterationMode::Array.flag(), other);
        self.m.load_global(T2);
        let values = GlobalObject::offset_of_slot(RealmSlot::array_prototype_values);
        self.m.branch64(Cond::Ne, T0, at(T2, values), other);
        self.branch_unless_array_iteration_is_pristine(T2, other);
        self.open_array(op.state);
        let opened = self.target(op.opened);
        self.m.jump(opened);
    }

    pub(super) fn iterator_close(&mut self, op: op::IteratorClose) {
        let end = self.end();
        let other = self.cold_operation(|c, cold| {
            let op = operands!(c, IteratorClose);
            let is_throwing = u32::from(op.mode == CloseMode::Throw).into();
            let arguments = [registers_at(op.state), entry_at(op.metadata), is_throwing];
            c.call_operation(address!(registers::iterator_leave), &arguments);
            c.m.jump(cold.resume);
        });
        self.branch_unless_seen(metadata(op.metadata, 0), u32::MAX, other);
        self.m.branch32(Cond::Eq, slot(op.state.nth(2)), -1, end);
        let marker = IterationMode::Array.marker().to_bits();
        (self.m).branch64(Cond::Ne, slot(op.state.nth(1)), marker, other);
        let seen = metadata(op.metadata, 0);
        self.branch_unless_seen(seen, IterationMode::Array.flag(), other);
        self.m.load_global(T0);
        self.branch_unless_array_iteration_is_pristine(T0, other);
    }
}
