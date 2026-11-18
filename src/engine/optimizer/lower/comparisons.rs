//! Comparisons that take more than an instruction.

use bun_engine_asm::{Cond, FloatCond};
use bun_engine_codegen::ir::{Type, Value as Ssa};
use bun_engine_text::StringImpl;
use bun_engine_vm::{CellType, SpeculatedType as T, Value};

use super::truth::Left;
use super::ways::{Detour, Meeting};
use super::{Lowering, Odds};
use crate::graph::{InLine, Relation, TypeCheck, heaps};
use crate::runtime::operators;

impl Lowering<'_> {
    pub(super) fn atom_equal(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        let (lhs, rhs) = (self.fiber(lhs), self.fiber(rhs));
        self.ir().equal(lhs, rhs)
    }

    /// Ends all ways.
    fn compare_strings(&mut self, meeting: Meeting, slow: &mut Detour, strings: [Ssa; 2]) {
        let [first, second] = strings.map(|it| self.fiber(it));
        let either = self.ir().or(first, second);
        let has_rope = self.is_rope(either);
        self.detour_if(has_rope, Odds::Low, slow);
        let is_same = self.ir().equal(first, second);
        self.answer_if(meeting, is_same, Odds::Even, true);
        let mut load = |offset| {
            [first, second].map(|it| self.load(Type::I32, it, offset, heaps::STRING_FIBER))
        };
        let lengths = load(StringImpl::OFFSET_OF_LENGTH);
        let differ = self.ir().not_equal(lengths[0], lengths[1]);
        self.answer_if(meeting, differ, Odds::Even, false);
        let flags = [first, second].map(|it| {
            self.load(
                Type::I32,
                it,
                StringImpl::OFFSET_OF_FLAGS,
                heaps::STRING_FIBER,
            )
        });
        let mut ir = self.ir();
        let common = ir.and(flags[0], flags[1]);
        let are_atoms = ir.and(common, StringImpl::IS_ATOM as i32);
        self.answer_if(meeting, are_atoms, Odds::Even, false);
        self.take_detour(slow);
    }

    pub(super) fn string_equal(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        let (meeting, mut slow) = (self.part(Type::I32), Detour::default());
        self.compare_strings(meeting, &mut slow, [lhs, rhs]);
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operators::STRING_EQUAL, &[lhs, rhs])
        })
    }

    fn string_equals_atom(&mut self, string: Ssa, constant: Ssa, left: Left) -> Ssa {
        let text = self.graph.text_of_constant(constant).expect("a string");
        let (meeting, fiber) = (self.part(Type::I32), self.fiber(string));
        let is_same = self.ir().equal(fiber, text.atom.expect("an atom"));
        self.answer_if(meeting, is_same, Odds::Even, true);
        if left.expected.intersects(T::ATOM_STRING) {
            let is_atom = self.is_atom(string);
            self.answer_if(meeting, is_atom, left.odds_of(T::ATOM_STRING), false);
        }
        let length = self.string_length(string);
        let differs = self.ir().not_equal(length, text.length);
        self.answer_if(meeting, differs, Odds::Even, false);
        let answer = self.call_operation(operators::STRING_EQUAL, &[string, constant]);
        self.give(meeting, answer);
        self.meet(meeting)
    }

    pub(super) fn equals_atom(&mut self, value: Ssa, constant: Ssa, check: TypeCheck) -> Ssa {
        self.for_strings(
            value,
            check,
            Type::I32,
            |this, left| this.string_equals_atom(value, constant, left),
            |this| this.int32(0),
        )
    }

    pub(super) fn compare_with_unit(&mut self, relation: u32, string: Ssa, unit: Ssa) -> Ssa {
        let (cond, _) = Relation::from_data(relation).conditions();
        let (meeting, length) = (self.part(Type::I32), self.string_length(string));
        let is_empty = self.ir().is_zero(length);
        let is_for_less = matches!(cond, Cond::Lt | Cond::Le);
        self.answer_if(meeting, is_empty, Odds::Low, is_for_less);
        let first = self.first_unit(string);
        let differs = self.ir().not_equal(first, unit);
        self.give_if(meeting, differs, Odds::Even, |this| {
            this.ir().compare(cond, first, unit)
        });
        let answer = self.ir().compare(cond, length, 1);
        self.give(meeting, answer);
        self.meet(meeting)
    }

    pub(super) fn are_int32(&mut self, operands: &[Ssa]) -> Ssa {
        let (&first, rest) = operands.split_first().expect("an operand");
        let all = (rest.iter()).fold(first, |all, &operand| self.ir().and(all, operand));
        self.ir().compare(Cond::AboveEq, all, Value::NUMBER_TAG)
    }

    pub(super) fn detour_unless_number(&mut self, value: Ssa, odds: Odds, detour: &mut Detour) {
        let tag = self.ir().and(value, Value::NUMBER_TAG);
        let is_other = self.ir().is_zero(tag);
        self.detour_if(is_other, odds, detour);
    }

    /// Ends all ways.
    fn compare_in_line(
        &mut self,
        meeting: Meeting,
        slow: &mut Detour,
        (cond, float_cond): (Cond, FloatCond),
        in_line: InLine,
        operands: [Ssa; 2],
    ) {
        if in_line.contains(InLine::INT32) {
            let are_int32 = self.are_int32(&operands);
            self.give_if(meeting, are_int32, Odds::Even, |this| {
                let [lhs, rhs] = operands.map(|it| this.ir().wrap(it));
                this.ir().compare(cond, lhs, rhs)
            });
        }
        if !in_line.contains(InLine::NUMBERS) {
            return self.take_detour(slow);
        }
        (operands.iter()).for_each(|&it| self.detour_unless_number(it, Odds::Even, slow));
        let [lhs, rhs] = operands.map(|it| self.number_to_double(it, true));
        let answer = self.ir().float_compare(float_cond, lhs, rhs);
        self.give(meeting, answer);
    }

    pub(super) fn compare(&mut self, data: u32, lhs: Ssa, rhs: Ssa) -> Ssa {
        let ((relation, in_line), mut slow) = (InLine::split(data), Detour::default());
        let (meeting, conditions) = (
            self.part(Type::I32),
            Relation::from_data(relation).conditions(),
        );
        self.compare_in_line(meeting, &mut slow, conditions, in_line, [lhs, rhs]);
        self.meet_after(meeting, slow, |this| {
            let relation = this.int32(relation as i32);
            this.call_operation(operators::COMPARE, &[lhs, rhs, relation])
        })
    }

    fn are_cells(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        let mut ir = self.ir();
        let both = ir.or(lhs, rhs);
        let tags = ir.and(both, Value::NOT_CELL_MASK);
        ir.is_zero(tags)
    }

    /// Ends all ways. `mixed` is for cells of different types.
    fn compare_cells(
        &mut self,
        meeting: Meeting,
        [slow, mixed]: [&mut Detour; 2],
        cells: [Ssa; 2],
        [known, expected]: [T; 2],
    ) {
        let is_same = self.ir().equal(cells[0], cells[1]);
        self.answer_if(meeting, is_same, Odds::Even, true);
        let types = cells.map(|it| self.cell_type(it));
        let differ = self.ir().not_equal(types[0], types[1]);
        self.detour_if(differ, Odds::Even, mixed);
        if !(T::STRING | T::BIGINT).contains(known) {
            let has_identity = self.ir().above(types[0], i32::from(CellType::BigInt.0));
            let odds = Odds::low_unless(!(T::STRING | T::BIGINT).contains(expected));
            self.answer_if(meeting, has_identity, odds, false);
        }
        if !expected.intersects(T::STRING) {
            return self.take_detour(slow);
        }
        if known.intersects(T::BIGINT) {
            let is_other = self.ir().not_equal(types[0], i32::from(CellType::String.0));
            self.detour_if(is_other, Odds::Low, slow);
        }
        self.compare_strings(meeting, slow, cells);
    }

    pub(super) fn loose_equal(&mut self, data: u32, lhs: Ssa, rhs: Ssa) -> Ssa {
        let ((_, in_line), mut slow) = (InLine::split(data), Detour::default());
        let (meeting, conditions) = (self.part(Type::I32), (Cond::Eq, FloatCond::Eq));
        let (mut cells, mut mixed) = (Detour::default(), Detour::default());
        let are_cells = self.are_cells(lhs, rhs);
        self.detour_if(are_cells, Odds::Even, &mut cells);
        self.compare_in_line(meeting, &mut slow, conditions, in_line, [lhs, rhs]);
        if self.follow(cells) {
            let expected = if in_line.contains(InLine::STRINGS) {
                T::CELL
            } else {
                T::OBJECT
            };
            let detours = [&mut slow, &mut mixed];
            self.compare_cells(meeting, detours, [lhs, rhs], [T::CELL, expected]);
        }
        if self.follow(mixed) {
            self.take_detour(&mut slow);
        }
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operators::LOOSE_EQUAL, &[lhs, rhs])
        })
    }

    /// Ends all ways. They are not both cells.
    fn compare_others(
        &mut self,
        meeting: Meeting,
        slow: &mut Detour,
        operands: [Ssa; 2],
        left: [Left; 2],
    ) {
        let mut by_bits = Detour::default();
        let has_double = left.iter().any(|it| it.known.intersects(T::BOXED_DOUBLE));
        if has_double && left.iter().all(|it| it.known.intersects(T::BOXED_NUMBER)) {
            if left.iter().all(|it| it.known.intersects(T::INT32)) {
                let are_int32 = self.are_int32(&operands);
                let odds = Odds::low_unless(left.iter().all(|it| it.expected.intersects(T::INT32)));
                self.detour_if(are_int32, odds, &mut by_bits);
            }
            for (operand, left) in operands.into_iter().zip(left) {
                if !T::BOXED_NUMBER.contains(left.known) {
                    self.detour_unless_number(operand, Odds::Even, &mut by_bits);
                }
            }
            if left
                .iter()
                .any(|it| it.expected.intersects(T::BOXED_DOUBLE))
            {
                let [lhs, rhs] = operands.map(|it| self.number_to_double(it, true));
                let answer = self.ir().float_compare(FloatCond::Eq, lhs, rhs);
                self.give(meeting, answer);
            } else {
                self.take_detour(slow);
            }
        } else {
            self.take_detour(&mut by_bits);
        }
        if self.follow(by_bits) {
            let answer = self.ir().equal(operands[0], operands[1]);
            self.give(meeting, answer);
        }
    }

    pub(super) fn strict_equal(&mut self, data: u32, lhs: Ssa, rhs: Ssa) -> Ssa {
        let left = self.graph.types.pair_at(data).map(Left::of);
        let (meeting, mut slow) = (self.part(Type::I32), Detour::default());
        let (mut cells, mut mixed) = (Detour::default(), Detour::default());
        let by_content = T::STRING | T::BIGINT;
        let [known, expected] = [
            left[0].known & left[1].known,
            left[0].expected & left[1].expected,
        ];
        if !known.intersects(by_content) {
            self.compare_others(meeting, &mut slow, [lhs, rhs], left);
        } else if left.iter().all(|it| T::CELL.contains(it.known)) {
            self.take_detour(&mut cells);
        } else {
            let are_cells = self.are_cells(lhs, rhs);
            let odds = Odds::low_unless(left.iter().all(|it| it.expected.intersects(T::CELL)));
            self.detour_if(are_cells, odds, &mut cells);
            self.compare_others(meeting, &mut slow, [lhs, rhs], left);
        }
        if self.follow(cells) {
            let types = [left[0].known & T::CELL, expected];
            self.compare_cells(meeting, [&mut slow, &mut mixed], [lhs, rhs], types);
        }
        if self.follow(mixed) {
            let no = self.int32(0);
            self.give(meeting, no);
        }
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operators::STRICT_EQUAL, &[lhs, rhs])
        })
    }
}
