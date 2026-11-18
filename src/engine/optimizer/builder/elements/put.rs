//! Stores.

use bun_engine_asm::FloatCond;
use bun_engine_bytecode::{MetadataKind, Operand};
use bun_engine_codegen::ir::{Op, Type, Unary, Value as Ssa};
use bun_engine_vm::code::metadata::ArrayAccess;
use bun_engine_vm::{ArrayModes, ElementKind, JsObject, SpeculatedType as T, Storage};

use super::typed_arrays::TypedAccess;
use super::{Access, Way, heap_for, holds_doubles};
use crate::builder::fork::Odds;
use crate::builder::{Builder, Built};
use crate::graph::{Cache, ExitKind, Kind, ModeSet, heaps};

const INT32: ModeSet = ModeSet::of_kind(ElementKind::Int32);
const DOUBLE: ModeSet = ModeSet::of_kind(ElementKind::Double);
const CONTIGUOUS: ModeSet = ModeSet::of_kind(ElementKind::Contiguous);

impl Builder<'_> {
    pub(in crate::builder) fn put_by_val(
        &mut self,
        base: Operand,
        key: Operand,
        value: Operand,
        metadata: u32,
        cache: Cache<ArrayAccess>,
    ) -> Built {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::ArrayAccess);
        let entry = (code_block.anchor()).checked_metadata::<ArrayAccess>(kind, metadata);
        let seen = entry.array.modes();
        if seen.is_empty() && !entry.cases.has_run() && !self.has_exited(ExitKind::NeverExecuted) {
            self.force_exit(ExitKind::NeverExecuted);
            return Ok(());
        }
        let operands = [self.get(base), self.get(key), self.get(value)];
        if !self.put_by_name(operands, (entry, cache), metadata)? {
            self.write_element(operands, entry, cache);
        }
        Ok(())
    }

    pub(in crate::builder) fn write_element(
        &mut self,
        [base, key, value]: [Ssa; 3],
        entry: &ArrayAccess,
        cache: Cache<ArrayAccess>,
    ) {
        let cached = |this: &mut Self| {
            this.cached(cache, entry, &[base, key, value]);
        };
        if !self.may_be_index(key) {
            return cached(self);
        }
        let seen = self.seen_of(base, entry.array.modes());
        let likely = self.likely_modes(base, seen).and(ModeSet::WRITABLE);
        let groups = self.groups_that_hold(likely, value);
        let mut ways = self.likely_ways(base, seen, &groups);
        let (count, defines) = (ways.len(), cache == Cache::PutByValDirect);
        ways.retain(|way| match *way {
            Way::Stored(_) => true,
            Way::Typed(of) => {
                self.may_become_element(of, value) && !(defines && self.may_be_outside(seen))
            }
            _ => false,
        });
        let exit = self.exit_for_other_target(seen, likely, groups);
        let exit = exit.filter(|_| ways.len() == count);
        if let ([Way::Typed(of)], Some(exit)) = (&*ways, exit) {
            let view = self.check_type_or(base, ways[0].type_of_base(), exit);
            return self.put_to_typed_array(TypedAccess::new(view, *of, key, seen), value);
        }
        let may_run_scripts = self.may_run_scripts(seen)
            || seen.contains(ArrayModes::UNUSUAL_INDEX)
            || ways.len() != count;
        if ways.is_empty() && (may_run_scripts || !seen.intersects(ArrayModes::STORED)) {
            return cached(self);
        }
        let index = self.as_index(key);
        let slowly = |this: &mut Self| {
            if may_run_scripts {
                cached(this);
            } else {
                let object = this.check_type_or(base, T::OBJECT, ExitKind::ExoticObject);
                let value = this.graph.root(value);
                this.node(Kind::StorePlainElement, &[object, index, value], 0);
            }
            None
        };
        let write = |this: &mut Self, access: &mut Access, way, object| {
            match way {
                Way::Stored(modes) => _ = this.write_stored(access, object, modes, value),
                Way::Typed(of) => {
                    let key = this.box_int32(index);
                    this.put_to_typed_array(TypedAccess::new(object, of, key, seen), value);
                }
                _ => unreachable!("left to the slow way"),
            }
            None
        };
        self.access_elements((base, index, seen), &ways, exit, write, slowly);
    }

    /// `None` if there are going to be objects that have to change before they can be written to.
    pub(super) fn exit_for_other_target(
        &self,
        seen: ArrayModes,
        likely: ModeSet,
        groups: [ModeSet; 3],
    ) -> Option<ExitKind> {
        let has_changed =
            seen.contains(ArrayModes::MIXED) || self.has_exited(ExitKind::BadElements);
        let needs_changes = likely != groups.into_iter().fold(ModeSet::NONE, ModeSet::or)
            || seen.contains(ArrayModes::SLOW_PUT)
            || seen.contains(ArrayModes::COPY_ON_WRITE) && has_changed;
        self.exit_for_other_base(seen).filter(|_| !needs_changes)
    }

    pub(super) fn may_count_on(&self, value: Ssa, ty: T) -> bool {
        self.is(value, ty)
            || ty.contains(self.expected(value)) && !self.has_exited(ExitKind::BadType)
    }

    /// Those of the modes that have a chance of representing the value.
    pub(super) fn groups_that_hold(&self, modes: ModeSet, value: Ssa) -> [ModeSet; 3] {
        let expected = self.expected(value);
        let if_it_may_be = |ty: T, kind| {
            if expected.is_empty() || expected.intersects(ty) {
                modes.and(kind)
            } else {
                ModeSet::NONE
            }
        };
        let doubles = if_it_may_be(T::INT32 | T::REAL_DOUBLE, DOUBLE);
        if !expected.is_empty() && self.may_count_on(value, T::INT32) {
            [modes.and(ModeSet::VALUES), doubles, ModeSet::NONE]
        } else {
            [
                modes.and(CONTIGUOUS),
                doubles,
                if_it_may_be(T::INT32, INT32),
            ]
        }
    }

    /// What goes into the vector.
    fn represent(&mut self, access: &mut Access, modes: ModeSet, value: Ssa) -> Ssa {
        if CONTIGUOUS.contains(modes) {
            return self.graph.root(value);
        }
        let needed = if holds_doubles(modes) {
            T::BOXED_NUMBER
        } else {
            T::INT32
        };
        if !self.may_count_on(value, needed) {
            let fits = self.is_type(value, needed);
            self.leave_unless(fits, Odds::Low, &mut access.slow);
        }
        if !holds_doubles(modes) {
            let int32 = self.as_int32(value);
            return self.box_int32(int32);
        }
        let number = self.as_double(value);
        let is_nan = (self.ir()).float_compare(FloatCond::Unordered, number, number);
        let is_expected = self.expected(value).intersects(T::PURE_NAN);
        self.bail_if(access, is_nan, ExitKind::NotANumber, is_expected);
        number
    }

    pub(super) fn make_room(&mut self, object: Ssa, storage: Ssa, index: Ssa) -> Ssa {
        let storage = self.node(Kind::MakeRoom, &[object, storage, index], 0);
        let (root, offset) = (self.graph.root(object), JsObject::OFFSET_OF_STORAGE as i32);
        (self.knowledge).learn_field(root, offset, heaps::STORAGE, storage);
        storage
    }

    /// Gives the new length.
    pub(super) fn write_stored(
        &mut self,
        access: &mut Access,
        object: Ssa,
        modes: ModeSet,
        value: Ssa,
    ) -> Ssa {
        let (stored, mut index) = (self.represent(access, modes, value), access.index);
        let mut storage = self.storage(object);
        let mut length = self.dense_length(storage);
        if !access.seen.contains(ArrayModes::HOLE) && !self.may_be_outside(access.seen) {
            index = self.check_bounds(index, length);
        } else {
            if access.seen.contains(ArrayModes::UNUSUAL_INDEX)
                || self.has_exited(ExitKind::StoreToHole)
            {
                let offset = Storage::OFFSET_OF_VECTOR_LENGTH as i32;
                let room = self.load(Type::I32, storage, offset, heaps::VECTOR_LENGTH);
                let is_past = self.ir().above_or_equal(index, room);
                self.leave_if(is_past, Odds::Low, &mut access.slow);
            } else {
                storage = self.make_room(object, storage, index);
            }
            let mut ir = self.ir();
            let next = ir.add(index, 1);
            let without_bound = |value| match *ir.op(value) {
                Op::Unary(Unary::FitsIn(_), operand) => operand,
                _ => value,
            };
            length = if without_bound(index) == without_bound(length) {
                next
            } else {
                let is_past = ir.above_or_equal(index, length);
                ir.select(is_past, next, length)
            };
            let offset = Storage::OFFSET_OF_PUBLIC_LENGTH as i32;
            self.store_into(object, storage, offset, heaps::PUBLIC_LENGTH, length);
        }
        let address = self.element_address(storage, index);
        (self.knowledge).note_write_to(&self.graph, object, heap_for(modes));
        self.ir().store(stored, address, 0, heap_for(modes));
        self.note_effect_on(object);
        if let Some(index) = self.graph.function.int_constant(access.index) {
            self.learn_element(object, modes, index, stored);
        }
        if CONTIGUOUS.contains(modes) {
            self.barrier(object, stored);
        }
        length
    }
}
