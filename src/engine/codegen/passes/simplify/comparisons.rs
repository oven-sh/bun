//! Comparisons of integers.

use bun_engine_asm::Cond::{Above, AboveEq, Below, BelowEq, Eq, Ge, Gt, Le, Lt, Ne};
use bun_engine_asm::{Cond, Sign, VectorReduce, Width};

use super::Simplifier;
use super::facts::{Facts, all_ones, extend_sign, greatest, least, low_bits, sign_bit};
use super::rewrite::{Step, shared_operand};
use crate::ir::Binary::{Add, And, Mul, Or, RotateRight, Sar, Shl, Shr, Sub, UnsignedRem, Xor};
use crate::ir::Unary::{CountLeadingZeros, CountOnes, CountTrailingZeros, Neg, SwapBytes};
use crate::ir::{Op, Type, Value, evaluate};

fn unsigned(cond: Cond) -> Cond {
    match cond {
        Lt => Below,
        Le => BelowEq,
        Gt => Above,
        Ge => AboveEq,
        _ => cond,
    }
}

fn with_other_sign(cond: Cond) -> Cond {
    match cond {
        Below => Lt,
        BelowEq => Le,
        Above => Gt,
        AboveEq => Ge,
        _ => unsigned(cond),
    }
}

/// Newton's method doubles the number of correct bits, of which there are three at first.
fn inverse_of_odd(odd: i64) -> i64 {
    (0..5).fold(odd, |guess, _| {
        guess.wrapping_mul(2i64.wrapping_sub(odd.wrapping_mul(guess)))
    })
}

