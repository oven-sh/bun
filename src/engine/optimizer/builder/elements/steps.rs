//! Loads for what goes through the elements one by one.

use bun_engine_asm::FloatCond;
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::{ArrayModes, ElementKind, SpeculatedType as T};

use super::get::Wanted;
use super::typed_arrays::TypedAccess;
use super::{Access, Way, heap_for, holds_doubles};
use crate::builder::Builder;
use crate::builder::fork::Odds;
use crate::builder::frame::Junction;
use crate::graph::{ExitKind, Kind, ModeSet};

impl Builder<'_> {
    /// Of an array, whatever its elements are like. The index is an I32 without a sign.
    pub(in crate::builder) fn leave_if_past_end(
        &mut self,
        array: Ssa,
        index: Ssa,
        end: &mut Junction,
    ) {
        let array = self.alias(array);
        let storage = self.storage(array);
        let length = self.public_length(storage);
        let is_past = self.ir().above_or_equal(index, length);
        self.leave_if(is_past, Odds::Low, end);
    }

    /// The same. Gives the element otherwise, if there is a profile for it.
    pub(in crate::builder) fn next_element(
        &mut self,
        (array, index, seen): (Ssa, Ssa, ArrayModes),
        profile: Option<(T, u32)>,
        end: &mut Junction,
    ) -> Option<Ssa> {
        let wanted = profile.map_or(Wanted::Presence, |it| Wanted::Value(it.0, it.1));
        let seen = self.seen_of(array, seen);
        let groups = self.groups_to_read(array, seen);
        let groups = groups.map(|it| it.and(ModeSet::ARRAY).and(ModeSet::DENSE));
        let (ways, exit) = (
            self.likely_ways_for_array(array, seen, &groups),
            self.exit_for_other_base(seen),
        );
        let (may_run_scripts, end) = (self.may_run_scripts(seen), core::cell::RefCell::new(end));
        let read = |this: &mut Self, access: &mut Access, way, object| {
            let Way::Stored(modes) = way else {
                unreachable!("left out")
            };
            let storage = this.storage(object);
            let length = this.dense_length(storage);
            let is_past = this.ir().above_or_equal(index, length);
            this.leave_if(is_past, Odds::Low, &mut end.borrow_mut());
            access.is_inside = true;
            this.read_stored(access, object, modes, wanted)
        };
        let slowly = |this: &mut Self| {
            this.leave_if_past_end(array, index, &mut end.borrow_mut());
            if !may_run_scripts {
                let is_large = this.ir().less_than(index, 0);
                this.exit_if(is_large, ExitKind::ExoticObject);
                return Some(this.look_up_element(array, index, wanted));
            }
            let (array, prediction) = (this.alias(array), profile.map_or_default(|it| it.0));
            Some(this.profiled_node(Kind::GetIndex, &[array, index], 0, prediction))
        };
        self.access_elements((array, index, seen), &ways, exit, read, slowly)
    }

    /// Goes on if `base` evidently has an element of its own at the index, which is an I32.
    pub(in crate::builder) fn leave_unless_own_element(
        &mut self,
        (base, index, seen): (Ssa, Ssa, ArrayModes),
        other: &mut Junction,
    ) {
        let likely = self.likely_modes(base, seen);
        let groups = [ModeSet::VALUES, ModeSet::of_kind(ElementKind::Double)];
        let mut ways = self.likely_ways(base, seen, &groups.map(|it| likely.and(it)));
        ways.retain(|it| matches!(it, Way::Stored(_) | Way::Typed(_) | Way::String));
        let other = core::cell::RefCell::new(other);
        let test = |this: &mut Self, _: &mut Access, way, object| {
            let is_past = match way {
                Way::Stored(_) => {
                    let storage = this.storage(object);
                    let length = this.dense_length(storage);
                    this.ir().above_or_equal(index, length)
                }
                Way::String => {
                    let length = this.node(Kind::StringLength, &[object], 0);
                    this.ir().above_or_equal(index, length)
                }
                _ => {
                    let (length, wide) = (this.known_length(object), this.ir().zero_extend(index));
                    this.ir().above_or_equal(wide, length)
                }
            };
            this.leave_if(is_past, Odds::Low, &mut other.borrow_mut());
            if let Way::Stored(modes) = way {
                let storage = this.storage(object);
                let (address, heap) = (this.element_address(storage, index), heap_for(modes));
                let is_hole = if holds_doubles(modes) {
                    let number = this.ir().load(Type::F64, address, 0, heap);
                    (this.ir()).float_compare(FloatCond::Unordered, number, number)
                } else {
                    let value = this.ir().load(Type::I64, address, 0, heap);
                    this.ir().is_zero(value)
                };
                this.leave_if(is_hole, Odds::Low, &mut other.borrow_mut());
            }
            None
        };
        self.access_elements((base, index, seen), &ways, None, test, |this| {
            this.leave_for(&mut other.borrow_mut(), None);
            None
        });
    }

    /// `next_element` for a typed array, which has to be as it has been so far. What is past its end may have to throw.
    pub(in crate::builder) fn next_typed_element(
        &mut self,
        (view, index, seen): (Ssa, Ssa, ArrayModes),
        prediction: T,
        end: &mut Junction,
    ) -> Option<Ssa> {
        let seen = seen - ArrayModes::OUT_OF_BOUNDS;
        let mut ways = self.likely_ways(view, seen, &[]);
        ways.retain(|it| matches!(it, Way::Typed(_)));
        let read = |this: &mut Self, _: &mut Access, way, object| {
            let Way::Typed(of) = way else {
                unreachable!("left out")
            };
            let (length, wide) = (this.known_length(object), this.ir().zero_extend(index));
            let is_past = this.ir().above_or_equal(wide, length);
            this.leave_if(is_past, Odds::Low, end);
            let is_large = this.ir().less_than(index, 0);
            this.exit_if(is_large, ExitKind::ExoticObject);
            let key = this.box_int32(index);
            this.get_from_typed_array(TypedAccess::new(object, of, key, seen), prediction)
        };
        let exit = ExitKind::ExoticObject;
        self.access_elements((view, index, seen), &ways, Some(exit), read, |this| {
            this.force_exit(exit);
            None
        })
    }
}
