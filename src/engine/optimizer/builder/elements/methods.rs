//! Methods of arrays.

use bun_engine_asm::FloatCond;
use bun_engine_codegen::ir::{State, Type, Value as Ssa};
use bun_engine_vm::{
    ArrayModes, ElementKind, Intrinsic, JsFunction, RealmWatchpoint, SpeculatedType as T, Storage,
};
use smallvec::SmallVec;

use super::get::readable;
use super::{Access, Way, heap_for, holds_doubles, holds_int32s};
use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::builder::frame::Junction;
use crate::graph::{ExitKind, Kind, ModeSet, Search, heaps};

const WRITABLE_ARRAY: ModeSet = ModeSet::ARRAY.and(ModeSet::WRITABLE);
const DOUBLE: ModeSet = ModeSet::of_kind(ElementKind::Double);
const ANY_ARRAY: ArrayModes = ArrayModes::STORED
    .difference(ArrayModes::NO_ELEMENTS)
    .union(ArrayModes::ARRAY)
    .union(ArrayModes::NON_ORIGINAL_ARRAY_SHAPE)
    .union(ArrayModes::MIXED);
/// Equal to nothing but the value with the same bits.
const BY_IDENTITY: T = T::OBJECT.union(T::SYMBOL).union(T::BOOLEAN).union(T::NULL);