impl Simplifier<'_> {
    pub(super) fn compare(&mut self, cond: Cond, a: Value, b: Value) -> Step {
        let ty = self.type_of(a);
        if a == b {
            return self.is_bool(cond.holds32(0, 0));
        }
        let (width, first, second) = (ty.width(), self.facts(a), self.facts(b));
        if let Some(holds) = Facts::decide(cond, width, first, second) {
            return self.is_bool(holds);
        }
        if let Some(step) = self.compare_narrow(cond, a, b) {
            return step;
        }
        if let Some(c) = self.int(b) {
            let apply = |lhs| Some(evaluate::compare(cond, ty, lhs, second.ones).into());
            if let Some(step) = self.apply_to_choices(a, Type::I32, apply) {
                return step;
            }
            return match cond {
                Eq | Ne => self.equality_with_constant(cond, a, b, c),
                _ => self.order_with_constant(cond, a, first, c),
            };
        }
        match cond {
            Eq | Ne => self.equality(cond, a, b),
            _ if cond.is_signed() && first.min >= 0 && second.min >= 0 => {
                self.to_compare(unsigned(cond), a, b)
            }
            _ => self.order(cond, a, b),
        }
    }

    /// Extending the sign keeps both orders, and extending with zeros makes the unsigned order the signed one too.
    fn compare_narrow(&mut self, cond: Cond, a: Value, b: Value) -> Option<Step> {
        let (sign, x) = self.as_widen(a)?;
        let (sign, y) = match (self.as_widen(b), self.int(b)) {
            (Some((same, y)), _) if same == sign => (sign, y),
            (Some((other, y)), _) => {
                let without_sign = if other == Sign::Signed { x } else { y };
                (
                    self.is_not_negative(without_sign).then_some(Sign::Signed)?,
                    y,
                )
            }
            (None, Some(c)) => {
                let fits = if sign == Sign::Signed {
                    i32::try_from(c).is_ok()
                } else {
                    u32::try_from(c).is_ok()
                };
                (sign, fits.then(|| self.constant(Type::I32, c as u64))?)
            }
            (None, None) => return None,
        };
        Some(self.to_compare(
            if sign == Sign::Signed {
                cond
            } else {
                unsigned(cond)
            },
            x,
            y,
        ))
    }

    fn equality(&mut self, cond: Cond, a: Value, b: Value) -> Step {
        for (x, y) in [(a, b), (b, a)] {
            match self.op(x) {
                Op::Binary(Add | Xor, [p, q]) if p == y || q == y => {
                    return self.to_compare_int(cond, if p == y { q } else { p }, 0);
                }
                Op::Binary(Sub, [p, q]) if p == y => return self.to_compare_int(cond, q, 0),
                _ => {}
            }
        }
        match (self.op(a), self.op(b)) {
            (Op::Binary(op @ (Add | Xor), first), Op::Binary(same, second))
                if op == same
                    && let Some([_, p, q]) = shared_operand(first, second) =>
            {
                self.to_compare(cond, p, q)
            }
            (Op::Binary(Sub, [p, q]), Op::Binary(Sub, [r, s])) if p == r => {
                self.to_compare(cond, q, s)
            }
            (Op::Binary(Sub, [p, q]), Op::Binary(Sub, [r, s])) if q == s => {
                self.to_compare(cond, p, r)
            }
            (Op::Unary(Neg, p), Op::Unary(Neg, q)) => self.to_compare(cond, p, q),
            (Op::Compare(..), Op::Compare(..)) | (Op::FloatCompare(..), Op::FloatCompare(..)) => {
                let differ = self.make_binary(Xor, a, b);
                self.to_compare_int(cond, differ, 0)
            }
            _ => Step::Keep,
        }
    }

    fn equality_with_constant(&mut self, cond: Cond, a: Value, b: Value, c: i64) -> Step {
        let (ty, facts) = (self.type_of(a), self.facts(a));
        let width = ty.width();
        if ty == Type::I32 && facts.is_boolean() {
            match ((cond == Eq) == (c == 1), self.op(a)) {
                (true, _) => return self.is(a),
                (false, Op::Compare(..) | Op::FloatCompare(..)) => {
                    return self.to_binary_int(Xor, a, 1);
                }
                _ => {}
            }
        }
        let unknown = facts.possible() & !facts.ones;
        if c != 0 && facts.ones == 0 && unknown.is_power_of_two() {
            return self.to_compare_int(cond.inverted(), a, 0);
        }
        if c == 0
            && let Some(step) = self.equality_with_zero(cond, a, b)
        {
            return step;
        }
        match self.op(a) {
            Op::Binary(op, [x, d])
                if self.once(a)
                    && let Some(d) = self.int(d) =>
            {
                match op {
                    Add => self.to_compare_int(cond, x, c.wrapping_sub(d)),
                    Xor => self.to_compare_int(cond, x, c ^ d),
                    Mul if d & 1 != 0 => {
                        self.to_compare_int(cond, x, c.wrapping_mul(inverse_of_odd(d)))
                    }
                    RotateRight => {
                        let (bits, amount) = (c as u64 & all_ones(width), u64::from(d as u32));
                        let original =
                            evaluate::binary(crate::ir::Binary::RotateLeft, ty, bits, amount);
                        self.to_compare_int(cond, x, original.unwrap() as i64)
                    }
                    Or if self.facts(x).possible() & d as u64 == 0 => {
                        self.to_compare_int(cond, x, c ^ d)
                    }
                    Shl => {
                        let amount = d as u32 % u32::from(width.bits());
                        let is_exact = self.facts(x).possible() & !(all_ones(width) >> amount) == 0;
                        if !is_exact || c.trailing_zeros() < amount {
                            return Step::Keep;
                        }
                        let unshifted = (c as u64 & all_ones(width)) >> amount;
                        self.to_compare_int(cond, x, unshifted as i64)
                    }
                    _ => Step::Keep,
                }
            }
            Op::Binary(Sub, [d, x])
                if self.once(a)
                    && let Some(d) = self.int(d) =>
            {
                self.to_compare_int(cond, x, d.wrapping_sub(c))
            }
            Op::Unary(Neg, x) => self.to_compare_int(cond, x, c.wrapping_neg()),
            Op::Unary(op @ SwapBytes(size), x) if size == width.size() => {
                let original = evaluate::unary(op, ty, ty, c as u64 & all_ones(width));
                self.to_compare_int(cond, x, original.unwrap() as i64)
            }
            Op::Unary(CountLeadingZeros | CountTrailingZeros, x) if c == width.bits().into() => {
                self.to_compare_int(cond, x, 0)
            }
            Op::VectorReduce(op, vector) if self.target.is_arm64() => {
                self.bitmask_equality(cond, op, vector, c)
            }
            _ => Step::Keep,
        }
    }

    fn equality_with_zero(&mut self, cond: Cond, a: Value, zero: Value) -> Option<Step> {
        /// Both architectures compare with powers of two up to this one without loading them.
        const LARGEST_EXPONENT: u32 = 23;
        let width = self.type_of(a).width();
        let choose = |if_equal, or| if cond == Eq { if_equal } else { or };
        Some(match self.op(a) {
            Op::Binary(Sub | Xor, [x, y]) if self.once(a) => self.to_compare(cond, x, y),
            Op::Binary(And, [x, mask]) if self.bits(mask) == Some(sign_bit(width)) => {
                self.to_compare(choose(Ge, Lt), x, zero)
            }
            Op::Binary(And, [shifted, mask]) if self.once(a) && self.once(shifted) => {
                let ((x, amount), mask) = (self.as_shift(Shr, shifted)?, self.bits(mask)?);
                let unshifted = mask << amount & all_ones(width);
                let is_cheap = unshifted <= u32::MAX.into()
                    || unshifted.is_power_of_two()
                    || self.target.is_arm64();
                let masked = is_cheap.then(|| self.make_binary_int(And, x, unshifted as i64))?;
                self.to_compare(cond, masked, zero)
            }
            Op::Binary(Shr | Sar, [x, amount]) => {
                let amount = self.int(amount)? as u32 % u32::from(width.bits());
                if amount == u32::from(width.bits()) - 1 {
                    self.to_compare(choose(Ge, Lt), x, zero)
                } else if amount <= LARGEST_EXPONENT && self.once(a) {
                    self.to_compare_int(choose(Below, AboveEq), x, 1 << amount)
                } else {
                    return None;
                }
            }
            Op::Binary(RotateRight | crate::ir::Binary::RotateLeft, [x, _])
            | Op::Unary(CountOnes, x) => self.to_compare(cond, x, zero),
            Op::Unary(CountLeadingZeros, x) => self.to_compare(choose(Lt, Ge), x, zero),
            _ => return None,
        })
    }

    /// AArch64 has no instruction that gathers the top bits of lanes.
    fn bitmask_equality(&mut self, cond: Cond, op: VectorReduce, vector: Value, c: i64) -> Step {
        let (lanes, all_true) = match op {
            VectorReduce::I8x16Bitmask => (16, VectorReduce::I8x16AllTrue),
            VectorReduce::I16x8Bitmask => (8, VectorReduce::I16x8AllTrue),
            VectorReduce::I32x4Bitmask => (4, VectorReduce::I32x4AllTrue),
            VectorReduce::I64x2Bitmask => (2, VectorReduce::I64x2AllTrue),
            _ => return Step::Keep,
        };
        let is_mask = matches!(self.op(vector), Op::VectorBinary(op, _)
            if op.mask_lanes().is_some_and(|size| 16 / size.bytes() <= lanes));
        if !is_mask {
            Step::Keep
        } else if c == 0 {
            let any = self.make(Op::VectorReduce(VectorReduce::AnyTrue, vector), Type::I32);
            self.to_compare_int(cond, any, 0)
        } else if c == (1 << lanes) - 1 {
            let all = self.make(Op::VectorReduce(all_true, vector), Type::I32);
            self.to_compare_int(cond, all, 1)
        } else {
            Step::Keep
        }
    }

    fn order(&mut self, cond: Cond, a: Value, b: Value) -> Step {
        let width = self.type_of(a).width();
        for (cond, x, y) in [(cond, a, b), (cond.commuted(), b, a)] {
            match (self.op(x), cond) {
                (Op::Binary(UnsignedRem, [_, divisor]), Below | AboveEq) if divisor == y => {
                    return self.is_bool(cond == Below);
                }
                (Op::Binary(And, [p, q]), BelowEq | Above)
                | (Op::Binary(Or, [p, q]), AboveEq | Below)
                    if p == y || q == y =>
                {
                    return self.is_bool(matches!(cond, BelowEq | AboveEq));
                }
                (Op::Binary(Add, [p, q]), Lt | Le | Gt | Ge)
                    if (p == y || q == y)
                        && Facts::cannot_overflow(Add, width, self.facts(p), self.facts(q)) =>
                {
                    return self.to_compare_int(cond, if p == y { q } else { p }, 0);
                }
                _ => {}
            }
        }
        match (self.as_binary_int(Xor, a), self.as_binary_int(Xor, b)) {
            (Some((x, -1)), Some((y, -1))) => self.to_compare(cond.commuted(), x, y),
            (Some((x, c)), Some((y, d))) if c == d && c == least(width) => {
                self.to_compare(with_other_sign(cond), x, y)
            }
            _ => Step::Keep,
        }
    }

    fn order_with_constant(&mut self, cond: Cond, a: Value, facts: Facts, c: i64) -> Step {
        let width = self.type_of(a).width();
        if let Some((cond, c)) = plainer_limit(cond, width, facts, c) {
            return self.to_compare_int(cond, a, c);
        }
        if cond.is_signed() && facts.min >= 0 {
            return self.to_compare_int(unsigned(cond), a, c);
        }
        let Op::Binary(op, [x, y]) = self.op(a) else {
            return Step::Keep;
        };
        if !self.once(a) {
            return Step::Keep;
        }
        let Some(d) = self.int(y) else {
            let is_exact = op == Sub
                && c == 0
                && cond.is_signed()
                && Facts::cannot_overflow(Sub, width, self.facts(x), self.facts(y));
            return if is_exact {
                self.to_compare(cond, x, y)
            } else {
                Step::Keep
            };
        };
        match op {
            Xor if d == -1 => self.to_compare_int(cond.commuted(), x, !c),
            Xor | Add if d == least(width) => self.to_compare_int(with_other_sign(cond), x, c ^ d),
            Add => {
                let (rest, [c_only, d_only]) =
                    (self.facts(x), [c, d].map(|n| Facts::constant(width, n)));
                let is_exact = Facts::cannot_overflow(Add, width, rest, d_only)
                    && Facts::cannot_overflow(Sub, width, c_only, d_only);
                let has_no_sign = rest.min >= 0 && facts.min >= 0 && c >= d.max(0);
                if is_exact && (cond.is_signed() || has_no_sign) {
                    self.to_compare_int(cond, x, c - d)
                } else {
                    Step::Keep
                }
            }
            Shr | Sar if op == Sar || !cond.is_signed() => {
                let amount = d as u32 % u32::from(width.bits());
                let shifted = extend_sign(width, (c << amount) as u64);
                let is_exact = if op == Shr {
                    (shifted as u64 & all_ones(width)) >> amount == c as u64 & all_ones(width)
                } else {
                    shifted >> amount == c
                };
                let below = if matches!(cond, Le | Gt | BelowEq | Above) {
                    low_bits(amount) as i64
                } else {
                    0
                };
                let is_cheap = width == Width::W32 || i32::try_from(shifted | below).is_ok();
                if is_exact && is_cheap {
                    self.to_compare_int(cond, x, shifted | below)
                } else {
                    Step::Keep
                }
            }
            _ => Step::Keep,
        }
    }
}

