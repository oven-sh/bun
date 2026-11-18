//! Making strings.

use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_text::{MAX_LENGTH, StringImpl};
use bun_engine_vm::{
    JsRopeString, JsString, NumberStringEntry, NumberStrings, SpeculatedType as T, Vm,
};
use smallvec::SmallVec;

use super::truth::Left;
use super::ways::Detour;
use super::{Lowering, Odds};
use crate::graph::{Fibers, Kind, TypeCheck, heaps};
use crate::runtime::operators;

impl Lowering<'_> {
    pub(super) fn int32_to_string(&mut self, number: Ssa) -> Ssa {
        let (meeting, mut slow, vm) = (self.part(Type::I64), Detour::default(), self.vm());
        let (strings, heap) = (Vm::OFFSET_OF_NUMBER_STRINGS, heaps::STRING_FIBER);
        let entry = |this: &mut Self, index, shift: u32| {
            let mut ir = this.ir();
            let index = ir.zero_extend(index);
            let offset = ir.shl(index, shift);
            ir.add(vm, offset)
        };
        let is_small = (self.ir()).below(number, NumberStrings::SMALL_COUNT as i32);
        self.give_if(meeting, is_small, Odds::Even, |this| {
            let (place, table) = (
                entry(this, number, 3),
                strings + NumberStrings::OFFSET_OF_SMALL,
            );
            let found = this.load(Type::I64, place, table, heap);
            let is_missing = this.ir().is_zero(found);
            this.detour_if(is_missing, Odds::Low, &mut slow);
            found
        });
        let product = self.ir().mul(number, NumberStrings::INT32_MULTIPLIER);
        let index = self.ir().shr(product, NumberStrings::INT32_SHIFT);
        let place = entry(self, index, size_of::<NumberStringEntry>().ilog2());
        let table = strings + NumberStrings::OFFSET_OF_INT32S;
        let key = self.load(
            Type::I64,
            place,
            table + NumberStringEntry::OFFSET_OF_KEY,
            heap,
        );
        let wanted = self.box_int32(number);
        let is_other = self.ir().not_equal(key, wanted);
        self.detour_if(is_other, Odds::Even, &mut slow);
        let found = self.load(
            Type::I64,
            place,
            table + NumberStringEntry::OFFSET_OF_STRING,
            heap,
        );
        self.give(meeting, found);
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operators::INT32_TO_STRING, &[number])
        })
    }

    pub(super) fn primitive_to_string(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        let is_string = self.has_type(value, T::STRING, Left::of(check).known);
        self.unless(is_string, value, |this| {
            this.call_operation(operators::PRIMITIVE_TO_STRING, &[value])
        })
    }

    /// The length, and a word that has the bit for Latin-1.
    fn length_and_flags(&mut self, string: Ssa, fibers: Fibers) -> [Ssa; 2] {
        if let Some(text) = self.graph.text_of_constant(string) {
            let flags = if text.is_latin1 { -1 } else { 0 };
            return [self.int32(text.length as i32), self.int32(flags)];
        }
        let (fiber, heap) = (self.fiber(string), heaps::STRING_FIBER);
        let is_digits = self.is_string_of_number(string);
        let of_flat = |this: &mut Self| {
            let length = this.load(Type::I32, fiber, StringImpl::OFFSET_OF_LENGTH, heap);
            if is_digits {
                [length, this.int32(-1)]
            } else {
                [
                    length,
                    this.load(Type::I32, fiber, StringImpl::OFFSET_OF_FLAGS, heap),
                ]
            }
        };
        if fibers.contains(Fibers::IS_FLAT) {
            return of_flat(self);
        }
        let of_rope = |this: &mut Self| {
            let length = this.load(Type::I32, string, JsRopeString::OFFSET_OF_LENGTH, heap);
            [length, this.ir().wrap(fiber)]
        };
        let is_rope = self.is_rope(fiber);
        let odds = Odds::low_unless(fibers.contains(Fibers::MAY_WELL_BE_ROPE));
        self.choose_all(is_rope, odds, [Type::I32; 2], of_rope, of_flat)
    }

    fn is_string_of_number(&self, string: Ssa) -> bool {
        let kind = self.graph.kind(self.graph.root(string));
        matches!(kind, Some(Kind::Int32ToString | Kind::DoubleToString))
    }

    fn may_be_empty(&self, string: Ssa) -> bool {
        !self.is_string_of_number(string)
            && self.graph.kind(self.graph.root(string)) != Some(Kind::StringFromUnit)
    }

    fn new_rope(&mut self, strings: &[Ssa], length: Ssa, flags: Ssa) -> Ssa {
        let rope = self.allocate(self.graph.rope_allocation.expect("from the builder"));
        let mut ir = self.ir();
        let is_latin1 = ir.and(flags, JsRopeString::IS_LATIN1 as i32);
        let marks = ir.or(is_latin1, JsString::IS_ROPE as i32);
        let marks = ir.zero_extend(marks);
        let first = ir.or(strings[0], marks);
        let (low, mut high) = (ir.shl(strings[1], 32), ir.shr(strings[1], 32));
        let length_and_low = ir.or(low, length);
        if let Some(&third) = strings.get(2) {
            let third = ir.shl(third, 16);
            high = ir.or(high, third);
        }
        let heap = heaps::STRING_FIBER;
        self.store(first, rope, JsString::OFFSET_OF_FIBER, heap);
        self.store(length_and_low, rope, JsRopeString::OFFSET_OF_LENGTH, heap);
        self.store(high, rope, JsRopeString::OFFSET_OF_FIBER2, heap);
        // The words do not look like addresses, and may be computed before the allocation.
        for &string in &strings[1..] {
            if self.graph.constant(self.graph.root(string)).is_none() {
                self.keep_alive(string);
            }
        }
        rope
    }

    pub(super) fn concatenate(&mut self, data: u32) -> Ssa {
        let (strings, mut slow) = (self.operands(), Detour::default());
        let meeting = self.part(Type::I64);
        let parts: SmallVec<[[Ssa; 2]; 3]> = (strings.iter().enumerate())
            .map(|(at, &string)| self.length_and_flags(string, Fibers::of_operand(data, at)))
            .collect();
        let (mut total, mut flags) = (self.word(0), self.int32(-1));
        for (position, &[length, own_flags]) in parts.iter().enumerate() {
            if self.may_be_empty(strings[position]) {
                let is_empty = self.ir().is_zero(length);
                if strings.len() == 2 {
                    self.give_if(meeting, is_empty, Odds::Low, |_| strings[1 - position]);
                } else {
                    self.detour_if(is_empty, Odds::Low, &mut slow);
                }
            }
            let mut ir = self.ir();
            let length = ir.zero_extend(length);
            (total, flags) = (ir.add(total, length), ir.and(flags, own_flags));
        }
        let is_too_long = self.ir().above(total, MAX_LENGTH);
        self.detour_if(is_too_long, Odds::Low, &mut slow);
        let rope = self.new_rope(&strings, total, flags);
        self.give(meeting, rope);
        self.meet_after(meeting, slow, |this| match strings.len() {
            2 => this.call_operation(operators::CONCATENATE, &strings),
            _ => this.call_operation(operators::CONCATENATE_THREE, &strings),
        })
    }
}
