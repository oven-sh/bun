//! Opening and closing iterators. What the library iterates over needs none for as long as nobody can tell.

use bun_engine_asm::Size;
use bun_engine_bytecode::{MetadataKind, Register, op};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::code::metadata::Flags;
use bun_engine_vm::{
    CellType, IterationKind, IterationMode as Mode, IteratorRecord, JsArrayIterator, JsMapIterator,
    MapTable, OFFSET_OF_INTERNAL_FIELDS, RealmSlot, RealmWatchpoint, Shape, SpeculatedType as T,
    Value,
};
use smallvec::SmallVec;

use super::Builder;
use super::fork::Odds;
use super::frame::Junction;
use crate::graph::{ExitKind, Kind, heaps};

pub(super) type Modes = SmallVec<[Mode; 4]>;

pub(super) const fn internal_field(index: usize) -> i32 {
    (OFFSET_OF_INTERNAL_FIELDS + index * size_of::<u64>()) as i32
}

pub(super) fn modes_in(seen: &Flags) -> Modes {
    let all = Mode::ALL.iter().copied();
    all.filter(|it| seen.0.get() & it.flag() != 0).collect()
}

fn protocol_of(mode: Mode) -> Option<RealmWatchpoint> {
    Some(match mode {
        Mode::Array
        | Mode::TypedArray
        | Mode::ArrayKeys
        | Mode::ArrayValues
        | Mode::ArrayEntries => RealmWatchpoint::ArrayIteratorProtocol,
        Mode::String | Mode::StringIterator => RealmWatchpoint::StringIteratorProtocol,
        Mode::Map | Mode::MapKeys | Mode::MapValues | Mode::MapEntries => {
            RealmWatchpoint::MapIteratorProtocol
        }
        Mode::Set | Mode::SetValues | Mode::SetEntries => RealmWatchpoint::SetIteratorProtocol,
        Mode::Generic | Mode::AsyncGenerator | Mode::AsyncFromSync => return None,
    })
}

/// What `Symbol.iterator` has to be.
fn method_for(mode: Mode) -> RealmSlot {
    match mode {
        Mode::Array => RealmSlot::array_prototype_values,
        Mode::TypedArray => RealmSlot::typed_array_prototype_values,
        Mode::String => RealmSlot::string_prototype_iterator,
        Mode::Map => RealmSlot::map_prototype_entries,
        Mode::Set => RealmSlot::set_prototype_values,
        _ => RealmSlot::iterator_prototype_iterator,
    }
}

/// If the subject is an iterator: its shape, and the kinds that it may be of.
fn iterator_for(mode: Mode) -> Option<(RealmSlot, &'static [IterationKind])> {
    use IterationKind::{Entries, Keys, Values};
    Some(match mode {
        Mode::ArrayKeys => (RealmSlot::array_iterator_shape, &[Keys]),
        Mode::ArrayValues => (RealmSlot::array_iterator_shape, &[Values]),
        Mode::ArrayEntries => (RealmSlot::array_iterator_shape, &[Entries]),
        Mode::MapKeys => (RealmSlot::map_iterator_shape, &[Keys]),
        Mode::MapValues => (RealmSlot::map_iterator_shape, &[Values]),
        Mode::MapEntries => (RealmSlot::map_iterator_shape, &[Entries]),
        Mode::SetValues => (RealmSlot::set_iterator_shape, &[Keys, Values]),
        Mode::SetEntries => (RealmSlot::set_iterator_shape, &[Entries]),
        Mode::StringIterator => (RealmSlot::string_iterator_shape, &[]),
        _ => return None,
    })
}

/// What happens if a value is not what a way is for.
pub(super) enum Otherwise<'a> {
    Exit,
    LeaveFor(&'a mut Junction),
}

