//! Quotients and remainders of integers.

use bun_engine_asm::{Cond, Sign, Width};

use super::Simplifier;
use super::facts::{all_ones, least};
use super::rewrite::Step;
use crate::ir::Binary::{
    Add, And, Div, Mul, MulHigh, Rem, Sar, Shl, Shr, Sub, TotalDiv, TotalRem, UnsignedDiv,
    UnsignedRem,
};
use crate::ir::Unary::{Neg, Widen, Wrap};
use crate::ir::{Binary, Op, Type, Value};

/// Granlund and Montgomery, "Division by Invariant Integers using Multiplication": for `x` below 2^`precision`,
/// `x / divisor` is `x * multiplier` without its low `width + shift` bits. The multiplier may have a bit more than
/// `width`.
fn reciprocal(divisor: u64, width: Width, precision: u32) -> (u128, u32) {
    let (divisor, bits) = (u128::from(divisor), u32::from(width.bits()));
    let mut shift = (divisor - 1).ilog2() + 1;
    // 2^128 would not fit, and no divisor from 2^63 up gets here.
    let scale = 1u128 << (bits + shift);
    let (mut low, mut high) = (
        scale / divisor,
        (scale + (1 << (bits + shift - precision))) / divisor,
    );
    while low / 2 < high / 2 && shift > 0 {
        (low, high, shift) = (low / 2, high / 2, shift - 1);
    }
    (high, shift)
}

