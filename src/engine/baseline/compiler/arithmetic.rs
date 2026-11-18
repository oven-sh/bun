//! Operators on numbers.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Amount, NegativeZero, Shift, Src};
use bun_engine_bytecode::{Constant, Instruction, Operand, Register};
use bun_engine_vm::{Arithmetic, CellType};

use super::{Cold, Compiler, metadata};
use crate::emit::{Emit, FALSE};
use crate::registers::*;

#[derive(Clone, Copy)]
pub(super) struct Binary {
    pub(super) dst: Register,
    pub(super) lhs: Operand,
    pub(super) rhs: Operand,
    pub(super) profile: Option<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Operator {
    Add,
    Subtract,
    Multiply,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Bitwise {
    And,
    Or,
    Xor,
    Shift(Shift),
    /// Of which the result is taken as unsigned.
    UnsignedShift,
}

/// The kinds of numbers that an operand has been.
#[derive(Clone, Copy)]
struct Kinds {
    int32: bool,
    double: bool,
}

impl Compiler<'_> {
    /// Sees to it that the profile says so whenever this place is reached.
    fn record(&mut self, word: u32, seen: Arithmetic) {
        if self.profiles.arithmetic(word).contains(seen) {
            self.assume(word, seen);
        } else {
            (self.m).or_to_memory(Size::S16, metadata(word, 0), seen.low_half());
        }
    }

    pub(super) fn assume(&mut self, word: u32, seen: Arithmetic) {
        match self.assumed.last_mut() {
            Some(last) if last.0 == word => last.1 |= seen,
            _ => self.assumed.push((word, seen)),
        }
    }

    fn kinds(&self, op: &Binary) -> (Kinds, Kinds) {
        let seen = op.profile.map_or_default(|it| self.profiles.arithmetic(it));
        let kinds = |int32, double| Kinds {
            int32: seen.contains(int32),
            double: seen.contains(double),
        };
        (
            kinds(Arithmetic::LHS_INT32, Arithmetic::LHS_DOUBLE),
            kinds(Arithmetic::RHS_INT32, Arithmetic::RHS_DOUBLE),
        )
    }

    /// Loads what is no int32 constant, and returns the constant on the right, if that is one.
    fn load_for_int32(&mut self, op: &Binary) -> Option<i32> {
        let constant = self.int32_constant(op.rhs);
        match constant {
            Some(_) => self.load(T0, op.lhs),
            None => self.load_both(op.lhs, op.rhs),
        }
        constant
    }

    fn branch_unless_int32(&mut self, op: &Binary, target: Label) {
        match (self.int32_constant(op.lhs), self.int32_constant(op.rhs)) {
            (_, Some(_)) => self.m.branch_if_not_int32(T0, target),
            (Some(_), None) => self.m.branch_if_not_int32(T1, target),
            (None, None) => self.m.branch_unless_both_int32(T0, T1, T2, target),
        }
    }

    /// Only for the kinds that have been seen, so that the profile learns of the others.
    fn to_double(&mut self, dst: Fpr, operand: Operand, value: Gpr, kinds: Kinds, slow: Label) {
        match self.constant(operand) {
            Some(&Constant::Int32(value)) => self.move_untrusted_double(dst, value.into()),
            Some(&Constant::Double(value)) => self.move_untrusted_double(dst, value),
            _ if kinds.int32 && kinds.double => self.m.number_to_double(dst, value, T2, slow),
            _ if kinds.double => {
                self.m.branch_if_int32(value, slow);
                self.m.branch_if_not_number(value, slow);
                self.m.unbox_double(dst, value, T2);
            }
            _ => {
                self.m.branch_if_not_int32(value, slow);
                self.m.convert_i32_to_f64(dst, value);
            }
        }
    }

    fn move_untrusted_double(&mut self, dst: Fpr, value: f64) {
        self.m.move64(T2, Untrusted(value.to_bits()));
        self.m.move_bits_to_f64(dst, T2);
    }

    fn assume_kinds(&mut self, word: u32) {
        let seen = self.profiles.arithmetic(word);
        self.assume(word, seen);
    }

    pub(super) fn arithmetic(&mut self, op: Binary, operator: Operator) {
        let Some(word) = op.profile else {
            return self.call_slow_path();
        };
        let (seen, (lhs, rhs)) = (self.profiles.arithmetic(word), self.kinds(&op));
        let has_doubles =
            (lhs.double || rhs.double) && (lhs.int32 || lhs.double) && (rhs.int32 || rhs.double);
        let has_int32 = seen.is_empty() || (lhs.int32 && rhs.int32);
        if !has_doubles && !has_int32 {
            let thunk = match operator {
                Operator::Add => self.thunks.add_any,
                Operator::Subtract => self.thunks.subtract_any,
                Operator::Multiply => self.thunks.multiply_any,
            };
            return self.binary_operator(op, thunk);
        }
        let overflows = seen.contains(Arithmetic::RESULT_OVERFLOWED_INT32);
        let (doubles, store) = (self.m.new_label(), self.m.new_label());
        let slow = self.cold_until(store, |c, cold| c.arithmetic_on_any_numbers(cold));
        let constant = self.load_for_int32(&op);
        if has_int32 {
            self.branch_unless_int32(&op, if has_doubles { doubles } else { slow });
            let widen = self.m.new_label();
            let overflow = if overflows { widen } else { slow };
            self.int32_arithmetic(operator, constant, overflow, slow);
            self.record(word, Arithmetic::BOTH_INT32);
            self.m.box_int32(T0, T2);
            if !has_doubles && !overflows {
                self.m.bind(store);
                return self.store_result(op.dst);
            }
            self.m.jump(store);
            if overflows {
                self.m.bind(widen);
                let int32 = Kinds {
                    int32: true,
                    double: false,
                };
                self.m.convert_i32_to_f64(F0, T0);
                match constant {
                    Some(_) => self.to_double(F1, op.rhs, T1, int32, slow),
                    None => self.m.convert_i32_to_f64(F1, T1),
                }
                self.double_arithmetic(operator);
                if has_doubles {
                    self.m.jump(store);
                }
            }
        }
        if has_doubles {
            self.m.bind(doubles);
            self.to_double(F0, op.lhs, T0, lhs, slow);
            self.to_double(F1, op.rhs, T1, rhs, slow);
            self.double_arithmetic(operator);
        }
        self.assume_kinds(word);
        self.m.bind(store);
        self.store_result(op.dst);
    }

    fn arithmetic_on_any_numbers(&mut self, cold: &Cold) {
        let (thunk, rhs, word) = match self.instruction(cold.offset) {
            Instruction::Add(op) => (self.thunks.add, op.rhs, op.metadata),
            Instruction::Subtract(op) => (self.thunks.subtract, op.rhs, op.metadata),
            Instruction::Multiply(op) => (self.thunks.multiply, op.rhs, op.metadata),
            _ => unreachable!(),
        };
        if self.int32_constant(rhs).is_some() {
            self.load(T1, rhs);
        }
        self.m.compute_address(T4, metadata(word, 0));
        self.m.call_address(thunk);
        self.m.branch_if_not_zero64(T0, cold.resume);
        self.m.jump(cold.slow);
    }

    /// Into `T2`.
    fn int32_arithmetic(
        &mut self,
        operator: Operator,
        constant: Option<i32>,
        overflow: Label,
        negative_zero: Label,
    ) {
        let rhs = constant.map_or(Src::Reg(T1), |it| Untrusted(it).into());
        match operator {
            Operator::Add => (self.m).branch_add32(ResultCond::Overflow, T2, T0, rhs, overflow),
            Operator::Subtract => {
                (self.m).branch_sub32(ResultCond::Overflow, T2, T0, rhs, overflow);
            }
            Operator::Multiply => {
                self.m.branch_mul32_overflow(T2, T0, rhs, overflow);
                if constant.is_some_and(|it| it > 0) {
                    return;
                }
                let not_zero = self.m.new_label();
                self.m.branch_if_not_zero32(T2, not_zero);
                self.m.or32(T3, T0, rhs);
                (self.m).branch_test32(TestCond::Negative, T3, -1, negative_zero);
                self.m.bind(not_zero);
            }
        }
    }

    fn double_arithmetic(&mut self, operator: Operator) {
        match operator {
            Operator::Add => self.m.add_f64(F0, F0, F1),
            Operator::Subtract => self.m.sub_f64(F0, F0, F1),
            Operator::Multiply => self.m.mul_f64(F0, F0, F1),
        }
        self.m.box_double(T0, F0);
    }

    pub(super) fn divide(&mut self, op: Binary) {
        let Some(word) = op.profile else {
            return self.call_slow_path();
        };
        let (seen, (lhs, rhs)) = (self.profiles.arithmetic(word), self.kinds(&op));
        if !(lhs.int32 || lhs.double) || !(rhs.int32 || rhs.double) {
            return self.binary_operator(op, self.thunks.divide);
        }
        let (slow, store) = (self.slow(), self.m.new_label());
        self.load_both(op.lhs, op.rhs);
        self.to_double(F0, op.lhs, T0, lhs, slow);
        self.to_double(F1, op.rhs, T1, rhs, slow);
        self.m.div_f64(F0, F0, F1);
        let fraction = if seen.contains(Arithmetic::RESULT_DOUBLE) {
            self.m.new_label()
        } else {
            slow
        };
        if lhs.int32 && rhs.int32 {
            if lhs.double || rhs.double {
                self.m.branch_unless_both_int32(T0, T1, T2, fraction);
            }
            let zero = NegativeZero::Reject;
            self.m.convert_f64_to_i32_exact(T0, F0, zero, fraction);
            self.m.box_int32(T0, T0);
            if fraction == slow {
                self.assume_kinds(word);
                return self.store_result(op.dst);
            }
            self.m.jump(store);
        }
        if fraction != slow {
            self.m.bind(fraction);
        }
        if !seen.contains(Arithmetic::RESULT_NEGATIVE_ZERO) && lhs.int32 && rhs.int32 {
            self.m.branch_f64_with_zero(FloatCond::Eq, F0, slow);
        }
        self.m.box_double(T0, F0);
        self.assume_kinds(word);
        self.m.bind(store);
        self.store_result(op.dst);
    }

    pub(super) fn remainder(&mut self, op: Binary) {
        let (Some(word), (lhs, rhs)) = (op.profile, self.kinds(&op)) else {
            return self.call_slow_path();
        };
        if (lhs.double && !lhs.int32) || (rhs.double && !rhs.int32) || self.makes_bigints(&op) {
            return self.binary_operator(op, self.thunks.remainder);
        }
        let slow = self.slow();
        self.load_both(op.lhs, op.rhs);
        self.branch_unless_int32(&op, slow);
        self.m.branch_test32(TestCond::Negative, T0, -1, slow);
        match self.int32_constant(op.rhs) {
            Some(divisor @ 1..) if divisor.count_ones() == 1 => self.m.and32(T0, T0, divisor - 1),
            _ => {
                self.m.branch32(Cond::Le, T1, 0, slow);
                self.m.rem(Sign::Unsigned, Width::W32, T0, T0, T1);
            }
        }
        self.record(word, Arithmetic::BOTH_INT32);
        self.m.box_int32(T0, T0);
        self.store_result(op.dst);
    }

    fn makes_bigints(&self, op: &Binary) -> bool {
        let seen = op.profile.map_or_default(|it| self.profiles.arithmetic(it));
        seen.contains(Arithmetic::RESULT_BIGINT)
    }

    pub(super) fn exponentiate(&mut self, op: Binary) {
        let (Some(word), Some(2), (base, _)) =
            (op.profile, self.int32_constant(op.rhs), self.kinds(&op))
        else {
            return self.binary_operator(op, self.thunks.exponentiate);
        };
        let (slow, double, store) = (self.slow(), self.m.new_label(), self.m.new_label());
        self.load(T0, op.lhs);
        if base.int32 || !base.double {
            let overflow = self.cold_until(store, |c, cold| {
                c.m.move64(T1, T0);
                (c.m).compute_address(T4, metadata(c.raw(cold.offset).metadata, 0));
                c.m.call_address(c.thunks.multiply);
                c.m.branch_if_not_zero64(T0, cold.resume);
                c.m.jump(cold.slow);
            });
            (self.m).branch_if_not_int32(T0, if base.double { double } else { slow });
            self.m.branch_mul32_overflow(T2, T0, T0, overflow);
            self.record(word, Arithmetic::BOTH_INT32);
            self.m.box_int32(T0, T2);
            if base.double {
                self.m.jump(store);
            }
        }
        if base.double {
            let only_double = Kinds {
                int32: false,
                double: true,
            };
            self.m.bind(double);
            self.to_double(F0, op.lhs, T0, only_double, slow);
            self.m.mul_f64(F0, F0, F0);
            self.m.box_double(T0, F0);
            self.record(word, Arithmetic::RESULT_DOUBLE);
            self.assume_kinds(word);
        }
        self.m.bind(store);
        self.store_result(op.dst);
    }

    pub(super) fn bitwise(&mut self, op: Binary, operator: Bitwise) {
        let on_bigints = match operator {
            Bitwise::And => Some(self.thunks.bit_and),
            Bitwise::Or => Some(self.thunks.bit_or),
            Bitwise::Xor => Some(self.thunks.bit_xor),
            Bitwise::Shift(Shift::Left) => Some(self.thunks.shift_left),
            Bitwise::Shift(Shift::RightArithmetic) => Some(self.thunks.shift_right),
            Bitwise::Shift(_) | Bitwise::UnsignedShift => None,
        };
        if let Some(thunk) = on_bigints.filter(|_| self.makes_bigints(&op)) {
            return self.binary_operator(op, thunk);
        }
        let (slow, (lhs, rhs)) = (self.slow(), self.kinds(&op));
        let constant = self.load_for_int32(&op);
        let lhs_truncates = lhs.double || op.profile.is_none();
        if lhs_truncates || rhs.double {
            for (value, truncates) in [(T0, lhs_truncates), (T1, rhs.double)] {
                if value == T1 && constant.is_some() {
                    continue;
                }
                if truncates {
                    self.m.truncate_number(value, T2, slow);
                } else {
                    self.m.branch_if_not_int32(value, slow);
                }
            }
        } else {
            self.branch_unless_int32(&op, slow);
        }
        let operand = constant.map_or(Src::Reg(T1), |it| Untrusted(it).into());
        let amount = constant.map_or(Amount::Reg(T1), |it| Amount::Imm(it as u8 & 31));
        match operator {
            Bitwise::And => self.m.and32(T0, T0, operand),
            Bitwise::Or => self.m.or32(T0, T0, operand),
            Bitwise::Xor => self.m.xor32(T0, T0, operand),
            Bitwise::Shift(shift) => self.m.shift(shift, Width::W32, T0, T0, amount),
            Bitwise::UnsignedShift => self.m.shr32(T0, T0, amount),
        }
        let store = self.m.new_label();
        if operator == Bitwise::UnsignedShift && constant.is_none_or(|it| it & 31 == 0) {
            let seen = op.profile.map_or_default(|it| self.profiles.arithmetic(it));
            if seen.contains(Arithmetic::RESULT_DOUBLE) {
                let fits = self.m.new_label();
                self.m.branch_test32(TestCond::NonNegative, T0, -1, fits);
                self.m.convert_u32_to_f64(F0, T0);
                self.m.box_double(T0, F0);
                self.m.jump(store);
                self.m.bind(fits);
            } else {
                self.m.branch_test32(TestCond::Negative, T0, -1, slow);
            }
        }
        self.m.box_int32(T0, T0);
        self.m.bind(store);
        match op.profile {
            Some(word) if lhs.double || rhs.double => {
                self.record(word, Arithmetic::BOTH_INT32);
                self.assume_kinds(word);
            }
            Some(word) => self.record(word, Arithmetic::BOTH_INT32),
            None => {}
        }
        self.store_result(op.dst);
    }

    /// `old` gets the value before the step.
    pub(super) fn step(
        &mut self,
        dst: Register,
        value: Register,
        old: Option<Register>,
        word: u32,
        by: i32,
    ) {
        let slow = self.slow();
        self.load(T0, value);
        self.m.branch_if_not_int32(T0, slow);
        self.m.branch_add32(ResultCond::Overflow, T1, T0, by, slow);
        self.record(word, Arithmetic::LHS_INT32);
        match old {
            Some(old) => {
                self.m.box_int32(T1, T1);
                self.store(dst, T1);
                self.store_result(old);
            }
            None => {
                self.m.box_int32(T0, T1);
                self.store_result(dst);
            }
        }
    }

    pub(super) fn negate(&mut self, dst: Register, value: Operand, word: u32) {
        let (slow, seen) = (self.slow(), self.profiles.arithmetic(word));
        self.load(T0, value);
        let (double, store) = (self.m.new_label(), self.m.new_label());
        let has_doubles = seen.contains(Arithmetic::LHS_DOUBLE);
        (self.m).branch_if_not_int32(T0, if has_doubles { double } else { slow });
        self.m.branch_test32(TestCond::Zero, T0, i32::MAX, slow);
        self.m.neg32(T0, T0);
        self.m.box_int32(T0, T0);
        self.record(word, Arithmetic::LHS_INT32);
        if has_doubles {
            self.m.jump(store);
            self.m.bind(double);
            self.m.branch_if_not_number(T0, slow);
            self.m.unbox_double(F0, T0, T1);
            self.m.neg_f64(F0, F0);
            self.m.box_double(T0, F0);
            self.assume_kinds(word);
        }
        self.m.bind(store);
        self.store_result(dst);
    }

    pub(super) fn bit_not(&mut self, dst: Register, value: Operand, word: u32) {
        let slow = self.slow();
        self.load(T0, value);
        self.m.branch_if_not_int32(T0, slow);
        self.m.not32(T0, T0);
        self.m.box_int32(T0, T0);
        self.record(word, Arithmetic::LHS_INT32);
        self.store_result(dst);
    }

    pub(super) fn to_number(&mut self, dst: Register, value: Operand, word: u32) {
        if (self.profiles.arithmetic(word)).contains(Arithmetic::LHS_OTHER) {
            return self.any_to_number(dst, value, word);
        }
        self.to_numeric(dst, value, word);
    }

    pub(super) fn to_numeric(&mut self, dst: Register, value: Operand, word: u32) {
        let (slow, seen) = (self.slow(), self.profiles.arithmetic(word));
        self.load(T0, value);
        if seen.contains(Arithmetic::LHS_INT32 | Arithmetic::LHS_DOUBLE) {
            self.m.branch_if_not_number(T0, slow);
            self.assume_kinds(word);
        } else if seen.contains(Arithmetic::LHS_DOUBLE) {
            self.m.branch_if_int32(T0, slow);
            self.m.branch_if_not_number(T0, slow);
            self.assume_kinds(word);
        } else {
            let store = self.m.new_label();
            let other = self.cold_until(store, |c, cold| {
                c.m.branch_if_not_number(T0, cold.slow);
                let known = (Arithmetic::LHS_DOUBLE | Arithmetic::RESULT_DOUBLE).low_half();
                c.m.load16(T1, metadata(c.raw(cold.offset).metadata, 0));
                c.m.and32(T1, T1, known);
                c.m.branch32(Cond::Eq, T1, known, cold.resume);
                c.m.jump(cold.slow);
            });
            self.m.branch_if_not_int32(T0, other);
            self.record(word, Arithmetic::LHS_INT32);
            self.m.bind(store);
        }
        self.store_result(dst);
    }

    pub(super) fn not(&mut self, dst: Register, value: Operand) {
        let is_boolean = self.is_known_boolean(value);
        self.load(T0, value);
        if !is_boolean {
            let truth = self.m.new_label();
            let other = self.cold_until(truth, |c, cold| {
                c.m.call_address(c.thunks.to_boolean);
                c.m.branch32(Cond::Above, T0, 1, cold.slow);
                c.m.box_boolean(T0, T0);
                c.m.jump(cold.resume);
            });
            self.m.xor64(T1, T0, FALSE);
            self.m.branch64(Cond::Above, T1, 1, other);
            self.m.bind(truth);
        }
        self.m.xor32(T0, T0, 1);
        self.store_result(dst);
        self.carries_boolean = true;
    }

    pub(super) fn to_primitive(&mut self, dst: Register, value: Operand) {
        let (slow, primitive) = (self.slow(), self.m.new_label());
        self.load(T0, value);
        self.m.branch_if_not_cell(T0, primitive);
        self.m.branch_if_cell_is_object(T0, slow);
        self.m.bind(primitive);
        self.store_result(dst);
    }

    pub(super) fn to_property_key(&mut self, dst: Register, value: Operand, or_number: bool) {
        let (slow, key) = (self.slow(), self.m.new_label());
        self.load(T0, value);
        if or_number {
            self.m.branch_if_number(T0, key);
        }
        self.m.branch_if_not_cell(T0, slow);
        self.m.branch_if_type(T0, CellType::String, key);
        self.m.branch_if_not_type(T0, CellType::Symbol, slow);
        self.m.bind(key);
        self.store_result(dst);
    }

    pub(super) fn to_object(&mut self, dst: Register, value: Operand, word: u32) {
        self.slow_unless_object(value);
        self.store_profiled_result(dst, word);
    }

    /// Leaves it in `T0`.
    pub(super) fn slow_unless_object(&mut self, value: Operand) {
        let slow = self.slow();
        self.load(T0, value);
        self.m.branch_if_not_cell(T0, slow);
        self.m.branch_if_cell_is_no_object(T0, slow);
    }
}
