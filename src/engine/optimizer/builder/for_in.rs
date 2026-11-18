//! `for`-`in`.

use bun_engine_asm::{Sign, Size};
use bun_engine_bytecode::{MetadataKind, Operand, Register, op};
use bun_engine_codegen::ir::{Access, AccessFlags, Heap, Type, Value as Ssa};
use bun_engine_vm::code::metadata::{ForIn, ForInGet};
use bun_engine_vm::{
    EnumerationMode, ImmutableArray, JsObject, PropertyNameEnumerator as Enumerator, Shape,
    ShapeFlags, SpeculatedType as T, Value,
};

use super::Builder;
use super::fork::Odds;
use super::frame::Junction;
use super::iteration::Otherwise;
use crate::graph::{Cache, ExitKind, Kind, heaps};

const INDEXED: u32 = EnumerationMode::Indexed as u32;
const OWN_SHAPE: u32 = EnumerationMode::OwnShape as u32;
const FIXED: Access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
/// Not a field: the enumerator whose shape an object has.
const ENUMERATED_BY: i32 = 1;

/// The registers of a loop. The last two are I32.
#[derive(Clone, Copy)]
struct Place {
    enumerator: Ssa,
    mode: Ssa,
    index: Ssa,
}

/// What an instruction does with the current key: by the slot, by the index, and as with any other key.
struct Ways<Slot, Index, Key> {
    by_slot: Slot,
    by_index: Index,
    by_key: Key,
}

