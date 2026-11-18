//! Sums, differences and products of integers.

use bun_engine_asm::Sign;

use super::Simplifier;
use super::facts::{extend_sign, sign_bit};
use super::rewrite::{Step, shared_operand};
use crate::ir::Binary::{
    Add, And, Div, Mul, Or, Rem, Sar, Shl, Shr, Sub, UnsignedDiv, UnsignedRem, Xor,
};
use crate::ir::Unary::Neg;
use crate::ir::{Binary, Op, Type, Value, evaluate};

impl Simplifier<'_> {
    pub(super) fn binary(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        if let Some(rhs) = self.bits(b) {
            if let Some(lhs) = self.bits(a) {
                return match evaluate::binary(op, ty, lhs, rhs) {
                    Some(result) => self.is_bits(ty, result),
                    None => Step::Keep,
                };
            }
            let apply = |lhs| evaluate::binary(op, ty, lhs, rhs);
            if let Some(step) = self.apply_to_choices(a, ty, apply) {
                return step;
            }
        } else if let Some(lhs) = self.bits(a)
            && let Some(step) =
                self.apply_to_choices(b, ty, |rhs| evaluate::binary(op, ty, lhs, rhs))
        {
            return step;
        }
        if ty.is_float() {
            return self.float_binary(op, ty, a, b);
        }
        match op {
            Add => self.add(ty, a, b),
            Sub => self.sub(ty, a, b),
            Mul => self.mul(ty, a, b),
            And => self.and(ty, a, b),
            Or => self.or(ty, a, b),
            Xor => self.xor(ty, a, b),
            Binary::MulHigh(sign) => self.mul_high(sign, ty, a, b),
            _ if op.is_shift() => self.shift(op, ty, a, b),
            _ => self.division(op, ty, a, b),
        }
    }

    /// A value and a constant of which `value` is the sum.
    pub(super) fn as_offset(&mut self, value: Value) -> Option<(Value, i64)> {
        match self.op(value) {
            Op::Binary(Add | Sub, [a, _]) if self.takes_place_of(value, a) => None,
            Op::Binary(Add, [a, b]) => Some((a, self.int(b)?)),
            Op::Binary(Sub, [a, b]) => Some((a, self.int(b)?.wrapping_neg())),
            Op::Binary(Or, [a, b]) => {
                let bits = self.bits(b)?;
                (self.facts(a).possible() & bits == 0).then_some((a, self.int(b)?))
            }
            _ => None,
        }
    }

    /// A value and a constant of which `value` is the product.
    fn as_multiple(&self, value: Value) -> Option<(Value, i64)> {
        match self.op(value) {
            Op::Binary(Mul, [a, b]) => Some((a, self.int(b)?)),
            Op::Binary(Shl, _) => self
                .as_shift(Shl, value)
                .map(|(a, amount)| (a, 1 << amount)),
            _ => None,
        }
    }

    /// Whether to take the constant out of an operand, so that it meets others. The operand may be worth more whole
    /// because a loop does not change it, unless it goes into an address of x86-64, which has room for an offset.
    pub(super) fn can_take_apart(&self, operand: Value) -> bool {
        let Op::Binary(op, [rest, constant]) = self.op(operand) else {
            return false;
        };
        self.int(constant).is_some_and(|constant| {
            let is_offset = op == Add && self.target.is_x64() && i32::try_from(constant).is_ok();
            self.once(operand) && (is_offset || !self.is_from_outside_loop(rest))
        })
    }

    fn may_be_in_object(&mut self, value: Value) -> bool {
        const LONGEST: i64 = 1 << 40;
        self.function.may_be_in_object(value) && !self.facts(value).is_within(-LONGEST, LONGEST)
    }

    /// Whether `base + step` is on the way to `base + step + rest`, as far as that counts. `sign` is that of the step.
    fn is_on_the_way(&mut self, base: Value, step: Value, sign: i64, rest: i64) -> bool {
        !self.may_be_in_object(step)
            && (!self.may_be_in_object(base)
                || sign * rest.signum() >= 0 && self.is_not_negative(step))
    }

    fn is_in_register(&self, ty: Type, constant: i64) -> bool {
        ty == Type::I64 && self.function.pinned_near(constant as u64, 0..=0).is_some()
    }

    fn add(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if let Some(c) = self.int(b) {
            return match self.add_constant(ty, a, c) {
                Step::Keep if self.is_in_register(ty, c.wrapping_neg()) => {
                    self.to_binary_int(Sub, a, c.wrapping_neg())
                }
                step => step,
            };
        }
        if a == b {
            return self.to_binary_int(Shl, a, 1);
        }
        for (x, y) in [(a, b), (b, a)] {
            match self.op(x) {
                Op::Unary(Neg, p) => return self.to_binary(Sub, y, p),
                Op::Binary(Sub, [p, q]) if q == y => return self.is(p),
                Op::Binary(Sub, [p, q])
                    if self.is_constant(p) && self.once(x) && !self.may_be_in_object(y) =>
                {
                    let difference = self.make_binary(Sub, y, q);
                    return self.to_binary(Add, difference, p);
                }
                Op::Binary(Add, [p, q])
                    if self.can_take_apart(x)
                        && let Some(c) = self.int(q)
                        && (self.is_on_the_way(p, y, 1, c) || self.is_on_the_way(y, p, 1, c)) =>
                {
                    let sum = self.make_binary(Add, p, y);
                    return self.to_binary(Add, sum, q);
                }
                Op::Binary(And, [p, q]) => match self.op(y) {
                    Op::Binary(Or, args) if args == [p, q] => return self.to_binary(Add, p, q),
                    Op::Binary(Xor, args) if args == [p, q] => return self.to_binary(Or, p, q),
                    _ => {}
                },
                Op::Binary(Mul, [p, q]) if p == y && self.once(x) => {
                    if let Some(c) = self.int(q) {
                        return self.to_binary_int(Mul, p, c.wrapping_add(1));
                    }
                }
                Op::Binary(Shl | Shr, _) => {
                    if let Some(step) = self.rotation(Add, x, y) {
                        return step;
                    }
                }
                _ => {}
            }
        }
        self.factor_out(Add, a, b)
    }

    fn add_constant(&mut self, ty: Type, a: Value, c: i64) -> Step {
        if c == 0 {
            return self.is(a);
        }
        if let Some((x, d)) = self.as_offset(a) {
            return self.to_binary_int(Add, x, d.wrapping_add(c));
        }
        match self.op(a) {
            Op::Binary(Sub, [p, x]) => {
                if let Some(d) = self.int(p) {
                    let sum = self.int_like(a, d.wrapping_add(c));
                    return self.to_binary(Sub, sum, x);
                }
            }
            Op::Unary(Neg, x) => {
                let c = self.int_like(a, c);
                return self.to_binary(Sub, c, x);
            }
            Op::Binary(Xor, [x, p]) => match self.int(p) {
                Some(-1) => {
                    let c = self.int_like(a, c.wrapping_sub(1));
                    return self.to_binary(Sub, c, x);
                }
                Some(d) if d == extend_sign(ty.width(), sign_bit(ty.width())) => {
                    return self.to_binary_int(Add, x, c ^ d);
                }
                Some(d) if c == -d => {
                    let field = d.trailing_zeros() + 1;
                    if self.facts(x).possible() >> field == 0 {
                        let unused = i64::from(u32::from(ty.width().bits()) - field);
                        let at_top = self.make_binary_int(Shl, x, unused);
                        return self.to_binary_int(Sar, at_top, unused);
                    }
                }
                _ => {}
            },
            _ => {}
        }
        Step::Keep
    }

    fn sub(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if let Some(c) = self.int(b) {
            return match self.add_constant(ty, a, c.wrapping_neg()) {
                Step::Keep if !self.is_in_register(ty, c) => {
                    self.to_binary_int(Add, a, c.wrapping_neg())
                }
                step => step,
            };
        }
        if let Some(c) = self.int(a) {
            return self.sub_from_constant(c, a, b);
        }
        if a == b {
            return self.is_int(ty, 0);
        }
        match self.op(b) {
            Op::Unary(Neg, y) => return self.to_binary(Add, a, y),
            Op::Binary(Sub, [p, q]) if p == a => return self.is(q),
            Op::Binary(Add, [p, q]) if p == a || q == a => {
                return self.to_unary(Neg, if p == a { q } else { p });
            }
            Op::Binary(Add, [y, c])
                if self.can_take_apart(b)
                    && let Some(rest) = self.int(c)
                    && self.is_on_the_way(a, y, 1, rest) =>
            {
                let difference = self.make_binary(Sub, a, y);
                return self.to_binary(Sub, difference, c);
            }
            Op::Binary(Sub, [c, y])
                if self.is_constant(c)
                    && self.once(b)
                    && !self.may_be_in_object(a)
                    && !self.may_be_in_object(y) =>
            {
                let sum = self.make_binary(Add, a, y);
                return self.to_binary(Sub, sum, c);
            }
            Op::Binary(And, [p, q]) if p == a => {
                if let Some(mask) = self.int(q) {
                    return self.to_binary_int(And, a, !mask);
                }
            }
            Op::Binary(Mul, [p, q]) if self.once(b) => {
                for (quotient, divisor) in [(p, q), (q, p)] {
                    match self.op(quotient) {
                        Op::Binary(Div, args) if args == [a, divisor] && self.once(quotient) => {
                            return self.to_binary(Rem, a, divisor);
                        }
                        Op::Binary(UnsignedDiv, args)
                            if args == [a, divisor] && self.once(quotient) =>
                        {
                            return self.to_binary(UnsignedRem, a, divisor);
                        }
                        _ => {}
                    }
                }
                if let (true, Some(c)) = (p == a, self.int(q)) {
                    return self.to_binary_int(Mul, a, 1i64.wrapping_sub(c));
                }
            }
            _ => {}
        }
        match (self.op(a), self.op(b)) {
            (Op::Binary(Add, [p, q]), _) if p == b || q == b => self.is(if p == b { q } else { p }),
            (Op::Binary(Sub, [p, q]), _) if p == b => self.to_unary(Neg, q),
            (Op::Binary(Add, first), Op::Binary(Add, second))
                if let Some([_, p, q]) = shared_operand(first, second) =>
            {
                self.to_binary(Sub, p, q)
            }
            (Op::Binary(Sub, [p, q]), Op::Binary(Sub, [r, s])) if p == r => {
                self.to_binary(Sub, s, q)
            }
            (Op::Binary(Sub, [p, q]), Op::Binary(Sub, [r, s])) if q == s => {
                self.to_binary(Sub, p, r)
            }
            (Op::Binary(Or, first), Op::Binary(And, second)) if first == second => {
                self.to(Op::Binary(Xor, first))
            }
            (Op::Binary(Or, first), Op::Binary(Xor, second)) if first == second => {
                self.to(Op::Binary(And, first))
            }
            (Op::Unary(Neg, x), _) if self.once(a) => {
                let sum = self.make_binary(Add, x, b);
                self.to_unary(Neg, sum)
            }
            (Op::Binary(Add, [x, c]), _)
                if self.can_take_apart(a)
                    && let Some(rest) = self.int(c)
                    && self.is_on_the_way(x, b, -1, rest) =>
            {
                let difference = self.make_binary(Sub, x, b);
                self.to_binary(Add, difference, c)
            }
            (Op::Binary(Sub, [c, x]), _) if self.is_constant(c) && self.once(a) => {
                let sum = self.make_binary(Add, x, b);
                self.to_binary(Sub, c, sum)
            }
            (Op::Binary(Mul, [x, c]), _)
                if x == b
                    && self.once(a)
                    && let Some(c) = self.int(c) =>
            {
                self.to_binary_int(Mul, x, c.wrapping_sub(1))
            }
            _ => self.factor_out(Sub, a, b),
        }
    }

    fn sub_from_constant(&mut self, c: i64, a: Value, b: Value) -> Step {
        match (c, self.op(b)) {
            (0, _) => self.to_unary(Neg, b),
            (-1, _) => self.to_binary(Xor, b, a),
            (_, Op::Unary(Neg, y)) => self.to_binary(Add, y, a),
            (_, Op::Binary(Add, [y, d])) if let Some(d) = self.int(d) => {
                let difference = self.int_like(a, c.wrapping_sub(d));
                self.to_binary(Sub, difference, y)
            }
            (_, Op::Binary(Sub, [d, y])) if let Some(d) = self.int(d) => {
                self.to_binary_int(Add, y, c.wrapping_sub(d))
            }
            (_, Op::Binary(Xor, [y, d])) if self.int(d) == Some(-1) => {
                self.to_binary_int(Add, y, c.wrapping_add(1))
            }
            _ if self.facts(b).possible() & !(c as u64) == 0 => self.to_binary(Xor, b, a),
            _ => Step::Keep,
        }
    }

    fn factor_out(&mut self, op: Binary, a: Value, b: Value) -> Step {
        if !matches!(self.op(a), Op::Binary(Mul | Shl, _)) || !self.once(a) || !self.once(b) {
            return Step::Keep;
        }
        if let (Some((x, c)), Some((y, d))) = (self.as_multiple(a), self.as_multiple(b))
            && x == y
        {
            let factor = if op == Add {
                c.wrapping_add(d)
            } else {
                c.wrapping_sub(d)
            };
            return self.to_binary_int(Mul, x, factor);
        }
        match (self.op(a), self.op(b)) {
            (Op::Binary(Mul, first), Op::Binary(Mul, second))
                if let Some([shared, p, q]) = shared_operand(first, second) =>
            {
                let factor = self.make_binary(op, p, q);
                self.to_binary(Mul, shared, factor)
            }
            (Op::Binary(Shl, [p, amount]), Op::Binary(Shl, [q, same])) if amount == same => {
                let unshifted = self.make_binary(op, p, q);
                self.to_binary(Shl, unshifted, amount)
            }
            _ => Step::Keep,
        }
    }

    pub(super) fn neg(&mut self, ty: Type, a: Value) -> Step {
        let top = i64::from(ty.width().bits()) - 1;
        match self.op(a) {
            Op::Unary(Neg, x) => self.is(x),
            Op::Binary(Sub, [x, y]) => self.to_binary(Sub, y, x),
            Op::Binary(op, [x, c]) if let Some(c) = self.int(c) => match op {
                Mul if self.once(a) => self.to_binary_int(Mul, x, c.wrapping_neg()),
                Add => {
                    let c = self.int_like(a, c.wrapping_neg());
                    self.to_binary(Sub, c, x)
                }
                Xor if c == -1 => self.to_binary_int(Add, x, 1),
                Shr if c == top => self.to_binary_int(Sar, x, top),
                Sar if c == top => self.to_binary_int(Shr, x, top),
                _ => Step::Keep,
            },
            _ => Step::Keep,
        }
    }

    fn mul(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if let Some(c) = self.int(b) {
            return self.mul_by_constant(ty, a, b, c);
        }
        if let (Some(x), Some(y)) = (self.as_unary(Neg, a), self.as_unary(Neg, b)) {
            return self.to_binary(Mul, x, y);
        }
        for (x, y) in [(a, b), (b, a)] {
            match self.op(x) {
                Op::Unary(Neg, p) if self.once(x) => {
                    let product = self.make_binary(Mul, p, y);
                    return self.to_unary(Neg, product);
                }
                Op::Binary(Shl, [one, amount]) if self.int(one) == Some(1) => {
                    return self.to_binary(Shl, y, amount);
                }
                Op::Binary(Mul, [p, c]) if self.can_take_apart(x) => {
                    let product = self.make_binary(Mul, p, y);
                    return self.to_binary(Mul, product, c);
                }
                _ => {}
            }
        }
        Step::Keep
    }

    fn mul_by_constant(&mut self, ty: Type, a: Value, b: Value, c: i64) -> Step {
        match c {
            0 => return self.is(b),
            1 => return self.is(a),
            -1 => return self.to_unary(Neg, a),
            _ => {}
        }
        if let Some((x, d)) = self.as_multiple(a) {
            return self.to_binary_int(Mul, x, d.wrapping_mul(c));
        }
        let amount = c.trailing_zeros();
        if c == extend_sign(ty.width(), 1 << amount) {
            return self.to_binary_int(Shl, a, amount.into());
        }
        match self.op(a) {
            Op::Unary(Neg, x) => self.to_binary_int(Mul, x, c.wrapping_neg()),
            Op::Binary(Add, [x, d])
                if self.once(a)
                    && let Some(d) = self.int(d) =>
            {
                let product = self.make_binary(Mul, x, b);
                self.to_binary_int(Add, product, d.wrapping_mul(c))
            }
            _ if c >> amount == -1 => {
                let shifted = self.make_binary_int(Shl, a, amount.into());
                self.to_unary(Neg, shifted)
            }
            _ => Step::Keep,
        }
    }

    fn mul_high(&mut self, sign: Sign, ty: Type, a: Value, b: Value) -> Step {
        let Some(c) = self.bits(b) else {
            return Step::Keep;
        };
        if let Some(only) = self
            .facts_of(Op::Binary(Binary::MulHigh(sign), [a, b]), ty)
            .only_value()
        {
            return self.is_int(ty, only);
        }
        let dropped = i64::from(ty.width().bits()) - i64::from(c.trailing_zeros());
        match sign {
            _ if !c.is_power_of_two() => Step::Keep,
            Sign::Unsigned => self.to_binary_int(Shr, a, dropped),
            Sign::Signed if c == 1 => self.to_binary_int(Sar, a, -1),
            Sign::Signed if c != sign_bit(ty.width()) => self.to_binary_int(Sar, a, dropped),
            Sign::Signed => Step::Keep,
        }
    }
}