impl Builder<'_> {
    pub(in crate::builder) fn array_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        let (&this, arguments) = site.arguments.split_first()?;
        match (which, arguments) {
            (Intrinsic::ArrayIsArray, &[value, ..]) => self.is_array(value),
            (Intrinsic::ArrayPush, &[value]) => self.push(this, value),
            (Intrinsic::ArrayPush, [_, _, ..]) => self.push_all(this, arguments),
            (Intrinsic::ArrayPop, _) => self.pop(this, site.metadata),
            (Intrinsic::ArrayShift, _) => {
                let array = self.exact_array(this)?;
                let modes = self.knowledge.modes_of(&self.graph, array);
                let kind = if ModeSet::WRITABLE.contains(modes) {
                    Kind::ShiftWritable
                } else {
                    Kind::Shift
                };
                Some(self.profiled_result(kind, &[array], site.metadata))
            }
            (Intrinsic::ArrayUnshift, &[value]) => {
                let operands = [self.exact_array(this)?, self.graph.root(value)];
                let length = self.node(Kind::Unshift, &operands, 0);
                Some(self.box_int32(length))
            }
            (Intrinsic::ArrayIndexOf, &[needle, ..]) => {
                let index = self.search(this, needle, arguments.get(1), Search::IndexOf)?;
                Some(self.box_int32(index))
            }
            (Intrinsic::ArrayIncludes, &[needle, ..]) => {
                let index = self.search(this, needle, arguments.get(1), Search::Includes)?;
                let is_found = self.ir().greater_or_equal(index, 0);
                Some(self.box_boolean(is_found))
            }
            (Intrinsic::ArraySlice, _) if self.is_of_this_realm(site.callee) => {
                self.slice(this, arguments)
            }
            (Intrinsic::ArraySplice, [start, rest @ ..]) if self.is_of_this_realm(site.callee) => {
                self.splice(this, *start, rest)
            }
            _ => None,
        }
    }

    pub(in crate::builder) fn has_own_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        let (object, key) = match (which, site.arguments) {
            (Intrinsic::HasOwnProperty, &[object, key, ..])
            | (Intrinsic::ObjectHasOwn, &[_, object, key, ..]) => (object, key),
            _ => return None,
        };
        let expected = self.expected(key);
        if !T::OBJECT.contains(self.expected(object))
            || !expected.is_empty() && T::OBJECT.contains(expected)
        {
            return None;
        }
        let operands = [
            self.check_type_or(object, T::OBJECT, ExitKind::ExoticObject),
            self.alias(key),
        ];
        let known = (self.graph).intern_type(self.knowledge.type_of(&self.graph, key));
        let answer = self.node(Kind::HasOwn, &operands, known);
        Some(self.box_boolean(answer))
    }

    /// What it makes has the shapes of its own realm.
    pub(in crate::builder) fn is_of_this_realm(&self, callee: Ssa) -> bool {
        (self.constant_cell::<JsFunction>(callee))
            .is_some_and(|it| it.realm() == Some(self.global()))
    }

    fn profiled_result(&mut self, kind: Kind, operands: &[Ssa], metadata: u32) -> Ssa {
        let result = self.node(kind, operands, 0);
        self.profile_result(result, metadata)
    }

    fn exact_array(&mut self, value: Ssa) -> Option<Ssa> {
        (self.is(value, T::ARRAY) || T::ARRAY.contains(self.expected(value)))
            .then(|| self.check_type_or(value, T::ARRAY, ExitKind::ExoticObject))
    }

    /// What a profile would have to say, if there were one. `None` unless it is likely to be an array.
    fn seen_of_receiver(&mut self, this: Ssa) -> Option<ArrayModes> {
        let seen = self.seen_of(this, ArrayModes::empty());
        if !seen.intersects(ArrayModes::STORED) {
            let is_likely = self.is(this, T::ARRAY) || self.expected(this) == T::ARRAY;
            return is_likely.then_some(ANY_ARRAY);
        }
        let usual = ANY_ARRAY | ArrayModes::COPY_ON_WRITE | ArrayModes::SLOW_PUT;
        (usual.contains(seen) && !self.is(this, !T::ARRAY)).then_some(seen)
    }

    fn is_array(&mut self, value: Ssa) -> Option<Ssa> {
        if self.expected(value).intersects(T::PROXY) {
            return None;
        }
        self.check_type_or(value, !T::PROXY, ExitKind::ExoticObject);
        let answer = self.is_type(value, T::ARRAY | T::DERIVED_ARRAY);
        Some(self.box_boolean(answer))
    }

    fn push(&mut self, this: Ssa, value: Ssa) -> Option<Ssa> {
        let seen = self.seen_of_receiver(this)? | ArrayModes::HOLE;
        let likely = self.likely_modes(this, seen).and(WRITABLE_ARRAY);
        let groups = self.groups_that_hold(likely, value);
        let ways = self.likely_ways_for_array(this, seen, &groups);
        let exit = self.exit_for_other_target(seen, likely, groups);
        let slowly = |builder: &mut Self| {
            let array = builder.check_type_or(this, T::ARRAY, ExitKind::ExoticObject);
            let operands = [array, builder.graph.root(value)];
            let length = builder.node(Kind::Push, &operands, 0);
            Some(builder.box_int32(length))
        };
        let append = |builder: &mut Self, access: &mut Access, way, array| {
            let Way::Stored(modes) = way else {
                unreachable!("an array")
            };
            let storage = builder.storage(array);
            access.index = builder.dense_length(storage);
            let length = builder.write_stored(access, array, modes, value);
            Some(builder.box_int32(length))
        };
        self.access_elements((this, Ssa::NONE, seen), &ways, exit, append, slowly)
    }

    fn push_all(&mut self, this: Ssa, values: &[Ssa]) -> Option<Ssa> {
        let failures = [ExitKind::BadElements, ExitKind::StoreToHole];
        let seen = self.seen_of_receiver(this)?;
        let modes = self.likely_modes(this, seen).and(WRITABLE_ARRAY);
        let kind = modes.only_kind()?;
        if failures.into_iter().any(|it| self.has_exited(it)) || self.kind_for(kind, values) != kind
        {
            return None;
        }
        self.check_type_or(this, T::CELL, ExitKind::BadElements);
        let array = self.check_stored(this, modes, seen, true, ExitKind::BadElements);
        let elements: SmallVec<[Ssa; 4]> =
            values.iter().map(|&it| self.as_element(kind, it)).collect();
        let storage = self.storage(array);
        let length = self.dense_length(storage);
        let last = self.ir().add(length, values.len() - 1);
        let storage = self.make_room(array, storage, last);
        let new_length = self.ir().add(last, 1);
        let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
        self.store_into(array, storage, offset, heaps::PUBLIC_LENGTH, new_length);
        let first = self.element_address(storage, length);
        (self.knowledge).note_write_to(&self.graph, array, heap_for(modes));
        for (&element, index) in elements.iter().zip(0..) {
            (self.ir()).store(element, first, index * 8, heap_for(modes));
        }
        if kind == ElementKind::Contiguous {
            self.insert_node(Kind::StoreBarrier, &[array], 0, State::NONE);
        }
        Some(self.box_int32(new_length))
    }

    fn pop(&mut self, this: Ssa, metadata: u32) -> Option<Ssa> {
        let seen = self.seen_of_receiver(this)?;
        let likely = self.likely_modes(this, seen).and(WRITABLE_ARRAY);
        let groups = [
            likely.and(ModeSet::VALUES),
            likely.and(DOUBLE),
            ModeSet::NONE,
        ];
        let ways = self.likely_ways_for_array(this, seen, &groups);
        let exit = self.exit_for_other_target(seen, likely, groups);
        let slowly = |builder: &mut Self| {
            let array = builder.check_type_or(this, T::ARRAY, ExitKind::ExoticObject);
            Some(builder.profiled_result(Kind::Pop, &[array], metadata))
        };
        let take = |builder: &mut Self, access: &mut Access, way, array| {
            let Way::Stored(modes) = way else {
                unreachable!("an array")
            };
            Some(builder.take_last(access, array, modes, metadata))
        };
        self.access_elements((this, Ssa::NONE, seen), &ways, exit, take, slowly)
    }

    fn take_last(&mut self, access: &mut Access, array: Ssa, modes: ModeSet, metadata: u32) -> Ssa {
        let (storage, seen) = (self.storage(array), self.prediction_at(metadata));
        let (length, mut empty) = (self.dense_length(storage), Junction::default());
        access.index = self.ir().sub(length, 1);
        (access.seen).set(ArrayModes::OUT_OF_BOUNDS, seen.intersects(T::UNDEFINED));
        let last = self.index_below(access, length, &mut empty);
        let (address, heap) = (self.element_address(storage, last), heap_for(modes));
        let (value, hole) = if holds_doubles(modes) {
            let number = self.ir().load(Type::F64, address, 0, readable(heap));
            let is_hole = (self.ir()).float_compare(FloatCond::Unordered, number, number);
            self.bail_if(access, is_hole, ExitKind::LoadFromHole, false);
            let hole = ElementKind::Double.hole();
            let hole = self.graph.function.constant(Type::F64, hole);
            (self.box_element(number), hole)
        } else {
            let value = self.ir().load(Type::I64, address, 0, readable(heap));
            let is_hole = self.ir().is_zero(value);
            self.bail_if(access, is_hole, ExitKind::LoadFromHole, false);
            let value = if holds_int32s(modes) {
                let int32 = self.ir().wrap(value);
                self.box_int32(int32)
            } else {
                self.graph.predict(value, seen);
                self.note_profile(value, metadata);
                self.assume_type(value, T::HEAP_TOP);
                value
            };
            (value, self.empty())
        };
        (self.knowledge).note_write_to(&self.graph, array, heap);
        self.ir().store(hole, address, 0, heap);
        let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
        self.store_into(array, storage, offset, heaps::PUBLIC_LENGTH, last);
        if empty.edges.is_empty() {
            return value;
        }
        self.end_way(&mut access.fork, Some(value));
        self.resume_at(&access.fork, &empty);
        self.undefined()
    }

    /// Whether `relative_index` is worth trying.
    fn may_be_relative_index(&self, argument: Option<&Ssa>) -> bool {
        argument.is_none_or(|&it| self.is(it, T::UNDEFINED) || self.may_be_index(it))
    }

    /// Counts from the end if it is negative, and is neither negative nor above the length.
    fn relative_index(&mut self, argument: Option<&Ssa>, length: Ssa, default: Ssa) -> Ssa {
        let Some(&argument) = argument.filter(|&&it| !self.is(it, T::UNDEFINED)) else {
            return default;
        };
        let (index, zero) = (self.as_index(argument), self.int32(0));
        let mut ir = self.ir();
        let constant = ir.int_constant(index);
        let mut from_start = index;
        if constant.is_none_or(|it| it > 0) {
            let is_past = ir.greater_than(index, length);
            from_start = ir.select(is_past, length, index);
        }
        if constant.is_some_and(|it| it >= 0) {
            return from_start;
        }
        let from_end = ir.add(index, length);
        let (is_before, is_negative) = (ir.less_than(from_end, 0), ir.less_than(index, 0));
        let from_end = ir.select(is_before, zero, from_end);
        ir.select(is_negative, from_end, from_start)
    }

    /// An array with elements of one of the likely kinds, in which a hole means that there is no such property.
    fn plain_array(&mut self, this: Ssa, kinds: ModeSet) -> Option<(Ssa, ModeSet)> {
        let failures = [ExitKind::BadElements, ExitKind::LoadFromHole];
        let seen = self.seen_of_receiver(this)?;
        let modes = if kinds.contains(ModeSet::UNDECIDED) {
            let groups = self.groups_to_read(this, seen);
            groups.into_iter().fold(ModeSet::NONE, ModeSet::or)
        } else {
            self.likely_modes(this, seen)
        };
        let modes = modes.and(ModeSet::ARRAY);
        if modes == ModeSet::NONE
            || !kinds.contains(modes)
            || failures.into_iter().any(|it| self.has_exited(it))
        {
            return None;
        }
        self.check_type_or(this, T::CELL, ExitKind::BadElements);
        let array = self.check_stored(this, modes, seen, true, ExitKind::BadElements);
        if !self.inherits_no_elements(array) {
            let is_unknown = self.may_inherit_elements(array);
            self.exit_if(is_unknown, ExitKind::LoadFromHole);
        }
        Some((array, modes))
    }

    /// Gives an I32, which is negative if there is no such element.
    fn search(&mut self, this: Ssa, needle: Ssa, from: Option<&Ssa>, how: Search) -> Option<Ssa> {
        if !self.may_be_relative_index(from) {
            return None;
        }
        let is_likely = |ty| !self.expected(needle).is_empty() && self.may_count_on(needle, ty);
        let by_bits = if is_likely(T::INT32) {
            Some((T::INT32, ModeSet::of_kind(ElementKind::Int32)))
        } else {
            is_likely(BY_IDENTITY).then_some((BY_IDENTITY, ModeSet::VALUES))
        };
        if let Some((ty, kinds)) = by_bits
            && let Some((array, _)) = self.plain_array(this, kinds.or(ModeSet::UNDECIDED))
        {
            let word = if ty == T::INT32 {
                let int32 = self.as_int32(needle);
                self.box_int32(int32)
            } else {
                self.check_type(needle, ty);
                self.graph.root(needle)
            };
            let (storage, zero) = (self.storage(array), self.int32(0));
            let length = self.dense_length(storage);
            let start = self.relative_index(from, length, zero);
            return Some(self.node(Kind::FindWord, &[storage, start, length, word], 0));
        }
        let array = self.exact_array(this)?;
        let from = match from.filter(|&&it| !self.is(it, T::UNDEFINED)) {
            Some(&from) => self.as_index(from),
            None => self.int32(0),
        };
        let operands = [array, self.graph.root(needle), from];
        Some(self.node(Kind::FindElement, &operands, how as u32))
    }

    fn slice(&mut self, this: Ssa, arguments: &[Ssa]) -> Option<Ssa> {
        let (start, end) = (arguments.first(), arguments.get(1));
        if !self.may_be_relative_index(start)
            || !self.may_be_relative_index(end)
            || !self.watch_realm(RealmWatchpoint::ArraySpecies)
        {
            return None;
        }
        if let Some(copy) = self.slice_known_arguments(this, start, end) {
            return Some(copy);
        }
        let has_elements = ModeSet::VALUES.or(DOUBLE);
        let seen = self.seen_of_receiver(this);
        if seen.is_some_and(|it| !it.contains(ArrayModes::NON_ORIGINAL_ARRAY_SHAPE))
            && !self.has_exited(ExitKind::BadShape)
            && self.likely_modes(this, seen?).only_kind().is_some()
            && let Some((array, modes)) = self.plain_array(this, has_elements)
        {
            let array = self.check_original_array(array);
            let (storage, zero) = (self.storage(array), self.int32(0));
            let length = self.dense_length(storage);
            let start = self.relative_index(start, length, zero);
            let end = self.relative_index(end, length, length);
            let mut ir = self.ir();
            let (count, is_empty) = (ir.sub(end, start), ir.less_than(end, start));
            let count = ir.select(is_empty, zero, count);
            let first = self.element_address(storage, start);
            return Some(self.copy_elements(array, modes.only_kind()?, first, count));
        }
        if !T::OBJECT.contains(self.expected(this)) {
            return None;
        }
        let object = self.check_type_or(this, T::OBJECT, ExitKind::ExoticObject);
        let [start, end] = [(start, 0), (end, i32::MAX)].map(|(argument, default)| match argument
            .filter(|&&it| !self.is(it, T::UNDEFINED))
        {
            Some(&argument) => self.as_index(argument),
            None => self.int32(default),
        });
        Some(self.node(Kind::Slice, &[object, start, end], 0))
    }

    fn slice_known_arguments(
        &mut self,
        this: Ssa,
        start: Option<&Ssa>,
        end: Option<&Ssa>,
    ) -> Option<Ssa> {
        let values = (!self.is(this, T::ARRAY)).then(|| self.known_arguments(this))??;
        let position = |argument: Option<&Ssa>, default| match argument {
            Some(&it) if !self.is(it, T::UNDEFINED) => {
                let index = self.constant_value(it)?.as_int32()? as isize;
                let from = if index < 0 { values.len() } else { 0 };
                Some(from.saturating_add_signed(index).min(values.len()))
            }
            _ => Some(default),
        };
        let (start, end) = (position(start, 0)?, position(end, values.len())?);
        Some(self.array_of(ElementKind::Contiguous, &values[start..end.max(start)], 0))
    }

    fn splice(&mut self, this: Ssa, start: Ssa, rest: &[Ssa]) -> Option<Ssa> {
        let (count, items) = (rest.first(), rest.get(1..).unwrap_or_default());
        if !self.may_be_index(start)
            || !count.is_none_or(|&it| self.may_be_index(it))
            || !self.watch_realm(RealmWatchpoint::ArraySpecies)
        {
            return None;
        }
        let (array, start) = (self.exact_array(this)?, self.as_index(start));
        let count = match count {
            Some(&count) => self.as_index(count),
            None => self.int32(i32::MAX),
        };
        let mut operands: SmallVec<[Ssa; 6]> = smallvec::smallvec![array, start, count];
        operands.extend(items.iter().map(|&it| self.graph.root(it)));
        Some(self.node(Kind::Splice, &operands, 0))
    }
}
