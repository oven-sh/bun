//! Methods of strings.

use bun_engine_asm::{Cond, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Value as Ssa};
use bun_engine_vm::direct::Form;
use bun_engine_vm::{JsRopeString, JsString, SmallStrings, Vm};

use super::Ways;
use super::views::View;
use crate::graph::{FormCall, ShortText, heaps};
use crate::lower::{Lowering, Odds};

impl Lowering<'_> {
    /// `a` if it is so related to `b`.
    fn pick(&mut self, cond: Cond, a: Ssa, b: Ssa) -> Ssa {
        let holds = self.ir().compare(cond, a, b);
        self.ir().select(holds, a, b)
    }

    fn at_least_zero(&mut self, integer: Ssa) -> Ssa {
        let zero = self.int32(0);
        self.pick(Cond::Gt, integer, zero)
    }

    /// From zero to `length`.
    fn clamp(&mut self, position: Ssa, length: Ssa) -> Ssa {
        match self.graph.function.int_constant(position) {
            Some(..=0) => self.int32(0),
            Some(constant) if constant == i32::MAX.into() => length,
            _ => {
                let position = self.at_least_zero(position);
                self.pick(Cond::Lt, position, length)
            }
        }
    }

    /// The same, where a negative position counts from the end.
    fn clamp_relative(&mut self, position: Ssa, length: Ssa) -> Ssa {
        let constant = self.graph.function.int_constant(position);
        if constant.is_some_and(|it| it >= 0) {
            return self.clamp(position, length);
        }
        let from_end = self.ir().add(length, position);
        let from_end = self.at_least_zero(from_end);
        if constant.is_some() {
            return from_end;
        }
        let from_start = self.pick(Cond::Lt, position, length);
        let is_negative = self.ir().less_than(position, 0);
        self.ir().select(is_negative, from_end, from_start)
    }

    /// Where it starts, and its length if that is positive.
    fn range_for(&mut self, form: Form, [first, second]: [Ssa; 2], length: Ssa) -> [Ssa; 2] {
        let [start, end] = match form {
            Form::slice => [first, second].map(|it| self.clamp_relative(it, length)),
            Form::substr => {
                let start = self.clamp_relative(first, length);
                let rest = self.ir().sub(length, start);
                return [start, self.pick(Cond::Lt, second, rest)];
            }
            _ => {
                let [a, b] = [first, second].map(|it| self.clamp(it, length));
                if b == length || self.graph.function.is_int_constant(a, 0) {
                    [a, b]
                } else {
                    [self.pick(Cond::Lt, a, b), self.pick(Cond::Gt, a, b)]
                }
            }
        };
        [start, self.ir().sub(end, start)]
    }

    fn empty_string(&mut self) -> Ssa {
        let (vm, offset) = (
            self.vm(),
            Vm::OFFSET_OF_SMALL_STRINGS + SmallStrings::OFFSET_OF_EMPTY,
        );
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        self.ir().load(Type::I64, vm, offset as i32, access)
    }

    fn new_substring(&mut self, view: View, start: Ssa, length: Ssa) -> Ssa {
        let latin1_bit = self.latin1_bit(view);
        let rope = self.allocate(self.graph.rope_allocation.expect("from the builder"));
        let mut ir = self.ir();
        let marks = ir.or(latin1_bit, JsString::IS_ROPE | JsRopeString::IS_SUBSTRING);
        let (marks, offset) = (ir.zero_extend(marks), ir.add(view.offset, start));
        let (length, offset) = (ir.zero_extend(length), ir.zero_extend(offset));
        let (low, high) = (ir.shl(view.base, 32), ir.shr(view.base, 32));
        let offset = ir.shl(offset, 16);
        let (first, second) = (ir.or(low, length), ir.or(high, offset));
        let heap = heaps::STRING_FIBER;
        self.store(marks, rope, JsString::OFFSET_OF_FIBER, heap);
        self.store(first, rope, JsRopeString::OFFSET_OF_LENGTH, heap);
        self.store(second, rope, JsRopeString::OFFSET_OF_FIBER2, heap);
        // The words do not look like addresses, and may be computed before the allocation.
        self.keep_alive(view.base);
        rope
    }

    pub(super) fn part_of_string(
        &mut self,
        ways: &mut Ways,
        call: FormCall,
        passed: &[Ssa],
    ) -> Ssa {
        /// There is only one of each, or a cache.
        const LONGEST_SHARED: i32 = 2;
        let view = self.view(passed[0], call.subject, &mut ways.slow);
        let [start, length] = self.range_for(call.form, [passed[1], passed[2]], view.length);
        let is_short = self.ir().less_or_equal(length, LONGEST_SHARED);
        let (done, slow) = (ways.done, &mut ways.slow);
        self.give_if(done, is_short, Odds::Even, |this| {
            let is_empty = this.ir().less_or_equal(length, 0);
            this.give_if(done, is_empty, Odds::Low, Self::empty_string);
            let is_pair = this.ir().equal(length, LONGEST_SHARED);
            this.detour_if(is_pair, Odds::Even, slow);
            let address = this.latin1_address(view, start, slow);
            let unit = this.load_units(Size::S8, address, 0);
            this.string_from_latin1(unit)
        });
        let is_whole = self.ir().equal(length, view.length);
        self.give_if(done, is_whole, Odds::Low, |_| passed[0]);
        self.new_substring(view, start, length)
    }

    /// If there is nothing to trim.
    pub(super) fn trim(&mut self, ways: &mut Ways, call: FormCall, passed: &[Ssa]) -> Ssa {
        const NO_BREAK_SPACE: i32 = 0xa0;
        let view = self.view(passed[0], call.subject, &mut ways.slow);
        let is_empty = self.ir().is_zero(view.length);
        self.give_if(ways.done, is_empty, Odds::Low, |_| passed[0]);
        let start = self.int32(0);
        let first = self.latin1_address(view, start, &mut ways.slow);
        let length = self.ir().zero_extend(view.length);
        let last = self.ir().add(first, length);
        let last = self.ir().sub(last, 1);
        let ends = [(first, Form::trim_end), (last, Form::trim_start)];
        for (address, _) in ends.into_iter().filter(|it| it.1 != call.form) {
            let unit = self.load_units(Size::S8, address, 0);
            let mut ir = self.ir();
            let distance = ir.sub(unit, i32::from(b' ') + 1);
            let may_be_space = ir.above_or_equal(distance, NO_BREAK_SPACE - i32::from(b' ') - 1);
            self.detour_if(may_be_space, Odds::Even, &mut ways.slow);
        }
        passed[0]
    }

    pub(super) fn short_text(&self, string: Ssa) -> Option<ShortText> {
        self.graph.text_of_constant(string)?.short
    }

    /// Whether these are the bytes there.
    pub(super) fn has_bytes(&mut self, address: Ssa, bytes: &[u8]) -> Ssa {
        let sizes = [Size::S64, Size::S32, Size::S16, Size::S8];
        let fitting = sizes
            .into_iter()
            .find(|it| usize::from(it.bytes()) <= bytes.len());
        let size = fitting.expect("not empty");
        let count = usize::from(size.bytes());
        let mut compare = |offset: usize| {
            let mut expected = [0; size_of::<u64>()];
            expected[..count].copy_from_slice(&bytes[offset..offset + count]);
            let found = self.load_units(size, address, offset);
            self.ir().equal(found, u64::from_le_bytes(expected))
        };
        let (first, rest) = (compare(0), bytes.len() - count);
        if rest == 0 {
            return first;
        }
        let last = compare(rest);
        self.ir().and(first, last)
    }

    pub(super) fn has_at_end(&mut self, ways: &mut Ways, call: FormCall, passed: &[Ssa]) -> Ssa {
        let text = self.short_text(passed[1]).expect("or it is called");
        let view = self.view(passed[0], call.subject, &mut ways.slow);
        let (position, count) = (
            self.clamp(passed[2], view.length),
            text.bytes().len() as i32,
        );
        let (start, room) = match call.form {
            Form::starts_with_in_characters | Form::starts_with => {
                (position, self.ir().sub(view.length, position))
            }
            _ => (self.ir().sub(position, count), position),
        };
        let is_too_short = self.ir().less_than(room, count);
        self.answer_if(ways.done, is_too_short, Odds::Even, false);
        let address = self.latin1_address(view, start, &mut ways.slow);
        self.has_bytes(address, text.bytes())
    }
}
