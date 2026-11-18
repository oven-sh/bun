//! Strings.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Unary, Value as Ssa};
use bun_engine_text::{MAX_LENGTH, StringImpl};
use bun_engine_vm::{JsRopeString, JsString, SmallStrings, SpeculatedType as T, Vm};

use super::truth::Left;
use super::ways::Detour;
use super::{Lowering, Odds};
use crate::graph::{Kind, TypeCheck, heaps};
use crate::runtime::{operations, operators};

impl Lowering<'_> {
    pub(super) fn fiber(&mut self, string: Ssa) -> Ssa {
        let offset = JsString::OFFSET_OF_FIBER;
        self.load(Type::I64, string, offset, heaps::STRING_FIBER)
    }

    pub(super) fn string_length(&mut self, string: Ssa) -> Ssa {
        let length = self.load_string_length(string);
        let bits = MAX_LENGTH.ilog2() as u8 + 1;
        self.ir().unary(Unary::FitsIn(bits), length)
    }

    fn load_string_length(&mut self, string: Ssa) -> Ssa {
        let fiber = self.fiber(string);
        let load =
            |this: &mut Self, base, offset| this.load(Type::I32, base, offset, heaps::STRING_FIBER);
        if self.graph.kind(string) == Some(Kind::ResolveRope) {
            return load(self, fiber, StringImpl::OFFSET_OF_LENGTH);
        }
        let is_rope = self.is_rope(fiber);
        self.choose(
            is_rope,
            Odds::Low,
            Type::I32,
            |this| load(this, string, JsRopeString::OFFSET_OF_LENGTH),
            |this| load(this, fiber, StringImpl::OFFSET_OF_LENGTH),
        )
    }

    pub(super) fn string_unit_at(&mut self, string: Ssa, index: Ssa) -> Ssa {
        let (fiber, heap) = (self.fiber(string), heaps::STRING_FIBER);
        let units = self.load(Type::I64, fiber, StringImpl::OFFSET_OF_DATA, heap);
        let flags = self.load(Type::I32, fiber, StringImpl::OFFSET_OF_FLAGS, heap);
        let is_latin1 = self.ir().and(flags, StringImpl::IS_LATIN1 as i32);
        let index = self.ir().zero_extend(index);
        let load = |this: &mut Self, size: Size, offset| {
            let address = this.ir().add(units, offset);
            (this.ir()).load_narrow(size, Sign::Unsigned, address, 0, heap)
        };
        self.choose(
            is_latin1,
            Odds::Even,
            Type::I32,
            |this| load(this, Size::S8, index),
            |this| {
                let offset = this.ir().shl(index, 1);
                load(this, Size::S16, offset)
            },
        )
    }

    pub(super) fn string_code_point_at(&mut self, string: Ssa, index: Ssa) -> Ssa {
        const LEAD: i32 = 0xd800;
        const TRAIL: i32 = 0xdc00;
        const BITS: u32 = 10;
        let (meeting, unit) = (self.part(Type::I32), self.string_unit_at(string, index));
        let is_other = |this: &mut Self, unit, first: i32| {
            let high = this.ir().shr(unit, BITS);
            this.ir().not_equal(high, first >> BITS)
        };
        let is_alone = is_other(self, unit, LEAD);
        self.give_if(meeting, is_alone, Odds::High, |_| unit);
        let (next, length) = (self.ir().add(index, 1), self.string_length(string));
        let is_last = self.ir().above_or_equal(next, length);
        self.give_if(meeting, is_last, Odds::Low, |_| unit);
        let trail = self.string_unit_at(string, next);
        let is_alone = is_other(self, trail, TRAIL);
        let mut ir = self.ir();
        let high = ir.shl(unit, BITS);
        let both = ir.add(high, trail);
        let pair = ir.add(both, 0x10000 - (LEAD << BITS) - TRAIL);
        let result = ir.select(is_alone, unit, pair);
        self.give(meeting, result);
        self.meet(meeting)
    }

    /// What `then` gives for a string and `or` for anything else.
    pub(super) fn for_strings(
        &mut self,
        value: Ssa,
        check: TypeCheck,
        ty: Type,
        then: impl FnOnce(&mut Self, Left) -> Ssa,
        or: impl FnOnce(&mut Self) -> Ssa,
    ) -> Ssa {
        let (meeting, left, mut other) = (self.part(ty), Left::of(check), Detour::default());
        for wanted in [T::CELL, T::STRING] {
            let left = if wanted == T::CELL {
                left
            } else {
                left.only(T::CELL)
            };
            let is_other = self.has_type(value, !wanted, left.known);
            self.detour_if(is_other, left.odds_of(!wanted), &mut other);
        }
        let given = then(self, left.only(T::STRING));
        self.give(meeting, given);
        self.meet_after(meeting, other, or)
    }

    /// Of a string that is not empty.
    pub(super) fn first_unit(&mut self, string: Ssa) -> Ssa {
        let fiber = self.fiber(string);
        let is_rope = self.is_rope(fiber);
        self.choose(
            is_rope,
            Odds::Low,
            Type::I32,
            |this| this.call_operation(operators::FIRST_UNIT, &[string]),
            |this| {
                let start = this.int32(0);
                this.string_unit_at(string, start)
            },
        )
    }

    pub(super) fn only_unit(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        let none = |this: &mut Self| this.int32(-1);
        let of_string = |this: &mut Self, _| {
            let length = this.string_length(value);
            let has_one = this.ir().equal(length, 1);
            let first = |this: &mut Self| this.first_unit(value);
            this.choose(has_one, Odds::Even, Type::I32, first, none)
        };
        self.for_strings(value, check, Type::I32, of_string, none)
    }

    pub(super) fn existing_atom(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        let of_string = |this: &mut Self, left: Left| {
            if T::ATOM_STRING.contains(left.known) {
                return this.fiber(value);
            }
            let is_atom = this.is_atom(value);
            this.choose(
                is_atom,
                left.odds_of(T::ATOM_STRING),
                Type::I64,
                |this| this.fiber(value),
                |this| this.call_operation(operators::EXISTING_ATOM, &[value]),
            )
        };
        let none = |this: &mut Self| this.word(operators::NO_ATOM as u64);
        self.for_strings(value, check, Type::I64, of_string, none)
    }

    pub(super) fn resolve_rope(&mut self, string: Ssa) {
        let fiber = self.fiber(string);
        let is_rope = self.is_rope(fiber);
        self.when(is_rope, Odds::Low, |this| {
            this.call_operation(operations::RESOLVE_ROPE, &[string]);
        });
    }

    pub(super) fn string_from_latin1(&mut self, unit: Ssa) -> Ssa {
        let vm = self.vm();
        let mut ir = self.ir();
        let index = ir.zero_extend(unit);
        let offset = ir.shl(index, 3);
        let address = ir.add(vm, offset);
        let table = Vm::OFFSET_OF_SMALL_STRINGS + SmallStrings::OFFSET_OF_SINGLE_CHARACTERS;
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        ir.load(Type::I64, address, table as i32, access)
    }

    pub(super) fn string_from_unit(&mut self, unit: Ssa) -> Ssa {
        let is_wide = self.ir().above(unit, i32::from(u8::MAX));
        self.choose(
            is_wide,
            Odds::Low,
            Type::I64,
            |this| this.call_operation(operations::STRING_FROM_UNIT, &[unit]),
            |this| this.string_from_latin1(unit),
        )
    }
}