impl Builder<'_> {
    fn place_in_loop(&mut self, state: Register) -> Place {
        let [enumerator, mode, index] = self.record_in(state);
        self.assume_type(enumerator, T::OTHER_CELL);
        Place {
            enumerator: self.alias(enumerator),
            mode: self.untag_position(mode),
            index: self.untag_position(index),
        }
    }

    fn of_enumerator(&mut self, place: Place, field: usize) -> Ssa {
        self.load_immutable(Type::I32, place.enumerator, field)
    }

    fn pack(&mut self, place: Place) -> Ssa {
        let mut ir = self.ir();
        let (mode, index) = (ir.zero_extend(place.mode), ir.zero_extend(place.index));
        let mode = ir.shl(mode, 32);
        ir.or(mode, index)
    }

    pub(super) fn for_in_open(&mut self, op: op::ForInOpen, next: u32) {
        let (base, fork) = (self.get_value(op.base), self.fork_later());
        let [mut nullish, mut empty] = [(); 2].map(|()| Junction::default());
        let is_nullish = self.is_type(base, T::NULLISH);
        self.leave_if(is_nullish, Odds::Low, &mut nullish);
        let base = self.alias(base);
        let enumerator = self.node(Kind::GetEnumerator, &[base], 0);
        let [indices, names] = [
            Enumerator::OFFSET_OF_INDEXED_LENGTH,
            Enumerator::OFFSET_OF_NAME_COUNT,
        ]
        .map(|field| self.load_immutable(Type::I32, enumerator, field));
        let keys = self.ir().or(indices, names);
        let is_empty = self.ir().is_zero(keys);
        self.leave_afterwards_if(is_empty, Odds::Even, &mut empty);
        let [indexed, own_shape] = [INDEXED, OWN_SHAPE].map(|it| self.int32(it as i32));
        let mode = self.ir().select(indices, indexed, own_shape);
        let record = [
            (op.state, enumerator),
            (op.state.nth(1), self.box_int32(mode)),
            (op.state.nth(2), self.value(Value::int32(-1))),
        ];
        self.goto_with(&record, next);

        let (undefined, target) = (self.undefined(), op.empty.from(self.frame().offset));
        let cleared = [0, 1, 2].map(|index| (op.state.nth(index), undefined));
        self.enter(&empty);
        self.goto_with(&cleared, target);
        if self.resume_if_reached(&fork, &nullish) {
            self.goto_with(&cleared, target);
        }
    }

    /// Gives the object, which has a slot for each of the first names.
    fn require_enumerated_shape(
        &mut self,
        base: Ssa,
        place: Place,
        otherwise: &mut Otherwise<'_>,
    ) -> Ssa {
        let (root, enumerator) = (self.graph.root(base), self.graph.root(place.enumerator));
        if self.knowledge.field(root, ENUMERATED_BY, heaps::SHAPE) == Some(enumerator) {
            return self.alias(base);
        }
        let cell = self.require_type(base, T::CELL, otherwise);
        let (id, expected) = (
            self.node(Kind::LoadShapeId, &[cell], 0),
            self.of_enumerator(place, Enumerator::OFFSET_OF_SUBJECT_SHAPE),
        );
        let holds = self.ir().equal(id, expected);
        self.require_condition(holds, otherwise);
        self.assume_type(base, T::OBJECT);
        (self.knowledge).learn_field(root, ENUMERATED_BY, heaps::SHAPE, enumerator);
        self.tie_down(base)
    }

    fn require_mode(&mut self, place: Place, mode: u32, otherwise: &mut Otherwise<'_>) {
        let holds = self.ir().equal(place.mode, mode);
        self.require_condition(holds, otherwise);
    }

    fn name_at(&mut self, place: Place, index: Ssa) -> Ssa {
        let names = self.load_immutable(Type::I64, place.enumerator, Enumerator::OFFSET_OF_NAMES);
        let address = self.element_address(names, index);
        let first = ImmutableArray::OFFSET_OF_ELEMENTS as i32;
        let name = self.ir().load(Type::I64, address, first, FIXED);
        self.graph.declare(name, T::STRING - T::ROPE_STRING);
        self.graph.predict(name, T::ATOM_STRING);
        name
    }

    pub(super) fn for_in_next(&mut self, op: op::ForInNext, next: u32) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::ForIn);
        let entry = (code_block.anchor()).checked_metadata::<ForIn>(kind, op.metadata);
        let (base, place) = (self.get_value(op.base), self.place_in_loop(op.state));
        let (seen, done) = (entry.modes.0.get(), op.done.from(self.frame().offset));
        let (index, fork) = (self.ir().add(place.index, 1), self.fork_later());
        let position = self.box_int32(index);
        let [mut named, mut slow, mut over] = [(); 3].map(|()| Junction::default());
        let may_exit = seen & !OWN_SHAPE == 0 && !self.has_exited(ExitKind::BadIterator);

        if seen & INDEXED != 0 {
            self.require_mode(place, INDEXED, &mut Otherwise::LeaveFor(&mut named));
            let (length, mut past) = (
                self.of_enumerator(place, Enumerator::OFFSET_OF_INDEXED_LENGTH),
                Junction::default(),
            );
            let is_past = self.ir().above_or_equal(index, length);
            self.leave_if(is_past, Odds::Low, &mut past);
            self.leave_unless_own_element((base, index, entry.array.modes()), &mut slow);
            if !self.block.is_none() {
                let name = self.node(Kind::Int32ToString, &[index], 0);
                self.goto_with(&[(op.name, name), (op.state.nth(2), position)], next);
            }
            self.resume_at(&fork, &past);
            let names = self.of_enumerator(place, Enumerator::OFFSET_OF_NAME_COUNT);
            self.leave_if(names, Odds::Even, &mut slow);
            self.leave_for(&mut over, None);
            self.resume_if_reached(&fork, &named);
        } else if may_exit {
            self.require_mode(place, OWN_SHAPE, &mut Otherwise::Exit);
        } else {
            let is_indexed = self.ir().equal(place.mode, INDEXED);
            self.leave_if(is_indexed, Odds::Low, &mut slow);
        }

        if !self.block.is_none() {
            let mut rest = Junction::default();
            if seen & OWN_SHAPE != 0 {
                let own = self.of_enumerator(place, Enumerator::OFFSET_OF_OWN_SHAPE_COUNT);
                let is_past = self.ir().above_or_equal(index, own);
                self.leave_if(is_past, Odds::Low, &mut rest);
                let mut otherwise = if may_exit {
                    Otherwise::Exit
                } else {
                    Otherwise::LeaveFor(&mut slow)
                };
                self.require_enumerated_shape(base, place, &mut otherwise);
                let name = self.name_at(place, index);
                self.goto_with(&[(op.name, name), (op.state.nth(2), position)], next);
                self.resume_at(&fork, &rest);
            }
            let names = self.of_enumerator(place, Enumerator::OFFSET_OF_NAME_COUNT);
            let has_more = self.ir().below(index, names);
            if may_exit {
                self.exit_if(has_more, ExitKind::BadIterator);
            } else {
                self.leave_if(has_more, Odds::Even, &mut slow);
            }
            self.leave_for(&mut over, None);
        }

        if self.resume_if_reached(&fork, &over) {
            self.goto_with(&[], done);
        }
        if self.resume_if_reached(&fork, &slow) {
            self.next_name_slowly(op, base, place, [next, done]);
        }
    }

    fn next_name_slowly(&mut self, op: op::ForInNext, base: Ssa, place: Place, to: [u32; 2]) {
        let operands = [self.alias(base), place.enumerator, self.pack(place)];
        let found = self.node(Kind::NextName, &operands, 0);
        let mut ir = self.ir();
        let (name, packed) = (ir.extract(found, 0), ir.extract(found, 1));
        let (upper, index) = (ir.shr(packed, 32), ir.wrap(packed));
        let (mode, is_over) = (ir.wrap(upper), ir.equal(name, Value::UNDEFINED.to_bits()));
        let mut over = Junction::default();
        self.leave_afterwards_if(is_over, Odds::Even, &mut over);
        self.graph.predict(name, T::ATOM_STRING);
        self.assume_type(name, T::STRING - T::ROPE_STRING);
        let changed = [
            (op.name, name),
            (op.state.nth(1), self.box_int32(mode)),
            (op.state.nth(2), self.box_int32(index)),
        ];
        self.goto_with(&changed, to[0]);
        self.enter(&over);
        self.goto_with(&[], to[1]);
    }

    /// Runs `access` with what to add an offset to, for the slot with the number of the index.
    fn at_slot(
        &mut self,
        object: Ssa,
        place: Place,
        mut access: impl FnMut(&mut Self, Ssa, i32) -> Option<Ssa>,
    ) -> Option<Ssa> {
        let capacity = self.of_enumerator(place, Enumerator::OFFSET_OF_INLINE_CAPACITY);
        let is_outside = self.ir().above_or_equal(place.index, capacity);
        self.choose(is_outside, Odds::Even, |this, is_outside| {
            if !is_outside {
                let address = this.element_address(object, place.index);
                return access(this, address, size_of::<JsObject>() as i32);
            }
            let storage = this.storage(object);
            let mut ir = this.ir();
            let distance = ir.sub(capacity, place.index);
            let distance = ir.sign_extend(distance);
            let distance = ir.shl(distance, 3);
            let address = ir.add(storage, distance);
            access(this, address, -2 * size_of::<u64>() as i32)
        })
    }

    fn use_key(
        &mut self,
        entry: &ForIn,
        (base, name, state): (Ssa, Register, Register),
        ways: Ways<
            impl FnOnce(&mut Self, Ssa, Place, &mut Otherwise<'_>) -> Option<Ssa>,
            impl FnOnce(&mut Self, Ssa) -> Option<Ssa>,
            impl FnOnce(&mut Self, Ssa, Place) -> Option<Ssa>,
        >,
    ) -> Option<Ssa> {
        let seen = entry.modes.0.get();
        if !self.has_run_or_exit(seen != 0) {
            return None;
        }
        let (place, name) = (self.place_in_loop(state), self.get_value(name));
        let may_exit = !self.has_exited(ExitKind::BadIterator);
        if seen == INDEXED && may_exit {
            self.require_mode(place, INDEXED, &mut Otherwise::Exit);
            let key = self.box_int32(place.index);
            return (ways.by_index)(self, key);
        }
        if seen == OWN_SHAPE && may_exit {
            self.require_mode(place, OWN_SHAPE, &mut Otherwise::Exit);
            let object = self.require_enumerated_shape(base, place, &mut Otherwise::Exit);
            return (ways.by_slot)(self, object, place, &mut Otherwise::Exit);
        }
        if seen & OWN_SHAPE == 0 {
            return (ways.by_key)(self, name, place);
        }
        let (mut fork, mut other) = (self.fork_later(), Junction::default());
        let mut otherwise = Otherwise::LeaveFor(&mut other);
        self.require_mode(place, OWN_SHAPE, &mut otherwise);
        let object = self.require_enumerated_shape(base, place, &mut otherwise);
        let mut result = (ways.by_slot)(self, object, place, &mut otherwise);
        if !other.edges.is_empty() {
            self.end_way(&mut fork, result);
            self.resume_at(&fork, &other);
            result = (ways.by_key)(self, name, place);
        }
        self.end_last_way(fork, result)
    }

    /// The number, if the name stands for one.
    fn best_key(&mut self, entry: &ForIn, name: Ssa, place: Place) -> Ssa {
        if entry.modes.0.get() & INDEXED == 0 {
            return name;
        }
        let (number, name) = (self.box_int32(place.index), self.graph.root(name));
        let is_indexed = self.ir().equal(place.mode, INDEXED);
        self.ir().select(is_indexed, number, name)
    }

    pub(super) fn for_in_get(&mut self, op: op::ForInGet) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::ForInGet);
        let entry = &(code_block.anchor())
            .checked_metadata::<ForInGet>(kind, op.metadata)
            .for_in;
        let Some(prediction) = self.prediction_or_exit(op.metadata) else {
            return;
        };
        let base = self.get_value(op.base);
        let ways = Ways {
            by_slot: |this: &mut Self, object, place, _: &mut Otherwise<'_>| {
                this.at_slot(object, place, |this, address, offset| {
                    let value = this.ir().load(Type::I64, address, offset, heaps::NAMED);
                    this.graph.declare(value, T::HEAP_TOP);
                    this.graph.predict(value, prediction);
                    this.note_profile(value, op.metadata);
                    Some(value)
                })
            },
            by_index: |this: &mut Self, key| {
                this.get_element([base, key], &entry.access, (prediction, op.metadata))
            },
            by_key: |this: &mut Self, name, place| {
                let operands = [base, this.best_key(entry, name, place)];
                this.cached_load(Cache::GetByVal, &entry.access, &operands, op.metadata)
            },
        };
        let result = self.use_key(entry, (base, op.name, op.state), ways);
        result.inspect(|&result| self.set(op.dst, result));
    }

    fn require_writable_slots(&mut self, object: Ssa, place: Place, otherwise: &mut Otherwise<'_>) {
        let shape = self.node(Kind::LoadShape, &[object], 0);
        let (mut ir, offset) = (self.ir(), Enumerator::OFFSET_OF_IS_WRITABLE as i32);
        // Whatever gets to compile code may begin to watch.
        let flags = ir.load(
            Type::I32,
            shape,
            Shape::OFFSET_OF_FLAGS as i32,
            Heap::EVERYTHING,
        );
        let is_writable = ir.load_narrow(Size::S8, Sign::Unsigned, place.enumerator, offset, FIXED);
        let watched = ir.and(flags, ShapeFlags::IS_WATCHING_REPLACEMENT.bits());
        let [is_writable, is_free] = [ir.is_not_zero(is_writable), ir.is_zero(watched)];
        self.require_condition(is_writable, otherwise);
        self.require_condition(is_free, otherwise);
    }

    pub(super) fn for_in_put(&mut self, op: op::ForInPut) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::ForIn);
        let entry = (code_block.anchor()).checked_metadata::<ForIn>(kind, op.metadata);
        let (base, value) = (self.get_value(op.base), self.get_value(op.value));
        let cache = if op.strict {
            Cache::PutByValStrict
        } else {
            Cache::PutByVal
        };
        let ways = Ways {
            by_slot: |this: &mut Self, object, place, otherwise: &mut Otherwise<'_>| {
                this.require_writable_slots(object, place, otherwise);
                this.at_slot(object, place, |this, address, offset| {
                    this.store_value(object, address, offset, heaps::NAMED, value);
                    None
                })
            },
            by_index: |this: &mut Self, key| {
                this.write_element([base, key, value], &entry.access, cache);
                None
            },
            by_key: |this: &mut Self, name, place| {
                let operands = [base, this.best_key(entry, name, place), value];
                this.cached(cache, &entry.access, &operands);
                None
            },
        };
        self.use_key(entry, (base, op.name, op.state), ways);
    }

    fn ask_about_key(
        &mut self,
        (dst, base, name, state): (Register, Operand, Register, Register),
        (metadata, answerable): (u32, T),
        ask: impl Fn(&mut Self, &ForIn, [Ssa; 2], Place) -> Ssa,
    ) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::ForIn);
        let entry = (code_block.anchor()).checked_metadata::<ForIn>(kind, metadata);
        let base = self.get_value(base);
        let ways = Ways {
            by_slot: |this: &mut Self, _, _, _: &mut Otherwise<'_>| Some(this.value(Value::TRUE)),
            by_index: |this: &mut Self, _| {
                let (place, name) = (this.place_in_loop(state), this.get_value(name));
                let (mut fork, mut other) = (this.fork_later(), Junction::default());
                this.require_type(base, answerable, &mut Otherwise::LeaveFor(&mut other));
                this.leave_unless_own_element((base, place.index, entry.array.modes()), &mut other);
                let yes = this.value(Value::TRUE);
                this.end_way(&mut fork, Some(yes));
                this.resume_at(&fork, &other);
                let answer = ask(this, entry, [base, name], place);
                this.end_last_way(fork, Some(answer))
            },
            by_key: |this: &mut Self, name, place| Some(ask(this, entry, [base, name], place)),
        };
        let result = self.use_key(entry, (base, name, state), ways);
        result.inspect(|&result| self.set(dst, result));
    }

    pub(super) fn for_in_has(&mut self, op: op::ForInHas) {
        let operands = (op.dst, op.base, op.name, op.state);
        self.ask_about_key(
            operands,
            (op.metadata, T::OBJECT),
            |this, entry, [base, name], place| {
                let operands = [base, this.best_key(entry, name, place)];
                this.cached_test(Cache::InByVal, &entry.access, &operands)
            },
        );
    }

    pub(super) fn for_in_has_own(&mut self, op: op::ForInHasOwn) {
        let operands = (op.dst, op.base, op.name, op.state);
        self.ask_about_key(
            operands,
            (op.metadata, T::CELL),
            |this, _, [base, name], place| {
                let (base, name, packed) = (this.alias(base), this.alias(name), this.pack(place));
                let answer =
                    this.node(Kind::HasOwnName, &[base, place.enumerator, packed, name], 0);
                this.box_boolean(answer)
            },
        );
    }
}
