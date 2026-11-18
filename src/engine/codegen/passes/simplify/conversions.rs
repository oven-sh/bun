//! Operations on one integer, and changes of width.

use bun_engine_asm::{Sign, Size, Width};

use super::Simplifier;
use super::facts::{Facts, all_ones, low_bits};
use super::rewrite::Step;
use crate::ir::Binary::{Add, And, Mul, Or, RotateRight, Sar, Shl, Shr, Sub, Xor};
use crate::ir::Unary::{
    CountLeadingZeros, CountOnes, CountTrailingZeros, FitsIn, Neg, Opaque, SignExtend, SwapBytes,
    Widen, Wrap,
};
use crate::ir::{AccessFlags, Lanes, Load, Op, Type, Unary, Value, evaluate};

impl Simplifier<'_> {
    pub(super) fn unary(&mut self, op: Unary, ty: Type, a: Value) -> Step {
        if op == Opaque {
            return if self.as_unary(Opaque, a).is_some() {
                self.is(a)
            } else {
                Step::Keep
            };
        }
        let from = self.type_of(a);
        if let Some(bits) = self.bits(a) {
            return match evaluate::unary(op, from, ty, bits) {
                Some(result) => self.is_bits(ty, result),
                None => Step::Keep,
            };
        }
        if let Some(step) = self.apply_to_choices(a, ty, |bits| evaluate::unary(op, from, ty, bits))
        {
            return step;
        }
        match op {
            Neg if ty.is_int() => self.neg(ty, a),
            CountLeadingZeros | CountTrailingZeros | CountOnes => self.count_bits(op, ty, a),
            SwapBytes(size) => self.swap_bytes(size, ty, a),
            SignExtend(size) => self.sign_extend(size, ty, a),
            Widen(Sign::Signed) => self.widen_signed(a),
            Widen(Sign::Unsigned) => self.widen_unsigned(a),
            Wrap => self.wrap(a),
            FitsIn(count) if self.facts(a).possible() >> count == 0 => self.is(a),
            FitsIn(_) => Step::Keep,
            _ => self.float_unary(op, ty, a),
        }
    }

    fn count_bits(&mut self, op: Unary, ty: Type, a: Value) -> Step {
        if let Some(only) = self.facts_of(Op::Unary(op, a), ty).only_value() {
            return self.is_int(ty, only);
        }
        match (op, self.op(a)) {
            (CountOnes, Op::Unary(Widen(Sign::Unsigned), x)) => {
                let count = self.make_unary(op, Type::I32, x);
                self.to_unary(Widen(Sign::Unsigned), count)
            }
            (CountOnes, Op::Binary(RotateRight, [x, _])) => self.to_unary(op, x),
            (CountOnes, _) if self.facts(a).possible().is_power_of_two() => {
                let bit = self.facts(a).possible().trailing_zeros();
                self.to_binary_int(Shr, a, bit.into())
            }
            (CountTrailingZeros, Op::Unary(Neg, x)) => self.to_unary(op, x),
            (CountTrailingZeros, Op::Binary(And, [x, y])) if self.as_unary(Neg, y) == Some(x) => {
                self.to_unary(op, x)
            }
            _ => Step::Keep,
        }
    }

    fn swap_bytes(&mut self, size: Size, ty: Type, a: Value) -> Step {
        if let Some(x) = self.as_unary(SwapBytes(size), a) {
            return self.to_binary_int(And, x, low_bits(size.bits().into()) as i64);
        }
        if size < ty.width().size()
            && let Some(stripped) = self.strip_above(a, size.bits())
        {
            return self.to_unary(SwapBytes(size), stripped);
        }
        Step::Keep
    }

    fn sign_extend(&mut self, size: Size, ty: Type, a: Value) -> Step {
        let (facts, fitting) = (
            self.facts(a),
            Facts::of_size(ty.width(), size, Sign::Signed),
        );
        if facts.is_within(fitting.min, fitting.max) {
            return self.is(a);
        }
        if facts.possible() >> (size.bits() - 1) & 1 == 0 {
            return self.to_binary_int(And, a, fitting.max);
        }
        if let Some(stripped) = self.strip_above(a, size.bits()) {
            return self.to_unary(SignExtend(size), stripped);
        }
        match self.op(a) {
            Op::Unary(Widen(_), x) => {
                let narrow = self.make_unary(SignExtend(size), Type::I32, x);
                self.to_unary(Widen(Sign::Signed), narrow)
            }
            Op::Load { .. } if ty == Type::I32 => match self.load_part(a, 0, size, Sign::Signed) {
                Some(part) => self.is(part),
                None => Step::Keep,
            },
            Op::ExtractLane {
                lanes,
                lane,
                vector,
                ..
            } if lanes == Lanes::Int(size) => self.to(Op::ExtractLane {
                lanes,
                sign: Sign::Signed,
                lane,
                vector,
            }),
            _ => Step::Keep,
        }
    }

    fn widen_signed(&mut self, a: Value) -> Step {
        if let Some(wide) = self.as_unary(Wrap, a)
            && self.facts(wide).is_within(i32::MIN.into(), i32::MAX.into())
        {
            return self.is(wide);
        }
        if self.is_not_negative(a) {
            return self.to_unary(Widen(Sign::Unsigned), a);
        }
        if let Some((x, c)) = self.as_binary_int(Add, a)
            && self.once(a)
            && Facts::cannot_overflow(
                Add,
                Width::W32,
                self.facts(x),
                Facts::constant(Width::W32, c),
            )
        {
            let wide = self.make_widen(Sign::Signed, x);
            return self.to_binary_int(Add, wide, c);
        }
        Step::Keep
    }

    fn widen_unsigned(&mut self, a: Value) -> Step {
        const GREATEST: i64 = u32::MAX as i64;
        if let Some(wide) = self.as_unary(Wrap, a) {
            let fits = self.facts(wide).is_within(0, GREATEST);
            return if fits { self.is(wide) } else { Step::Keep };
        }
        if !self.once(a) {
            return Step::Keep;
        }
        if let Some((x, c)) = self.as_offset(a) {
            let (min, max) = self.facts(x).unsigned_range(Width::W32);
            if min as i64 + c >= 0 && max as i64 + c <= GREATEST {
                let wide = self.make_widen(Sign::Unsigned, x);
                return self.to_binary_int(Add, wide, c);
            }
        } else if let Some((x, amount @ 1..=4)) = self.as_shift(Shl, a)
            && self.facts(x).possible() >> (32 - amount) == 0
        {
            let wide = self.make_widen(Sign::Unsigned, x);
            return self.to_binary_int(Shl, wide, amount.into());
        }
        Step::Keep
    }

    /// Taking the low half does away with an extension or a large constant.
    fn is_narrow_at_heart(&self, value: Value) -> bool {
        let is_narrow = |value| matches!(self.op(value), Op::Const64(_) | Op::Unary(Widen(_), _));
        is_narrow(value)
            || matches!(self.op(value), Op::Binary(Add | Sub | Mul | And | Or | Xor | Shl, [x, y])
                if self.once(value) && (is_narrow(x) || is_narrow(y)))
    }

    fn wrap(&mut self, a: Value) -> Step {
        if let Some((_, narrow)) = self.as_widen(a) {
            return self.is(narrow);
        }
        let (facts, low) = (self.facts(a), all_ones(Width::W32));
        if facts.possible() & !facts.ones & low == 0 {
            return self.is_bits(Type::I32, facts.ones);
        }
        if let Some(stripped) = self.strip(a, low) {
            return self.to_unary(Wrap, stripped);
        }
        if !self.once(a) {
            return Step::Keep;
        }
        match self.op(a) {
            Op::Binary(op @ (Add | Sub | Mul | And | Or | Xor), [x, y])
                if self.is_narrow_at_heart(x) || self.is_narrow_at_heart(y) =>
            {
                let (x, y) = (self.make_wrap(x), self.make_wrap(y));
                self.to_binary(op, x, y)
            }
            Op::Binary(Shl, [x, amount]) if self.facts(amount).is_within(0, 31) => {
                let x = self.make_wrap(x);
                self.to_binary(Shl, x, amount)
            }
            Op::Binary(Shr | Sar, [x, amount]) => self.wrap_shifted(x, amount),
            Op::Unary(op @ (Neg | SignExtend(_)), x) => {
                let x = self.make_wrap(x);
                self.to_unary(op, x)
            }
            Op::Select([condition, x, y])
                if self.is_narrow_at_heart(x) || self.is_narrow_at_heart(y) =>
            {
                let (x, y) = (self.make_wrap(x), self.make_wrap(y));
                self.to_select(condition, x, y)
            }
            Op::Load { .. } => match self.load_part(a, 0, Size::S32, Sign::Unsigned) {
                Some(part) => self.is(part),
                None => Step::Keep,
            },
            _ => Step::Keep,
        }
    }

    /// Of `x` shifted to the right.
    fn wrap_shifted(&mut self, x: Value, amount: Value) -> Step {
        let Some(dropped @ 1..=32) = self.int(amount) else {
            return Step::Keep;
        };
        match self.op(x) {
            Op::Load { access, .. } if dropped % 8 == 0 && !access.has(AccessFlags::ATOMIC) => {
                match self.load_part(x, dropped as u32 / 8, Size::S32, Sign::Unsigned) {
                    Some(part) => self.is(part),
                    None => Step::Keep,
                }
            }
            Op::Binary(op @ (Add | Sub), [p, q]) => {
                let is_scaled = |this: &Self, value| match this.int(value) {
                    Some(constant) => i64::from(constant.trailing_zeros()) >= dropped,
                    None => this
                        .as_binary(Shl, value)
                        .is_some_and(|[_, by]| by == amount),
                };
                let is_worth_it = is_scaled(self, p) || op == Add && self.is_constant(q);
                if !is_scaled(self, q) || !is_worth_it {
                    return Step::Keep;
                }
                let [p, q] = [p, q].map(|scaled| {
                    let unscaled = self.make_binary(Shr, scaled, amount);
                    self.make_wrap(unscaled)
                });
                self.to_binary(op, p, q)
            }
            _ => Step::Keep,
        }
    }

    pub(super) fn bitcast(&mut self, ty: Type, a: Value) -> Step {
        match self.op(a) {
            Op::Unary(Unary::Bitcast, x) => self.is(x),
            Op::Load {
                kind: Load::Full,
                access,
                ..
            } if self.once(a) && !access.has(AccessFlags::ATOMIC) => {
                let loaded = self.load_instead(a, self.op(a), ty);
                self.is(loaded)
            }
            Op::ExtractLane {
                lanes,
                sign,
                lane,
                vector,
            } if self.once(a) && u32::from(lanes.count()) * ty.bytes() == 16 => {
                let lanes = if ty.is_int() {
                    Lanes::Int(ty.width().size())
                } else {
                    Lanes::Float(ty.float_width())
                };
                self.to(Op::ExtractLane {
                    lanes,
                    sign,
                    lane,
                    vector,
                })
            }
            Op::Binary(op @ (And | Or | Xor), [x, mask]) if ty.is_float() && self.once(a) => {
                match (self.as_unary(Unary::Bitcast, x), self.bits(mask)) {
                    (Some(float), Some(mask)) => {
                        let mask = self.constant(ty, mask);
                        self.to_binary(op, float, mask)
                    }
                    _ => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }
}