impl Builder<'_> {
    pub(super) fn require_condition(&mut self, holds: Ssa, otherwise: &mut Otherwise<'_>) {
        match otherwise {
            Otherwise::Exit => {
                let fails = self.not(holds);
                self.exit_if(fails, ExitKind::BadIterator);
            }
            Otherwise::LeaveFor(junction) => self.leave_unless(holds, Odds::Even, junction),
        }
    }

    pub(super) fn require_type(&mut self, value: Ssa, ty: T, otherwise: &mut Otherwise<'_>) -> Ssa {
        if let Otherwise::Exit = otherwise {
            return self.check_type_or(value, ty, ExitKind::BadIterator);
        }
        let holds = self.is_type(value, ty);
        self.require_condition(holds, otherwise);
        self.alias(value)
    }

    fn require_slot(&mut self, value: Ssa, slot: RealmSlot, otherwise: &mut Otherwise<'_>) {
        let expected = self.global().slot(self.vm, slot);
        let (value, expected) = (self.graph.root(value), self.cell(expected));
        let holds = self.ir().equal(value, expected);
        self.require_condition(holds, otherwise);
    }

    fn require_shape(&mut self, value: Ssa, slot: RealmSlot, otherwise: &mut Otherwise<'_>) -> Ssa {
        let shape = self.global().slot(self.vm, slot).cast::<Shape>();
        let (index, cell) = (
            self.shape(shape),
            self.require_type(value, T::CELL, otherwise),
        );
        let id = self.node(Kind::LoadShapeId, &[cell], 0);
        let holds = self.ir().equal(id, shape.id().bits());
        self.require_condition(holds, otherwise);
        self.assume_type(value, self.graph.shapes[index].ty);
        self.tie_down(value)
    }

    /// `translate` is run for each, and ends the way or goes on in the same registers as the others. What none is for
    /// exits, and is for `fallback` once it has.
    pub(super) fn for_each_mode(
        &mut self,
        modes: &[Mode],
        mut translate: impl FnMut(&mut Self, Mode, Otherwise<'_>),
        fallback: impl FnOnce(&mut Self),
    ) {
        let may_exit = !self.has_exited(ExitKind::BadIterator);
        let mut fork = self.fork_later();
        for (position, &mode) in modes.iter().enumerate() {
            let mut next = Junction::default();
            if may_exit && position + 1 == modes.len() {
                translate(self, mode, Otherwise::Exit);
            } else {
                translate(self, mode, Otherwise::LeaveFor(&mut next));
            }
            if next.edges.is_empty() {
                self.end_last_way(fork, None);
                return;
            }
            self.end_way(&mut fork, None);
            self.resume_at(&fork, &next);
        }
        if may_exit {
            self.force_exit(ExitKind::BadIterator);
        } else {
            fallback(self);
        }
        self.end_last_way(fork, None);
    }

    pub(super) fn record_in(&self, state: Register) -> [Ssa; 3] {
        [0, 1, 2].map(|index| self.frame().get(state.nth(index)))
    }

    /// The mode, if the `next` of a record tells.
    pub(super) fn known_mode(&self, next: Ssa) -> Option<Mode> {
        match self.constant_value(next) {
            Some(constant) => Some(Mode::of(constant)),
            None => self.is(next, T::CELL).then_some(Mode::Generic),
        }
    }

    pub(super) fn is_in_mode(&mut self, next: Ssa, mode: Mode) -> Ssa {
        if let Some(known) = self.known_mode(next) {
            return self.int32((known == mode).into());
        }
        let next = self.graph.root(next);
        if mode != Mode::Generic {
            return self.ir().equal(next, mode.marker().to_bits());
        }
        let distance = self.ir().sub(next, Mode::FIRST_MARKER);
        (self.ir()).above(distance, Mode::LAST_MARKER - Mode::FIRST_MARKER)
    }

    fn seen_modes(&self, metadata: u32) -> Modes {
        let code_block = self.frame().code_block;
        modes_in(code_block.checked_metadata(MetadataKind::IterationModes, metadata))
    }

    fn protocol_holds(&mut self, mode: Mode) -> bool {
        protocol_of(mode).is_some_and(|which| self.watch_realm(which))
    }

    /// Where a cursor starts out.
    pub(super) fn place_in(&mut self, collection: Ssa) -> Ssa {
        let (offset, heap) = (MapTable::OFFSET_OF_FORWARD as i32, heaps::COLLECTIONS);
        let table = self.load_value_of_type((collection, offset, heap), T::OTHER_CELL, T::CELL);
        let capacity = self.load_immutable(Type::I32, table, MapTable::OFFSET_OF_CAPACITY);
        let is_shared = self.ir().is_zero(capacity);
        let place = self.choose(is_shared, Odds::Even, |this, is_shared| {
            if is_shared {
                return Some(collection);
            }
            let (yes, offset) = (this.int32(1), MapTable::OFFSET_OF_MAY_HAVE_CURSORS as i32);
            (this.ir()).store_sized(Size::S8, yes, table, offset, heaps::SIDE_STATE);
            Some(table)
        });
        place.expect("nothing ends")
    }

    /// The subject of a record.
    fn subject_for(&mut self, mode: Mode, iterable: Ssa, otherwise: &mut Otherwise<'_>) -> Ssa {
        let Some((shape, kinds)) = iterator_for(mode) else {
            let ty = match mode {
                Mode::Array => T::ARRAY,
                Mode::TypedArray => T::TYPED_ARRAY,
                Mode::String => T::STRING,
                Mode::Map => T::MAP,
                _ => T::SET,
            };
            let checked = self.require_type(iterable, ty, otherwise);
            if mode == Mode::TypedArray {
                let fits = self.node(Kind::CanIterateByIndex, &[checked], 0);
                self.require_condition(fits, otherwise);
            }
            return checked;
        };
        let iterator = self.require_shape(iterable, shape, otherwise);
        let is_of_array = shape == RealmSlot::array_iterator_shape;
        if let [.., last] = *kinds {
            let field = if is_of_array {
                JsArrayIterator::KIND
            } else {
                JsMapIterator::KIND
            };
            let offset = internal_field(field);
            let kind = self.load(Type::I64, iterator, offset, heaps::INTERNAL_FIELDS);
            let distance = self.ir().sub(kind, Value::from(kinds[0]).to_bits());
            let holds = (self.ir()).below_or_equal(distance, last as u64 - kinds[0] as u64);
            self.require_condition(holds, otherwise);
        }
        if is_of_array {
            let object = self.object_of_array_iterator(iterator);
            let holds = self.node(Kind::IsCellOfType, &[object], CellType::Array.0.into());
            self.require_condition(holds, otherwise);
        }
        iterator
    }

    pub(super) fn object_of_array_iterator(&mut self, iterator: Ssa) -> Ssa {
        let offset = internal_field(JsArrayIterator::ITERATED_OBJECT);
        let place = (iterator, offset, heaps::INTERNAL_FIELDS);
        self.load_value_of_type(place, T::ARRAY, T::OBJECT)
    }

    fn new_record(&mut self, state: Register, mode: Mode, subject: Ssa) -> [(Register, Ssa); 3] {
        let subject = match mode {
            Mode::Map | Mode::Set => self.place_in(subject),
            _ => subject,
        };
        let (marker, start) = (self.value(mode.marker()), self.value(IteratorRecord::START));
        [
            (state, subject),
            (state.nth(1), marker),
            (state.nth(2), start),
        ]
    }

    pub(super) fn iterator_open(&mut self, op: op::IteratorOpen, next: u32) {
        let mut modes = self.seen_modes(op.metadata);
        if !self.has_run_or_exit(!modes.is_empty()) {
            return;
        }
        modes.retain(|&mut mode| mode == Mode::Generic || self.protocol_holds(mode));
        modes.sort_by_key(|&mode| mode == Mode::Generic);
        let (iterable, method) = (self.get_value(op.iterable), self.get_value(op.method));
        let opened = op.opened.from(self.frame().offset);
        let open = |this: &mut Self, mode, mut otherwise: Otherwise<'_>| {
            if mode == Mode::Generic {
                let is_callable = this.is_callable(method);
                this.require_condition(is_callable, &mut otherwise);
                let (nothing, start) = (this.undefined(), this.value(IteratorRecord::START));
                let record = [0, 1, 2].map(|index| (op.state.nth(index), nothing));
                return this.goto_with(&[record[0], record[1], (record[2].0, start)], next);
            }
            this.require_slot(method, method_for(mode), &mut otherwise);
            let subject = this.subject_for(mode, iterable, &mut otherwise);
            let record = this.new_record(op.state, mode, subject);
            this.goto_with(&record, opened);
        };
        self.for_each_mode(&modes, open, Self::interpret);
    }

    pub(super) fn iterator_begin(&mut self, op: op::IteratorBegin) {
        let modes = self.seen_modes(op.metadata);
        if !self.has_run_or_exit(!modes.is_empty()) {
            return;
        }
        let iterable = self.get_value(op.iterable);
        let mode = match modes[..] {
            [mode @ (Mode::Array | Mode::String)]
                if !self.has_exited(ExitKind::BadIterator) && self.protocol_holds(mode) =>
            {
                mode
            }
            _ => return self.interpret(),
        };
        let mut subject = self.subject_for(mode, iterable, &mut Otherwise::Exit);
        if mode == Mode::Array && self.has_exited(ExitKind::BadShape) {
            let operands = [subject, self.cell(self.global().cell())];
            let holds = self.node(Kind::InheritsArrayIteration, &operands, 0);
            self.require_condition(holds, &mut Otherwise::Exit);
        } else if mode == Mode::Array {
            subject = self.check_original_array(subject);
        }
        for (register, value) in self.new_record(op.state, mode, subject) {
            self.set(register, value);
        }
    }

    pub(super) fn is_done(&mut self, position: Ssa) -> Ssa {
        let position = self.graph.root(position);
        self.ir().equal(position, IteratorRecord::DONE.to_bits())
    }

    pub(super) fn iterator_close(&mut self, op: op::IteratorClose) {
        let [subject, next, position] = self.record_in(op.state);
        let known = self.known_mode(next);
        let mut modes = known.map_or_else(
            || self.seen_modes(op.metadata),
            |it| [it].into_iter().collect(),
        );
        let has_generic = modes.contains(&Mode::Generic);
        modes.retain(|&mut mode| self.protocol_holds(mode));
        let needs_nothing = |mode| known == Some(mode) && iterator_for(mode).is_none();
        if modes.first().copied().is_some_and(needs_nothing) {
            return;
        }
        let is_done = self.is_done(position);
        self.choose(is_done, Odds::Even, |this, is_done| {
            if is_done {
                return None;
            }
            if has_generic {
                this.interpret();
                return None;
            }
            let close = |this: &mut Self, mode, mut otherwise: Otherwise<'_>| {
                let holds = this.is_in_mode(next, mode);
                this.require_condition(holds, &mut otherwise);
                if let Some((shape, _)) = iterator_for(mode) {
                    this.require_shape(subject, shape, &mut otherwise);
                }
            };
            this.for_each_mode(&modes, close, Self::interpret);
            None
        });
    }
}