/// An equality where the limit leaves one value on a side, or else a comparison with zero.
fn plainer_limit(cond: Cond, width: Width, facts: Facts, c: i64) -> Option<(Cond, i64)> {
    let (min, max) = if cond.is_signed() {
        (facts.min, facts.max)
    } else {
        let (min, max) = facts.unsigned_range(width);
        (extend_sign(width, min), extend_sign(width, max))
    };
    let wrapped = |value: i64| extend_sign(width, value as u64);
    // The last value of the lower part, and whether that is where the comparison holds.
    let (last, holds_below) = match cond {
        Lt | Below => (wrapped(c.wrapping_sub(1)), true),
        Le | BelowEq => (c, true),
        Gt | Above => (c, false),
        _ => (wrapped(c.wrapping_sub(1)), false),
    };
    let choose = |below, above| if holds_below { below } else { above };
    if last == min {
        Some((choose(Eq, Ne), min))
    } else if wrapped(last.wrapping_add(1)) == max {
        Some((choose(Ne, Eq), max))
    } else if !cond.is_signed() {
        (last == greatest(width)).then_some((choose(Ge, Lt), 0))
    } else if c != 0 && last == 0 {
        Some((choose(Le, Gt), 0))
    } else {
        (c != 0 && last == -1).then_some((choose(Lt, Ge), 0))
    }
}
