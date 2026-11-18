//! Stepping through what the library iterates over.

use bun_engine_bytecode::{MetadataKind, Register, op};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::code::metadata::IteratorNext;
use bun_engine_vm::{
    ArrayModes, ElementKind, IterationKind, IterationMode as Mode, IteratorRecord, JsArrayIterator,
    JsMapIterator, MapKind, MapTable, SetKind, SetTable, SpeculatedType as T, TableKind, Value,
};

use super::Builder;
use super::fork::Odds;
use super::frame::Junction;
use super::iteration::{Otherwise, internal_field, modes_in};
use crate::graph::{ExitKind, Kind, heaps};

/// What an instruction has seen.
#[derive(Clone, Copy)]
struct Profile {
    elements: ArrayModes,
    has_had_values: bool,
    values: T,
    metadata: u32,
}

/// What a step gives if there is something left.
struct Step {
    value: Ssa,
    subject: Ssa,
    position: Ssa,
}

pub(super) struct Entry {
    pub(super) table: Ssa,
    /// Of the one that follows, with its tag.
    pub(super) number: Ssa,
    pub(super) key: Ssa,
    pub(super) value: Ssa,
}

fn is_translated(mode: Mode) -> bool {
    !matches!(
        mode,
        Mode::Generic | Mode::StringIterator | Mode::AsyncGenerator | Mode::AsyncFromSync
    )
}

