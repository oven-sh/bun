//! Loads, and `in`.

use bun_engine_asm::FloatCond;
use bun_engine_bytecode::{MetadataKind, op};
use bun_engine_codegen::ir::{self, AccessFlags, Heap, Type, Value as Ssa};
use bun_engine_vm::code::metadata::{ArrayAccess, GetByVal};
use bun_engine_vm::{
    ArrayModes, CellType, Environment, Gc, JsObject, MappedArguments, RealmWatchpoint, Shape,
    SpeculatedType as T, Value, Vm,
};
use smallvec::SmallVec;

use super::typed_arrays::TypedAccess;
use super::{Access, Way, heap_for, holds_doubles, holds_int32s};
use crate::builder::fork::Odds;
use crate::builder::frame::Junction;
use crate::builder::{Builder, Built};
use crate::graph::{Cache, ExitKind, Kind, ModeSet, ShapeSet, heaps};

#[derive(Clone, Copy)]
pub(super) enum Wanted {
    /// With what it has been so far, and the metadata of the instruction.
    Value(T, u32),
    Presence,
}

pub(super) fn readable(heap: Heap) -> ir::Access {
    ir::Access::new(heap, AccessFlags::ALWAYS_READABLE)
}

impl Builder<'_> {
    pub(in crate::builder) fn get_by_val(&mut self, op: op::GetByVal) -> Built {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::GetByVal);
        let entry = (code_block.anchor()).checked_metadata::<GetByVal>(kind, op.metadata);
        let Some(prediction) = self.prediction_or_exit(op.metadata) else {
            return Ok(());
        };
        let (base, key) = (self.get(op.base), self.get(op.key));
        if self.get_by_name(op.dst, [base, key], entry, op.metadata)? {
            return Ok(());
        }
        let result = self.get_element([base, key], &entry.access, (prediction, op.metadata));
        result.inspect(|&result| self.set(op.dst, result));
        Ok(())
    }

    pub(in crate::builder) fn in_by_val(&mut self, op: op::InByVal) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::ArrayAccess);
        let entry = (code_block.anchor()).checked_metadata::<ArrayAccess>(kind, op.metadata);
        let (base, key) = (self.get(op.base), self.get(op.key));
        let cached = |this: &mut Self| Some(this.cached_test(Cache::InByVal, entry, &[base, key]));
        let result = if self.has_exited(ExitKind::BadType) && !self.is(base, T::OBJECT) {
            cached(self)
        } else {
            self.check_type(base, T::OBJECT);
            self.read_element(base, key, entry.array.modes(), Wanted::Presence, cached)
        };
        result.inspect(|&result| self.set(op.dst, result));
    }

    pub(in crate::builder) fn get_element(
        &mut self,
        [base, key]: [Ssa; 2],
        entry: &ArrayAccess,
        (prediction, metadata): (T, u32),
    ) -> Option<Ssa> {
        let wanted = Wanted::Value(prediction, metadata);
        self.read_element(base, key, entry.array.modes(), wanted, |this| {
            this.cached_load(Cache::GetByVal, entry, &[base, key], metadata)
        })
    }

    fn read_element(
        &mut self,
        base: Ssa,
        key: Ssa,
        seen: ArrayModes,
        wanted: Wanted,
        cached: impl FnOnce(&mut Self) -> Option<Ssa>,
    ) -> Option<Ssa> {
        if !self.may_be_index(key) {
            return cached(self);
        }
        let mut seen = self.seen_of(base, seen);
        if self.is_in_inlined_builtin() {
            seen -= ArrayModes::HOLE | ArrayModes::OUT_OF_BOUNDS;
        }
        let groups = self.groups_to_read(base, seen);
        let (ways, exit) = (
            self.likely_ways(base, seen, &groups),
            self.exit_for_other_base(seen),
        );
        // What has holes serves as a table, whose elements may well become sparse.
        let exit = exit.filter(|_| !seen.contains(ArrayModes::HOLE));
        if let ([Way::Typed(of)], Some(exit)) = (&*ways, exit) {
            let view = self.check_type_or(base, ways[0].type_of_base(), exit);
            return self.read_typed(TypedAccess::new(view, *of, key, seen), wanted);
        }
        let may_run_scripts = self.may_run_scripts(seen)
            || seen.contains(ArrayModes::STRING | ArrayModes::UNUSUAL_INDEX);
        if ways.is_empty() && (may_run_scripts || !seen.contains(ArrayModes::SPARSE)) {
            return cached(self);
        }
        let index = self.as_index(key);
        let slowly = |this: &mut Self| {
            if may_run_scripts {
                return cached(this);
            }
            Some(this.look_up_element(base, index, wanted))
        };
        let read = |this: &mut Self, access: &mut Access, way, object| match way {
            Way::Stored(modes) => this.read_stored(access, object, modes, wanted),
            Way::Typed(of) => {
                let key = this.box_int32(index);
                this.read_typed(TypedAccess::new(object, of, key, seen), wanted)
            }
            Way::Array => unreachable!("not for elements"),
            Way::String => this.read_string(access, object),
            Way::DirectArguments | Way::ScopedArguments => {
                Some(this.read_arguments(access, object, way, wanted))
            }
        };
        self.access_elements((base, index, seen), &ways, exit, read, slowly)
    }

    fn read_typed(&mut self, access: TypedAccess, wanted: Wanted) -> Option<Ssa> {
        match wanted {
            Wanted::Value(prediction, _) => self.get_from_typed_array(access, prediction),
            Wanted::Presence => self.is_in_typed_array(access),
        }
    }

    fn nothing(&mut self, wanted: Wanted) -> Ssa {
        self.value(match wanted {
            Wanted::Value(..) => Value::UNDEFINED,
            Wanted::Presence => Value::FALSE,
        })
    }

    fn profile_element(&mut self, value: Ssa, wanted: Wanted) {
        if let Wanted::Value(prediction, metadata) = wanted {
            self.graph.predict(value, prediction);
            self.note_profile(value, metadata);
        }
    }

    pub(super) fn look_up_element(&mut self, base: Ssa, index: Ssa, wanted: Wanted) -> Ssa {
        let object = self.check_type_or(base, T::OBJECT, ExitKind::ExoticObject);
        if let Wanted::Presence = wanted {
            return self.node(Kind::HasElement, &[object, index], 0);
        }
        let value = self.node(Kind::LookUpElement, &[object, index], 0);
        self.profile_element(value, wanted);
        value
    }

    /// The index, to load by way of. Goes to `outside` if it is not below the length, or else exits.
    pub(super) fn index_below(
        &mut self,
        access: &Access,
        length: Ssa,
        outside: &mut Junction,
    ) -> Ssa {
        if !access.is_inside {
            if !self.may_be_outside(access.seen) {
                return self.check_bounds(access.index, length);
            }
            let is_outside = self.ir().above_or_equal(access.index, length);
            self.leave_if(is_outside, Odds::Low, outside);
        }
        self.node(Kind::InBounds, &[access.index], 0)
    }

    pub(super) fn read_stored(
        &mut self,
        access: &mut Access,
        object: Ssa,
        modes: ModeSet,
        wanted: Wanted,
    ) -> Option<Ssa> {
        if ModeSet::EMPTY.contains(modes) {
            self.bail_if_negative(access);
            self.bail_if_inherited(access, object);
            return Some(self.nothing(wanted));
        }
        if let Some(index) = self.graph.function.int_constant(access.index) {
            if let Some(value) = self.shared_element(object, index) {
                let value = self.value(value);
                return Some(self.found(value, wanted));
            }
            if let Some(mut known) = self.known_element(object, modes, index) {
                if holds_doubles(modes) {
                    known = self.box_element(known);
                }
                return Some(self.found(known, wanted));
            }
        }
        let storage = self.storage(object);
        let (length, mut missing) = (self.dense_length(storage), Junction::default());
        let index = self.index_below(access, length, &mut missing);
        let may_be_outside = !missing.edges.is_empty();
        let may_be_missing = may_be_outside
            || access.seen.contains(ArrayModes::HOLE)
            || self.has_exited(ExitKind::LoadFromHole);
        let address = self.element_address(storage, index);
        let place = readable(heap_for(modes));
        let (found, is_hole);
        if holds_doubles(modes) {
            let number = self.ir().load(Type::F64, address, 0, place);
            is_hole = (self.ir()).float_compare(FloatCond::Unordered, number, number);
            found = self.box_element(number);
        } else {
            let value = self.ir().load(Type::I64, address, 0, place);
            self.profile_element(value, wanted);
            if holds_int32s(modes) {
                self.graph.declare(value, T::INT32 | T::EMPTY);
                self.graph.predict(value, T::INT32);
            } else if !may_be_missing {
                let value = self.check_type_or(value, T::HEAP_TOP, ExitKind::LoadFromHole);
                return Some(self.found(value, wanted));
            }
            is_hole = self.ir().is_zero(value);
            found = if may_be_missing {
                value
            } else {
                let int32 = self.ir().wrap(value);
                self.box_int32(int32)
            };
        }
        if !may_be_missing {
            self.exit_if(is_hole, ExitKind::LoadFromHole);
            return Some(self.found(found, wanted));
        }
        if !may_be_outside && !holds_doubles(modes) && self.inherits_no_elements(object) {
            return Some(self.unless_hole(found, is_hole, wanted));
        }
        self.leave_if(is_hole, Odds::Low, &mut missing);
        self.assume_type(found, T::HEAP_TOP);
        let found = self.found(found, wanted);
        self.end_way(&mut access.fork, Some(found));
        self.resume_at(&access.fork, &missing);
        if may_be_outside {
            self.bail_if_negative(access);
        }
        let object = self.alias(object);
        self.bail_if_inherited(access, object);
        Some(self.nothing(wanted))
    }

    fn found(&mut self, value: Ssa, wanted: Wanted) -> Ssa {
        match wanted {
            Wanted::Value(..) => value,
            Wanted::Presence => self.value(Value::TRUE),
        }
    }

    fn unless_hole(&mut self, value: Ssa, is_hole: Ssa, wanted: Wanted) -> Ssa {
        if let Wanted::Presence = wanted {
            let is_there = self.ir().is_not_zero(value);
            return self.box_boolean(is_there);
        }
        let undefined = self.undefined();
        let result = self.ir().select(is_hole, undefined, value);
        let types = (self.graph.inherent_type(value) - T::EMPTY) | T::UNDEFINED;
        self.graph.declare(result, types);
        (self.graph).predict(result, self.graph.prediction(value) | T::UNDEFINED);
        result
    }

    /// That makes it a name like any other.
    fn bail_if_negative(&mut self, access: &mut Access) {
        let is_negative = self.ir().less_than(access.index, 0);
        let is_expected = access.seen.contains(ArrayModes::UNUSUAL_INDEX);
        self.bail_if(access, is_negative, ExitKind::NegativeIndex, is_expected);
    }

    /// For ordinary objects of that type: the prototype, if neither it nor its prototypes have elements.
    fn prototype_without_elements(&mut self, cell_type: CellType) -> Option<Gc<JsObject>> {
        let global = self.global();
        let (prototype, which) = match cell_type {
            CellType::Array => (
                global.array_prototype(),
                RealmWatchpoint::ArrayPrototypeChainIsSane,
            ),
            CellType::FinalObject => (
                global.object_prototype(),
                RealmWatchpoint::ObjectPrototypeChainIsSane,
            ),
            _ => return None,
        };
        self.watch_realm(which).then_some(prototype)
    }

    /// Whether that is certain. The elements are not sparse.
    pub(in crate::builder) fn inherits_no_elements(&mut self, object: Ssa) -> bool {
        let shapes = self.knowledge.shapes_of(&mut self.graph, object);
        if shapes == ShapeSet::ANY {
            return false;
        }
        let members: SmallVec<[_; 4]> = self.graph.shapes.members(shapes).into();
        members.into_iter().all(|member| {
            let shape = self.shape_at(member);
            let prototype = self.prototype_without_elements(shape.instance_type());
            !shape.is_dictionary()
                && prototype.is_some_and(|it| shape.prototype_object().is_none_or(|own| own == it))
        })
    }

    fn bail_if_inherited(&mut self, access: &mut Access, object: Ssa) {
        if self.inherits_no_elements(object) {
            return;
        }
        let is_unknown = self.may_inherit_elements(object);
        self.leave_if(is_unknown, Odds::Low, &mut access.slow);
    }

    /// An I32.
    pub(super) fn may_inherit_elements(&mut self, object: Ssa) -> Ssa {
        let id = self.node(Kind::LoadShapeId, &[object], 0);
        let vm = self.graph.function.pinned(bun_engine_asm::abi::VM);
        let base = self.load_immutable(Type::I64, vm, Vm::OFFSET_OF_SHAPE_BASE);
        let (offset, heap) = (
            Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH,
            heaps::WATCHPOINT_STATES,
        );
        let now = self.load(Type::I64, vm, offset as i32, heap);
        let mut ir = self.ir();
        let id = ir.zero_extend(id);
        let shape = ir.add(base, id);
        let offset = Shape::OFFSET_OF_OWN_ELEMENTS_EPOCH as i32;
        let looked_into = ir.load(Type::I64, shape, offset, heaps::SIDE_STATE);
        ir.not_equal(looked_into, now)
    }

    fn read_string(&mut self, access: &mut Access, string: Ssa) -> Option<Ssa> {
        let (length, mut outside) = (self.string_length(string), Junction::default());
        let index = self.index_below(access, length, &mut outside);
        let string = self.resolve_rope(string);
        let unit = self.node(Kind::StringUnitAt, &[string, index], 0);
        let found = self.node(Kind::StringFromUnit, &[unit], 0);
        if outside.edges.is_empty() {
            return Some(found);
        }
        self.end_way(&mut access.fork, Some(found));
        self.resume_at(&access.fork, &outside);
        self.bail_if_negative(access);
        if !self.watch_realm(RealmWatchpoint::StringPrototypeChainIsSane) {
            let always = self.int32(1);
            self.leave_if(always, Odds::Low, &mut access.slow);
        }
        Some(self.undefined())
    }

    pub(in crate::builder) fn unit_at(&mut self, string: Ssa, index: Ssa) -> Ssa {
        let string = self.check_type_or(string, T::STRING, ExitKind::BadElements);
        let index = self.as_index(index);
        if self.graph.function.is_int_constant(index, 0)
            && let Some(unit) = self.only_unit(string)
        {
            return unit;
        }
        let length = self.string_length(string);
        let index = self.check_bounds(index, length);
        let string = self.resolve_rope(string);
        self.node(Kind::StringUnitAt, &[string, index], 0)
    }

    pub(in crate::builder) fn resolve_rope(&mut self, string: Ssa) -> Ssa {
        let resolved = T::ATOM_STRING | T::RESOLVED_STRING;
        if self.is(string, resolved) {
            return string;
        }
        let alias = self.node(Kind::ResolveRope, &[string], 0);
        let known = self.knowledge.entry(&self.graph, self.graph.root(string));
        (known.ty, known.alias) = (resolved, alias);
        alias
    }

    fn read_arguments(
        &mut self,
        access: &mut Access,
        object: Ssa,
        way: Way,
        wanted: Wanted,
    ) -> Ssa {
        let offset = MappedArguments::OFFSET_OF_PLAIN_LENGTH as i32;
        let length = self.load(Type::I32, object, offset, heaps::OTHER_FIELDS);
        let mut slow = core::mem::take(&mut access.slow);
        let index = self.index_below(access, length, &mut slow);
        access.slow = slow;
        if let Wanted::Presence = wanted {
            return self.value(Value::TRUE);
        }
        let slots = MappedArguments::OFFSET_OF_SLOTS as i32;
        if let Some(index) = self.graph.function.int_constant(index)
            && let (Way::DirectArguments, Wanted::Value(seen, _)) = (way, wanted)
        {
            let place = (object, slots + index as i32 * 8, heaps::ARGUMENT_SLOTS);
            return self.load_value_of_type(place, seen, T::HEAP_TOP);
        }
        let value = if way == Way::DirectArguments {
            let address = self.element_address(object, index);
            let place = readable(heaps::ARGUMENT_SLOTS);
            self.ir().load(Type::I64, address, slots, place)
        } else {
            let parameters =
                self.load_immutable(Type::I32, object, MappedArguments::OFFSET_OF_PARAMETERS);
            let scope = self.load_immutable(Type::I64, object, MappedArguments::OFFSET_OF_SCOPE);
            let mut ir = self.ir();
            let (is_parameter, rest) = (ir.below(index, parameters), ir.sub(index, parameters));
            let in_scope = ir.add(scope, Environment::OFFSET_OF_SLOTS);
            let in_object = ir.add(object, slots);
            let first = ir.select(is_parameter, in_scope, in_object);
            let position = ir.select(is_parameter, index, rest);
            let (address, undefined) = (self.element_address(first, position), self.undefined());
            let mut ir = self.ir();
            let held = ir.load(Type::I64, address, 0, readable(heaps::WORLD));
            ir.select(held, held, undefined)
        };
        self.graph.declare(value, T::HEAP_TOP);
        self.profile_element(value, wanted);
        value
    }
}
