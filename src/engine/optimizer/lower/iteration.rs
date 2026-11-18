//! Iteration.

use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_vm::{Shape, ShapeRareData, SpeculatedType as T, Vm};

use super::ways::Detour;
use super::{Lowering, Odds};
use crate::graph::{ExitKind, heaps};
use crate::runtime::operations::iteration as operations;

impl Lowering<'_> {
    pub(super) fn next_entry(&mut self, place: Ssa, number: Ssa, has_values: bool) -> Ssa {
        let function = if has_values {
            operations::NEXT_ENTRY_OF_MAP
        } else {
            operations::NEXT_ENTRY_OF_SET
        };
        self.call_quietly_for(function, &[place, number], &[Type::I64; 2])
    }

    pub(super) fn get_enumerator(&mut self, base: Ssa) -> Ssa {
        let (meeting, mut slow, vm) = (self.part(Type::I64), Detour::default(), self.vm());
        let is_primitive = self.has_type(base, !T::OBJECT, T::HEAP_TOP - T::NULLISH);
        self.detour_if(is_primitive, Odds::Low, &mut slow);
        let (shape, heap) = (self.shape_of(base), heaps::OTHER_FIELDS);
        let rare_data = self.load(Type::I64, shape, Shape::OFFSET_OF_RARE_DATA, heap);
        let has_none = self.ir().is_zero(rare_data);
        self.detour_if(has_none, Odds::Low, &mut slow);
        let offset = ShapeRareData::OFFSET_OF_ENUMERATOR_EPOCH;
        let then = self.load(Type::I64, rare_data, offset, heap);
        let now = self.load(Type::I64, vm, Vm::OFFSET_OF_PROTOTYPE_CHAIN_EPOCH, heap);
        let is_stale = self.ir().not_equal(then, now);
        self.detour_if(is_stale, Odds::Low, &mut slow);
        let found = self.load(
            Type::I64,
            rare_data,
            ShapeRareData::OFFSET_OF_ENUMERATOR,
            heap,
        );
        let is_gone = self.ir().is_zero(found);
        self.detour_if(is_gone, Odds::Low, &mut slow);
        self.give(meeting, found);
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operations::GET_ENUMERATOR, &[base])
        })
    }

    pub(super) fn check_view_ends_at(&mut self, view: Ssa, index: Ssa) {
        let holds = self.call_quietly(operations::VIEW_ENDS_AT, &[view, index], Type::I32);
        let fails = self.ir().is_zero(holds);
        self.exit_if(fails, ExitKind::ExoticObject);
    }

    pub(super) fn inherits_array_iteration(&mut self, array: Ssa, global: Ssa) -> Ssa {
        let takes_more = self.is_no_original_array(array, global);
        let function = operations::INHERITS_ARRAY_ITERATION;
        self.choose(
            takes_more,
            Odds::Even,
            Type::I32,
            |this| this.call_quietly(function, &[array, global], Type::I32),
            |this| this.int32(1),
        )
    }
}
