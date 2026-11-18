//! Shifts and rotations of integers.

use bun_engine_asm::{Cond, Sign, Size};

use super::Simplifier;
use super::facts::{Facts, all_ones, greatest};
use super::rewrite::Step;
use crate::ir::Binary::{Add, And, Mul, RotateLeft, RotateRight, Sar, Shl, Shr};
use crate::ir::Unary::{CountLeadingZeros, SignExtend, Widen};
use crate::ir::{Binary, Op, Type, Value};

impl Simplifier<'_> {
    pub(super) fn shift(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        let bits = i64::from(ty.width().bits());
        let Some(c) = self.int(b) else {
            return self.shift_by_variable(op, ty, a, b);
        };
        if !(0..bits).contains(&c) {
            return self.to_binary_int(op, a, c & (bits - 1));
        }
        if c == 0 {
            return self.is(a);
        }
        let amount = c as u32;
        match op {
            Shl => self.shl(ty, a, b, amount),
            Shr => self.shr(ty, a, b, amount),
            Sar => self.sar(ty, a, b, amount),
            RotateLeft => self.to_binary_int(RotateRight, a, bits - c),
            _ => match self.as_shift(RotateRight, a) {
                Some((x, first)) => self.to_binary_int(RotateRight, x, (first + amount).into()),
                None => Step::Keep,
            },
        }
    }

    fn shift_by_variable(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        let bits = ty.width().bits();
        match (self.int(a), op) {
            (Some(0), _) | (Some(-1), Sar | RotateLeft | RotateRight) => return self.is(a),
            _ => {}
        }
        let (amount, counted) = (self.facts(b), u64::from(bits) - 1);
        if amount.possible() & !amount.ones & counted == 0 {
            return self.to_binary_int(op, a, (amount.ones & counted) as i64);
        }
        if let Some(stripped) = self.strip(b, counted) {
            return self.to_binary(op, a, stripped);
        }
        match op {
            Sar if self.is_not_negative(a) => self.to_binary(Shr, a, b),
            RotateLeft | RotateRight
                if let Some(opposite) = self.negated_amount(b, bits.into()) =>
            {
                let reversed = if op == RotateLeft {
                    RotateRight
                } else {
                    RotateLeft
                };
                self.to_binary(reversed, a, opposite)
            }
            _ => Step::Keep,
        }
    }

    /// An instruction can hold it.
    fn is_cheap_mask(&self, mask: u64) -> bool {
        self.target.is_arm64() || mask <= u32::MAX.into() || i32::try_from(mask as i64).is_ok()
    }

    fn shl(&mut self, ty: Type, a: Value, b: Value, amount: u32) -> Step {
        let (bits, ones) = (u32::from(ty.width().bits()), all_ones(ty.width()));
        let (facts, kept) = (self.facts(a), ones >> amount);
        if facts.possible() & !facts.ones & kept == 0 {
            return self.is_bits(ty, facts.ones << amount);
        }
        if let Some(stripped) = self.strip(a, kept) {
            return self.to_binary(Shl, stripped, b);
        }
        let Op::Binary(op, [x, c]) = self.op(a) else {
            return Step::Keep;
        };
        let Some(c) = self.int(c) else {
            return Step::Keep;
        };
        let by = c as u32 % bits;
        match op {
            Shl if by + amount < bits => self.to_binary_int(Shl, x, (by + amount).into()),
            Shr | Sar if by == amount => self.to_binary_int(And, x, -1 << amount),
            Shr | Sar if self.facts(x).zeros.trailing_ones() >= by => {
                let left = i64::from(amount) - i64::from(by);
                if left > 0 {
                    self.to_binary_int(Shl, x, left)
                } else {
                    self.to_binary_int(op, x, -left)
                }
            }
            Mul => self.to_binary_int(Mul, x, c << amount),
            Add if self.once(a) => {
                let shifted = self.make_binary(Shl, x, b);
                self.to_binary_int(Add, shifted, c << amount)
            }
            _ => Step::Keep,
        }
    }

    fn shr(&mut self, ty: Type, a: Value, b: Value, amount: u32) -> Step {
        let (bits, ones) = (u32::from(ty.width().bits()), all_ones(ty.width()));
        if let Some(only) = self.facts_of(Op::Binary(Shr, [a, b]), ty).only_value() {
            return self.is_int(ty, only);
        }
        if let Some(stripped) = self.strip(a, ones << amount & ones) {
            return self.to_binary(Shr, stripped, b);
        }
        let mask = ones >> amount;
        match self.op(a) {
            Op::Binary(Sar, [x, _]) if amount == bits - 1 => self.to_binary(Shr, x, b),
            Op::Binary(op, [x, c]) if let Some(c) = self.bits(c) => match (op, c as u32 % bits) {
                (Shr, by) if by + amount < bits => self.to_binary_int(Shr, x, (by + amount).into()),
                (Shl, by) if by == amount => self.to_binary_int(And, x, mask as i64),
                (Shl, by) if self.once(a) && self.is_cheap_mask(mask) => {
                    let left = i64::from(by) - i64::from(amount);
                    let moved =
                        self.make_binary_int(if left > 0 { Shl } else { Shr }, x, left.abs());
                    self.to_binary_int(And, moved, mask as i64)
                }
                (And, _) if self.once(a) => {
                    let shifted = self.make_binary(Shr, x, b);
                    self.to_binary_int(And, shifted, (c >> amount) as i64)
                }
                _ => Step::Keep,
            },
            Op::Unary(Widen(Sign::Unsigned), x) if amount < 32 => {
                let narrow = self.make_binary(Shr, x, b);
                self.to_unary(Widen(Sign::Unsigned), narrow)
            }
            Op::Unary(CountLeadingZeros, x) if 1 << amount == bits => {
                let is_zero = self.make_compare_int(Cond::Eq, x, 0);
                let is_zero = self.make_of_type(ty, is_zero);
                self.is(is_zero)
            }
            Op::Load { .. } if ty == Type::I32 && matches!(amount, 16 | 24) => {
                let size = if amount == 16 { Size::S16 } else { Size::S8 };
                match self.load_part(a, amount / 8, size, Sign::Unsigned) {
                    Some(part) => self.is(part),
                    None => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }

    fn sar(&mut self, ty: Type, a: Value, b: Value, amount: u32) -> Step {
        let (width, bits) = (ty.width(), u32::from(ty.width().bits()));
        let facts = self.facts(a);
        if facts.min >= 0 {
            return self.to_binary(Shr, a, b);
        }
        if facts.min >> amount == facts.max >> amount {
            return self.is_int(ty, facts.min >> amount);
        }
        if facts.is_within(-1, 0) {
            return self.is(a);
        }
        if let Some(stripped) = self.strip(a, all_ones(width) << amount & all_ones(width)) {
            return self.to_binary(Sar, stripped, b);
        }
        match self.op(a) {
            Op::Binary(op, [x, c]) if let Some(c) = self.int(c) => match op {
                Sar => self.to_binary_int(Sar, x, (c as u32 % bits + amount).min(bits - 1).into()),
                Shl => self.sar_of_shl(ty, x, c as u32 % bits, amount),
                Mul if c.trailing_zeros() >= amount
                    && Facts::cannot_overflow(
                        Mul,
                        width,
                        self.facts(x),
                        Facts::constant(width, c),
                    ) =>
                {
                    self.to_binary_int(Mul, x, c >> amount)
                }
                _ => Step::Keep,
            },
            Op::Unary(Widen(Sign::Signed), x) if self.once(a) => {
                let narrow = self.make_binary_int(Sar, x, amount.min(31).into());
                self.to_unary(Widen(Sign::Signed), narrow)
            }
            Op::Load { .. } if ty == Type::I32 && matches!(amount, 16 | 24) => {
                let size = if amount == 16 { Size::S16 } else { Size::S8 };
                match self.load_part(a, amount / 8, size, Sign::Signed) {
                    Some(part) => self.is(part),
                    None => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }

    fn sar_of_shl(&mut self, ty: Type, x: Value, left: u32, right: u32) -> Step {
        let limit = greatest(ty.width()) >> left;
        if self.facts(x).is_within(!limit, limit) {
            let (op, rest) = if left > right {
                (Shl, left - right)
            } else {
                (Sar, right - left)
            };
            return self.to_binary_int(op, x, rest.into());
        }
        if left != right {
            return Step::Keep;
        }
        match u32::from(ty.width().bits()) - left {
            8 => self.to_unary(SignExtend(Size::S8), x),
            16 => self.to_unary(SignExtend(Size::S16), x),
            32 => {
                let low = self.make_wrap(x);
                self.to_unary(Widen(Sign::Signed), low)
            }
            _ => Step::Keep,
        }
    }
}