impl Builder<'_> {
    fn profile_of_steps(&self, entry: &IteratorNext, metadata: u32) -> Profile {
        let values = self.prediction_at(metadata);
        Profile {
            elements: entry.array.modes(),
            has_had_values: !values.is_empty() || self.has_exited(ExitKind::NeverExecuted),
            values,
            metadata,
        }
    }

    pub(super) fn untag_position(&mut self, position: Ssa) -> Ssa {
        self.assume_type(position, T::INT32);
        self.as_int32(position)
    }

    fn position_after(&mut self, index: Ssa, distance: Ssa) -> Ssa {
        let next = self.ir().add(index, distance);
        self.box_int32(next)
    }

    fn element_of_array(
        &mut self,
        array: Ssa,
        index: Ssa,
        profile: Profile,
        end: &mut Junction,
    ) -> Option<Ssa> {
        if !profile.has_had_values {
            self.leave_if_past_end(array, index, end);
            self.force_exit(ExitKind::NeverExecuted);
            return None;
        }
        let access = (array, index, profile.elements);
        self.next_element(access, Some((profile.values, profile.metadata)), end)
    }

    /// With the number of code units.
    pub(super) fn code_point_string(
        &mut self,
        string: Ssa,
        index: Ssa,
        end: &mut Junction,
    ) -> (Ssa, Ssa) {
        const LEAD_SURROGATES: (i32, i32) = (0xd800, 0x400);
        let string = self.alias(string);
        let length = self.string_length(string);
        let is_past = self.ir().above_or_equal(index, length);
        self.leave_if(is_past, Odds::Low, end);
        let (inside, string) = (
            self.node(Kind::InBounds, &[index], 0),
            self.resolve_rope(string),
        );
        let unit = self.node(Kind::StringUnitAt, &[string, inside], 0);
        let distance = self.ir().sub(unit, LEAD_SURROGATES.0);
        let may_have_trail = self.ir().below(distance, LEAD_SURROGATES.1);
        if !self.has_exited(ExitKind::Surrogate) {
            self.exit_if(may_have_trail, ExitKind::Surrogate);
            return (self.node(Kind::StringFromUnit, &[unit], 0), self.int32(1));
        }
        let value = self.choose(may_have_trail, Odds::Low, |this, may_have_trail| {
            Some(if may_have_trail {
                this.node(Kind::CodePointString, &[string, inside], 0)
            } else {
                this.node(Kind::StringFromUnit, &[unit], 0)
            })
        });
        let value = self.alias(value.expect("nothing ends"));
        (value, self.string_length(value))
    }

    /// The key, which may be empty, and what follows the hash.
    fn load_entry(&mut self, table: Ssa, number: Ssa, has_values: bool) -> [Ssa; 2] {
        let (mask, heap) = (
            self.load_immutable(Type::I32, table, MapTable::OFFSET_OF_BUCKET_MASK),
            heaps::COLLECTIONS,
        );
        let words = if has_values {
            MapTable::ENTRY_WORDS
        } else {
            SetTable::ENTRY_WORDS
        };
        let mut ir = self.ir();
        let (mask, number) = (ir.zero_extend(mask), ir.zero_extend(number));
        let (buckets, entries) = (ir.shl(mask, 2), ir.mul(number, words * 8));
        let distance = ir.add(buckets, entries);
        let address = ir.add(table, distance);
        let first = MapTable::OFFSET_OF_BUCKETS + size_of::<u32>();
        let key = ir.load(
            Type::I64,
            address,
            (first + MapTable::OFFSET_OF_ENTRY_KEY) as i32,
            heap,
        );
        if !has_values {
            return [key, key];
        }
        let offset = (first + MapTable::OFFSET_OF_ENTRY_VALUE) as i32;
        let value = ir.load(Type::I64, address, offset, heap);
        self.graph.declare(value, T::HEAP_TOP);
        [key, value]
    }

    pub(super) fn next_entry(
        &mut self,
        (place, number): (Ssa, Ssa),
        has_values: bool,
        end: &mut Junction,
    ) -> Entry {
        let (fork, heap) = (self.fork_later(), heaps::COLLECTIONS);
        let (mut slow, mut found) = (Junction::default(), Junction::default());
        self.assume_type(place, T::CELL);
        let (place, offset) = (self.tie_down(place), MapTable::OFFSET_OF_FORWARD as i32);
        let forward = self.load(Type::I64, place, offset, heap);
        let is_current = self.ir().and(forward, MapTable::IS_CURRENT);
        let is_retired = self.ir().is_zero(is_current);
        self.leave_if(is_retired, Odds::Low, &mut slow);
        let table = self.tie_down(place);
        let used = self.load(Type::I32, table, MapTable::OFFSET_OF_USED as i32, heap);
        let is_past = self.ir().above_or_equal(number, used);
        self.leave_if(is_past, Odds::Low, end);
        let [key, value] = self.load_entry(table, number, has_values);
        let is_removed = self.ir().is_zero(key);
        self.leave_if(is_removed, Odds::Low, &mut slow);
        self.assume_type(key, T::HEAP_TOP);
        let one = self.int32(1);
        let after = self.position_after(number, one);
        self.leave_with_values(&mut found, &[table, after, key, value]);

        self.resume_at(&fork, &slow);
        let place = self.alias(place);
        let cursor = self.node(Kind::NextEntry, &[place, number], has_values.into());
        let (table, number) = (self.ir().extract(cursor, 0), self.ir().extract(cursor, 1));
        let is_over = self.ir().is_zero(table);
        self.leave_if(is_over, Odds::Even, end);
        self.assume_type(table, T::CELL);
        let (table, number) = (self.alias(table), self.ir().wrap(number));
        let [key, value] = self.load_entry(table, number, has_values);
        self.assume_type(key, T::HEAP_TOP);
        let after = self.position_after(number, one);
        self.leave_with_values(&mut found, &[table, after, key, value]);

        self.resume_at(&fork, &found);
        let [table, number, key, value] = found.values[..] else {
            unreachable!("four were passed")
        };
        Entry {
            table,
            number,
            key,
            value,
        }
    }

    fn part_of_entry(&mut self, entry: &Entry, kind: IterationKind, profile: Profile) -> Ssa {
        let part = match kind {
            IterationKind::Keys => entry.key,
            IterationKind::Values => entry.value,
            IterationKind::Entries => {
                return self.array_of(ElementKind::Contiguous, &[entry.key, entry.value], 0);
            }
        };
        self.graph.predict(part, profile.values);
        part
    }

    fn set_field(&mut self, iterator: Ssa, field: usize, value: Ssa) {
        let (offset, heap) = (internal_field(field), heaps::INTERNAL_FIELDS);
        self.store_value(iterator, iterator, offset, heap, value);
    }

    fn get_index_field(&mut self, iterator: Ssa, field: usize) -> Ssa {
        let place = (iterator, internal_field(field), heaps::INTERNAL_FIELDS);
        let index = self.load_value_of_type(place, T::INT32, T::BOXED_NUMBER);
        self.check_type_or(index, T::INT32, ExitKind::ExoticObject);
        self.as_int32(index)
    }

    fn step_array_iterator(
        &mut self,
        iterator: Ssa,
        kind: IterationKind,
        mut profile: Profile,
        end: &mut Junction,
    ) -> Option<Ssa> {
        let index = self.get_index_field(iterator, JsArrayIterator::INDEX);
        let is_last_to_fit = self.ir().equal(index, i32::MAX);
        self.exit_if(is_last_to_fit, ExitKind::ExoticObject);
        let object = self.object_of_array_iterator(iterator);
        let array = self.check_type_or(object, T::ARRAY, ExitKind::ExoticObject);
        let (key, one) = (self.box_int32(index), self.int32(1));
        let value = if kind == IterationKind::Keys {
            self.leave_if_past_end(array, index, end);
            key
        } else {
            if kind == IterationKind::Entries {
                profile.values = T::empty();
            }
            self.element_of_array(array, index, profile, end)?
        };
        let value = match kind {
            IterationKind::Entries => self.array_of(ElementKind::Contiguous, &[key, value], 0),
            _ => value,
        };
        let after = self.position_after(index, one);
        self.set_field(iterator, JsArrayIterator::INDEX, after);
        Some(value)
    }

    fn step_table_iterator(
        &mut self,
        iterator: Ssa,
        (has_values, kind): (bool, IterationKind),
        profile: Profile,
        end: &mut Junction,
    ) -> Ssa {
        let number = self.get_index_field(iterator, JsMapIterator::NUMBER);
        let place = (
            iterator,
            internal_field(JsMapIterator::PLACE),
            heaps::INTERNAL_FIELDS,
        );
        let place = self.load_value_of_type(place, T::OTHER_CELL, T::CELL);
        let entry = self.next_entry((place, number), has_values, end);
        let value = self.part_of_entry(&entry, kind, profile);
        self.set_field(iterator, JsMapIterator::NUMBER, entry.number);
        self.set_field(iterator, JsMapIterator::PLACE, entry.table);
        value
    }

    /// Leaves for `end` if there is nothing left. `finish` follows there.
    fn step(
        &mut self,
        mode: Mode,
        [subject, _, position]: [Ssa; 3],
        profile: Profile,
        end: &mut Junction,
    ) -> Option<Step> {
        use IterationKind::{Entries, Keys, Values};
        let one = self.int32(1);
        let (value, index, distance) = match mode {
            Mode::Array => {
                self.assume_type(subject, T::ARRAY);
                let index = self.untag_position(position);
                (
                    self.element_of_array(subject, index, profile, end)?,
                    index,
                    one,
                )
            }
            Mode::TypedArray => {
                self.assume_type(subject, T::TYPED_ARRAY);
                let index = self.untag_position(position);
                let access = (subject, index, profile.elements);
                (
                    self.next_typed_element(access, profile.values, end)?,
                    index,
                    one,
                )
            }
            Mode::String => {
                self.assume_type(subject, T::STRING);
                let index = self.untag_position(position);
                let (value, length) = self.code_point_string(subject, index, end);
                (value, index, length)
            }
            Mode::Map | Mode::Set => {
                let (number, is_map) = (self.untag_position(position), mode == Mode::Map);
                let entry = self.next_entry((subject, number), is_map, end);
                let kind = if is_map { Entries } else { Keys };
                return Some(Step {
                    value: self.part_of_entry(&entry, kind, profile),
                    subject: entry.table,
                    position: entry.number,
                });
            }
            _ => {
                self.assume_type(subject, T::OBJECT);
                let iterator = self.tie_down(subject);
                let value = match mode {
                    Mode::ArrayKeys => self.step_array_iterator(iterator, Keys, profile, end)?,
                    Mode::ArrayValues => {
                        self.step_array_iterator(iterator, Values, profile, end)?
                    }
                    Mode::ArrayEntries => {
                        self.step_array_iterator(iterator, Entries, profile, end)?
                    }
                    _ => self.step_table_iterator(iterator, parts_for(mode), profile, end),
                };
                let position = self.value(IteratorRecord::START);
                return Some(Step {
                    value,
                    subject,
                    position,
                });
            }
        };
        Some(Step {
            value,
            subject,
            position: self.position_after(index, distance),
        })
    }

    /// What is left to do once there is nothing left.
    fn finish(&mut self, mode: Mode, [subject, _, position]: [Ssa; 3]) {
        let subject = self.alias(subject);
        match mode {
            Mode::Array | Mode::String | Mode::Map | Mode::Set => {}
            Mode::TypedArray => {
                let index = self.untag_position(position);
                self.node(Kind::CheckViewEndsAt, &[subject, index], 0);
            }
            Mode::ArrayKeys | Mode::ArrayValues | Mode::ArrayEntries => {
                let done = self.value(JsArrayIterator::DONE);
                self.set_field(subject, JsArrayIterator::INDEX, done);
            }
            _ => {
                let empty = if parts_for(mode).0 {
                    MapKind::empty_table(self.vm).cell()
                } else {
                    SetKind::empty_table(self.vm).cell()
                };
                let (empty, start) = (self.cell(empty), self.value(Value::ZERO));
                self.set_field(subject, JsMapIterator::NUMBER, start);
                self.set_field(subject, JsMapIterator::PLACE, empty);
            }
        }
    }

    fn may_step(&self, mode: Mode, profile: Profile) -> bool {
        let may_run_scripts = profile.elements.contains(ArrayModes::EXOTIC)
            || self.has_exited(ExitKind::ExoticObject);
        is_translated(mode) && (mode == Mode::Array || !may_run_scripts)
    }

    pub(super) fn iterator_next(&mut self, op: op::IteratorNext, next: u32) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::IteratorNext);
        let entry = (code_block.anchor()).checked_metadata::<IteratorNext>(kind, op.metadata);
        let (record, profile) = (
            self.record_in(op.state),
            self.profile_of_steps(entry, op.metadata),
        );
        let known = self.known_mode(record[1]);
        let mut modes =
            known.map_or_else(|| modes_in(&entry.modes), |it| [it].into_iter().collect());
        let needs_interpreter = |&it: &Mode| it != Mode::Generic && !self.may_step(it, profile);
        if modes.iter().any(needs_interpreter) {
            return self.interpret();
        }
        modes.sort_by_key(|&mode| mode == Mode::Generic);
        let [done, generic] = [op.done, op.generic].map(|it| it.from(self.frame().offset));
        let translate = |this: &mut Self, mode, mut otherwise: Otherwise<'_>| {
            let holds = this.is_in_mode(record[1], mode);
            this.require_condition(holds, &mut otherwise);
            if mode == Mode::Generic {
                return this.goto_with(&[], generic);
            }
            let (fork, mut end) = (this.fork_later(), Junction::default());
            if let Some(step) = this.step(mode, record, profile, &mut end) {
                let changed = [
                    (op.state, step.subject),
                    (op.state.nth(2), step.position),
                    (op.value, step.value),
                ];
                this.goto_with(&changed, next);
            }
            if this.resume_if_reached(&fork, &end) {
                this.finish(mode, record);
                let position = this.value(IteratorRecord::DONE);
                this.goto_with(&[(op.state.nth(2), position)], done);
            }
        };
        self.for_each_mode(&modes, translate, Self::interpret);
    }

    pub(super) fn iterator_step(&mut self, op: op::IteratorStep) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::IteratorNext);
        let entry = (code_block.anchor()).checked_metadata::<IteratorNext>(kind, op.metadata);
        let profile = self.profile_of_steps(entry, op.metadata);
        let next = self.frame().get(op.state.nth(1));
        let only = match modes_in(&entry.modes)[..] {
            [only] if !self.has_exited(ExitKind::BadIterator) => Some(only),
            _ => None,
        };
        let mode = self.known_mode(next).or(only);
        let Some(mode) = mode.filter(|&it| self.may_step(it, profile)) else {
            return self.interpret_or_exit(op.metadata);
        };
        let holds = self.is_in_mode(next, mode);
        self.require_condition(holds, &mut Otherwise::Exit);
        self.step_in_pattern(mode, op.state, op.value, profile);
    }

    fn step_in_pattern(&mut self, mode: Mode, state: Register, dst: Register, profile: Profile) {
        let (record, fork) = (self.record_in(state), self.fork_later());
        let [mut was_done, mut end, mut after] = [(); 3].map(|()| Junction::default());
        // As an index it is past the end.
        if !matches!(mode, Mode::Array | Mode::String) {
            let is_done = self.is_done(record[2]);
            self.leave_if(is_done, Odds::Low, &mut was_done);
        }
        if let Some(step) = self.step(mode, record, profile, &mut end) {
            let value = self.graph.root(step.value);
            if self.graph.prediction(value).is_empty() {
                self.graph.predict(value, profile.values);
            }
            self.leave_with_values(&mut after, &[step.value, step.subject, step.position]);
        }
        let may_end =
            profile.values.intersects(T::UNDEFINED) || self.has_exited(ExitKind::Exhausted);
        let nothing = [
            self.undefined(),
            record[0],
            self.value(IteratorRecord::DONE),
        ];
        for (junction, is_news) in [(&end, true), (&was_done, false)] {
            if !self.resume_if_reached(&fork, junction) {
                continue;
            }
            if !may_end {
                self.force_exit(ExitKind::Exhausted);
                continue;
            }
            if is_news {
                self.finish(mode, record);
            }
            self.leave_with_values(&mut after, &nothing);
        }
        if self.end_fork_at(&fork, &after) {
            for (register, &value) in [dst, state, state.nth(2)].into_iter().zip(&after.values) {
                self.set(register, value);
            }
        }
    }

    pub(super) fn iterator_skip(&mut self, op: op::IteratorSkip) {
        let [array, next, position] = self.record_in(op.state);
        if self.known_mode(next) != Some(Mode::Array) || self.has_exited(ExitKind::ExoticObject) {
            return self.interpret();
        }
        self.assume_type(array, T::ARRAY);
        let (index, one, fork) = (
            self.untag_position(position),
            self.int32(1),
            self.fork_later(),
        );
        let [mut end, mut after] = [(); 2].map(|()| Junction::default());
        let any = ArrayModes::ARRAY | ArrayModes::MIXED | (ArrayModes::STORED - ArrayModes::SPARSE);
        // Getting it must run no script.
        if self
            .next_element((array, index, any), None, &mut end)
            .is_some()
        {
            let position = self.position_after(index, one);
            self.leave_with_values(&mut after, &[position]);
        }
        if self.resume_if_reached(&fork, &end) {
            let position = self.value(IteratorRecord::DONE);
            self.leave_with_values(&mut after, &[position]);
        }
        if self.end_fork_at(&fork, &after) {
            self.set(op.state.nth(2), after.values[0]);
        }
    }
}

/// Whether the table has values, and what an iterator over it yields.
fn parts_for(mode: Mode) -> (bool, IterationKind) {
    match mode {
        Mode::MapKeys => (true, IterationKind::Keys),
        Mode::MapValues => (true, IterationKind::Values),
        Mode::MapEntries => (true, IterationKind::Entries),
        Mode::SetValues => (false, IterationKind::Keys),
        _ => (false, IterationKind::Entries),
    }
}