impl Simplifier<'_> {
    pub(super) fn division(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        match op {
            TotalDiv | TotalRem => self.total_division(op, ty, a, b),
            _ if a == b => self.is_int(ty, matches!(op, Div | UnsignedDiv).into()),
            Div | Rem => self.signed_division(op, ty, a, b),
            _ => self.unsigned_division(op, ty, a, b),
        }
    }

    fn total_division(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        let partial = if op == TotalDiv { Div } else { Rem };
        match self.int(b) {
            Some(0) => return self.is(b),
            Some(-1) if op == TotalDiv => return self.to_unary(Neg, a),
            Some(-1) => return self.is_int(ty, 0),
            Some(_) => return self.to_binary(partial, a, b),
            None => {}
        }
        if self.int(a) == Some(0) || op == TotalRem && a == b {
            return self.is_int(ty, 0);
        }
        let (width, dividend, divisor) = (ty.width(), self.facts(a), self.facts(b));
        let fits = divisor.excludes(width, -1) || dividend.excludes(width, least(width));
        if divisor.is_not_zero() && fits {
            return self.to_binary(partial, a, b);
        }
        Step::Keep
    }

    fn signed_division(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        let result = self.facts_of(Op::Binary(op, [a, b]), ty);
        if let Some(only) = result.only_value() {
            return self.is_int(ty, only);
        }
        if self.is_not_negative(a) && self.is_not_negative(b) {
            return self.to_binary(if op == Div { UnsignedDiv } else { UnsignedRem }, a, b);
        }
        match (op, self.int(b)) {
            (_, None | Some(0)) => Step::Keep,
            (Div, Some(1)) => self.is(a),
            (Div, Some(-1)) => self.to_unary(Neg, a),
            (Div, Some(c)) if c < 0 => {
                let quotient = self.divide_signed(ty, a, c.unsigned_abs());
                self.to_unary(Neg, quotient)
            }
            (Div, Some(c)) => {
                let quotient = self.divide_signed(ty, a, c as u64);
                self.is(quotient)
            }
            (_, Some(c)) if c.unsigned_abs().is_power_of_two() => {
                let biased = self.bias_toward_zero(ty, a, c.trailing_zeros());
                let multiple = self.make_binary_int(And, biased, -1 << c.trailing_zeros());
                self.to_binary(Sub, a, multiple)
            }
            (_, Some(c)) => {
                let quotient = self.divide_signed(ty, a, c.unsigned_abs());
                let multiple = self.make_binary_int(Mul, quotient, c.abs());
                self.to_binary(Sub, a, multiple)
            }
        }
    }

    /// Adds 2^`amount` − 1 to a negative value.
    fn bias_toward_zero(&mut self, ty: Type, a: Value, amount: u32) -> Value {
        let bits = i64::from(ty.width().bits());
        let sign = if amount == 1 {
            a
        } else {
            self.make_binary_int(Sar, a, bits - 1)
        };
        let bias = self.make_binary_int(Shr, sign, bits - i64::from(amount));
        self.make_binary(Add, a, bias)
    }

    /// By at least two.
    fn divide_signed(&mut self, ty: Type, a: Value, divisor: u64) -> Value {
        let width = ty.width();
        if divisor.is_power_of_two() {
            self.hit();
            let biased = self.bias_toward_zero(ty, a, divisor.trailing_zeros());
            return self.make_binary_int(Sar, biased, divisor.trailing_zeros().into());
        }
        let (top, dividend) = (u32::from(width.bits()) - 1, self.facts(a));
        let precision = (dividend.max.max(1) | !dividend.min.min(-1)).ilog2() + 1;
        let (multiplier, shift) = reciprocal(divisor, width, precision);
        let rounded_down = if ty == Type::I32 {
            self.hit();
            let wide = self.make_widen(Sign::Signed, a);
            let product = self.make_binary_int(Mul, wide, multiplier as i64);
            let quotient = self.make_binary_int(Sar, product, (32 + shift).into());
            self.make_wrap(quotient)
        } else {
            let mut high = self.make_binary_int(MulHigh(Sign::Signed), a, multiplier as i64);
            if multiplier >> top != 0 {
                self.hit();
                high = self.make_binary(Add, high, a);
            }
            self.make_binary_int(Sar, high, shift.into())
        };
        let is_negative = self.make_binary_int(Shr, a, top.into());
        self.make_binary(Add, rounded_down, is_negative)
    }

    fn unsigned_division(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        let width = ty.width();
        let result = self.facts_of(Op::Binary(op, [a, b]), ty);
        if let Some(only) = result.only_value() {
            return self.is_int(ty, only);
        }
        let dividend_max = self.facts(a).unsigned_range(width).1;
        let (divisor_min, divisor_max) = self.facts(b).unsigned_range(width);
        if dividend_max < divisor_min {
            debug_assert!(op == UnsignedRem);
            return self.is(a);
        }
        if ty == Type::I64 && dividend_max.max(divisor_max) <= u32::MAX.into() {
            let (a, b) = (self.make_wrap(a), self.make_wrap(b));
            let narrow = self.make_binary(op, a, b);
            return self.to_unary(Widen(Sign::Unsigned), narrow);
        }
        let Some(c) = self.bits(b).filter(|&c| c != 0) else {
            return match self.op(b) {
                Op::Binary(Shl, [one, amount]) if self.int(one) == Some(1) => {
                    if op == UnsignedDiv {
                        return self.to_binary(Shr, a, amount);
                    }
                    let below = self.make_binary_int(Add, b, -1);
                    self.to_binary(And, a, below)
                }
                _ => Step::Keep,
            };
        };
        if c.is_power_of_two() {
            return if op == UnsignedDiv {
                self.to_binary_int(Shr, a, c.trailing_zeros().into())
            } else {
                self.to_binary_int(And, a, (c - 1) as i64)
            };
        }
        let quotient = self.divide_unsigned(ty, a, c, dividend_max);
        if op == UnsignedDiv {
            return self.is(quotient);
        }
        let multiple = self.make_binary(Mul, quotient, b);
        self.to_binary(Sub, a, multiple)
    }

    /// By what is no power of two.
    fn divide_unsigned(
        &mut self,
        ty: Type,
        mut a: Value,
        divisor: u64,
        dividend_max: u64,
    ) -> Value {
        let width = ty.width();
        if dividend_max / divisor <= 1 {
            self.hit();
            let reaches = self.make_compare_int(Cond::AboveEq, a, divisor as i64);
            return self.make_of_type(ty, reaches);
        }
        let precision = dividend_max.ilog2() + 1;
        let (mut multiplier, mut shift) = reciprocal(divisor, width, precision);
        let even = divisor.trailing_zeros();
        if multiplier > all_ones(width).into() && even != 0 {
            self.hit();
            a = self.make_binary_int(Shr, a, even.into());
            (multiplier, shift) = reciprocal(divisor >> even, width, precision - even);
        }
        let fits = multiplier <= all_ones(width).into();
        if ty == Type::I32 {
            let wide = self.make_widen(Sign::Unsigned, a);
            let quotient = if fits {
                self.hit();
                let product = self.make_binary_int(Mul, wide, multiplier as i64);
                self.make_binary_int(Shr, product, (32 + shift).into())
            } else {
                self.hit();
                let multiplier = (multiplier << (32 - shift)) as i64;
                self.make_binary_int(MulHigh(Sign::Unsigned), wide, multiplier)
            };
            return self.make_unary(Wrap, ty, quotient);
        }
        let high = self.make_binary_int(MulHigh(Sign::Unsigned), a, multiplier as i64);
        if fits {
            self.hit();
            return self.make_binary_int(Shr, high, shift.into());
        }
        self.hit();
        let rest = self.make_binary(Sub, a, high);
        let half = self.make_binary_int(Shr, rest, 1);
        let average = self.make_binary(Add, half, high);
        self.make_binary_int(Shr, average, (shift - 1).into())
    }
}
