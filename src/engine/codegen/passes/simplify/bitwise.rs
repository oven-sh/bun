//! And, or and exclusive or of integers.

use bun_engine_asm::{Cond, Sign, Size};

use super::Simplifier;
use super::facts::{all_ones, extend_sign, sign_bit};
use super::rewrite::{Step, shared_operand};
use crate::ir::Binary::{Add, And, Or, RotateRight, Shl, Shr, Sub, Xor};
use crate::ir::Unary::{Neg, Widen};
use crate::ir::{Binary, Op, Type, Unary, Value};

pub(super) fn is_low_mask(bits: u64) -> bool {
    bits & bits.wrapping_add(1) == 0
}

impl Simplifier<'_> {
    pub(super) fn and(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if let Some(mask) = self.bits(b) {
            return self.and_constant(ty, a, b, mask);
        }
        if a == b {
            return self.is(a);
        }
        for (x, y) in [(a, b), (b, a)] {
            match self.op(x) {
                Op::Binary(Or, [p, q]) if p == y || q == y => return self.is(y),
                Op::Binary(And, [p, q]) if p == y || q == y => return self.is(x),
                Op::Binary(Xor, [p, q]) if p == y && self.int(q) == Some(-1) => {
                    return self.is_int(ty, 0);
                }
                Op::Binary(Or, [p, q]) => {
                    if let Some([kept, _]) = [[p, q], [q, p]]
                        .into_iter()
                        .find(|&[_, other]| self.as_not(other) == Some(y))
                    {
                        return self.to_binary(And, kept, y);
                    }
                }
                Op::Binary(And, [p, c]) if self.can_take_apart(x) => {
                    let unmasked = self.make_binary(And, p, y);
                    return self.to_binary(And, unmasked, c);
                }
                _ => {}
            }
        }
        if let Some(step) = self.bitwise_of_like_operands(And, a, b) {
            return step;
        }
        let (first, second) = (self.facts(a), self.facts(b));
        if first.possible() & second.possible() == 0 {
            return self.is_int(ty, 0);
        }
        for (x, own, other) in [(a, first, second), (b, second, first)] {
            if own.possible() & !other.ones == 0 {
                return self.is(x);
            }
        }
        Step::Keep
    }

    fn and_constant(&mut self, ty: Type, a: Value, b: Value, mask: u64) -> Step {
        let facts = self.facts(a);
        if mask & facts.possible() & !facts.ones == 0 {
            return self.is_bits(ty, mask & facts.ones);
        }
        if facts.possible() & !mask == 0 {
            return self.is(a);
        }
        if let Some(stripped) = self.strip(a, mask) {
            return self.to_binary(And, stripped, b);
        }
        match self.op(a) {
            Op::Binary(op, [x, c]) if let Some(c) = self.bits(c) => match op {
                And => return self.to_binary_int(And, x, (c & mask) as i64),
                Xor | Or if self.once(a) => {
                    let masked = self.make_binary(And, x, b);
                    return self.to_binary_int(op, masked, (c & mask) as i64);
                }
                Shl if self.once(a) => {
                    let unshifted = mask >> (c % u64::from(ty.width().bits()));
                    if is_low_mask(unshifted) {
                        let masked = self.make_binary_int(And, x, unshifted as i64);
                        return self.to_binary_int(Shl, masked, c as i64);
                    }
                }
                _ => {}
            },
            Op::Unary(Widen(Sign::Unsigned), x) => {
                let masked = self.make_binary_int(And, x, mask as i64);
                return self.to_unary(Widen(Sign::Unsigned), masked);
            }
            Op::Unary(Neg, x) if mask == 1 => return self.to_binary(And, x, b),
            Op::Load { .. } if ty == Type::I32 && matches!(mask, 0xff | 0xffff) => {
                let size = if mask == 0xff { Size::S8 } else { Size::S16 };
                if let Some(narrow) = self.load_part(a, 0, size, Sign::Unsigned) {
                    return self.is(narrow);
                }
            }
            _ => {}
        }
        if ty == Type::I64 && mask == u32::MAX.into() {
            let low = self.make_wrap(a);
            return self.to_unary(Widen(Sign::Unsigned), low);
        }
        Step::Keep
    }

    pub(super) fn or(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if let Some(mask) = self.bits(b) {
            return self.or_constant(ty, a, b, mask);
        }
        if a == b {
            return self.is(a);
        }
        for (x, y) in [(a, b), (b, a)] {
            match self.op(x) {
                Op::Binary(And, [p, q]) if p == y || q == y => return self.is(y),
                Op::Binary(Or, [p, q]) if p == y || q == y => return self.is(x),
                Op::Binary(Xor, [p, q]) if p == y && self.int(q) == Some(-1) => {
                    return self.is_int(ty, -1);
                }
                Op::Binary(Xor, [p, q]) if p == y || q == y => return self.to_binary(Or, p, q),
                Op::Binary(Xor, [p, q]) if self.as_binary(And, y) == Some([p, q]) => {
                    return self.to_binary(Or, p, q);
                }
                Op::Binary(And, [p, q]) => {
                    if let Some([kept, _]) = [[p, q], [q, p]]
                        .into_iter()
                        .find(|&[_, other]| self.as_not(other) == Some(y))
                    {
                        return self.to_binary(Or, kept, y);
                    }
                }
                Op::Binary(Or, [p, c]) if self.can_take_apart(x) => {
                    let rest = self.make_binary(Or, p, y);
                    return self.to_binary(Or, rest, c);
                }
                Op::Binary(Shl | Shr, _) => {
                    if let Some(step) = self.rotation(Or, x, y) {
                        return step;
                    }
                }
                _ => {}
            }
        }
        if let Some(step) = self.or_of_bytes(ty, a, b) {
            return step;
        }
        if let Some(step) = self.bitwise_of_like_operands(Or, a, b) {
            return step;
        }
        let (first, second) = (self.facts(a), self.facts(b));
        for (x, own, other) in [(a, first, second), (b, second, first)] {
            if other.possible() & !own.ones == 0 {
                return self.is(x);
            }
        }
        Step::Keep
    }

    fn or_constant(&mut self, ty: Type, a: Value, b: Value, mask: u64) -> Step {
        let facts = self.facts(a);
        if facts.possible() & !facts.ones & !mask == 0 {
            return self.is_bits(ty, mask | facts.ones);
        }
        if mask & !facts.ones == 0 {
            return self.is(a);
        }
        if let Some(stripped) = self.strip(a, !mask & all_ones(ty.width())) {
            return self.to_binary(Or, stripped, b);
        }
        match self.op(a) {
            Op::Binary(op, [x, c]) if let Some(c) = self.bits(c) => match op {
                Or => self.to_binary_int(Or, x, (c | mask) as i64),
                Xor if self.once(a) => {
                    let set = self.make_binary(Or, x, b);
                    self.to_binary_int(Xor, set, (c & !mask) as i64)
                }
                _ => Step::Keep,
            },
            Op::Unary(Widen(Sign::Unsigned), x) if mask >> 32 == 0 && self.once(a) => {
                let narrow = self.make_binary_int(Or, x, mask as i64);
                self.to_unary(Widen(Sign::Unsigned), narrow)
            }
            _ => Step::Keep,
        }
    }

    pub(super) fn xor(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if let Some(c) = self.int(b) {
            return self.xor_constant(ty, a, c);
        }
        if a == b {
            return self.is_int(ty, 0);
        }
        for (x, y) in [(a, b), (b, a)] {
            match self.op(x) {
                Op::Binary(Xor, [p, q]) if p == y || q == y => {
                    return self.is(if p == y { q } else { p });
                }
                Op::Binary(Xor, [p, c]) if self.can_take_apart(x) => {
                    let rest = self.make_binary(Xor, p, y);
                    return self.to_binary(Xor, rest, c);
                }
                Op::Binary(Or, [p, q]) if self.as_binary(And, y) == Some([p, q]) => {
                    return self.to_binary(Xor, p, q);
                }
                Op::Binary(op @ (And | Or), [p, q]) if self.as_binary(Xor, y) == Some([p, q]) => {
                    return self.to_binary(if op == And { Or } else { And }, p, q);
                }
                Op::Binary(op @ (And | Or), [p, q]) if (p == y || q == y) && self.once(x) => {
                    let other = if p == y { q } else { p };
                    let (kept, cleared) = if op == And { (y, other) } else { (other, y) };
                    let inverse = self.make_binary_int(Xor, cleared, -1);
                    return self.to_binary(And, kept, inverse);
                }
                Op::Binary(Shl | Shr, _) => {
                    if let Some(step) = self.rotation(Xor, x, y) {
                        return step;
                    }
                }
                _ => {}
            }
        }
        self.bitwise_of_like_operands(Xor, a, b)
            .unwrap_or(Step::Keep)
    }

    fn xor_constant(&mut self, ty: Type, a: Value, c: i64) -> Step {
        let sign = extend_sign(ty.width(), sign_bit(ty.width()));
        match (self.op(a), c) {
            (_, 0) => self.is(a),
            (Op::Compare(cond, [x, y]), 1) => self.to_compare(cond.inverted(), x, y),
            (Op::FloatCompare(cond, [x, y]), 1) => self.to_float_compare(cond.inverted(), x, y),
            (Op::Unary(Neg, x), -1) => self.to_binary_int(Add, x, -1),
            (Op::Binary(Sub, [d, x]), -1) if let Some(d) = self.int(d) => {
                self.to_binary_int(Add, x, !d)
            }
            (Op::Binary(op, [x, d]), _) if let Some(d) = self.int(d) => match op {
                Xor => self.to_binary_int(Xor, x, c ^ d),
                Add if c == -1 => {
                    let d = self.int_like(a, !d);
                    self.to_binary(Sub, d, x)
                }
                Add if c == sign => self.to_binary_int(Add, x, c ^ d),
                Or if c == d => self.to_binary_int(And, x, !d),
                Shr if c == 1 && d == i64::from(ty.width().bits()) - 1 && ty == Type::I32 => {
                    self.to_compare_int(Cond::Ge, x, 0)
                }
                _ => Step::Keep,
            },
            (Op::Unary(Widen(Sign::Unsigned), x), 0..=0xffff_ffff) if self.once(a) => {
                let narrow = self.make_binary_int(Xor, x, c);
                self.to_unary(Widen(Sign::Unsigned), narrow)
            }
            _ => Step::Keep,
        }
    }

    /// Does once to the result what is done to both operands.
    fn bitwise_of_like_operands(&mut self, op: Binary, a: Value, b: Value) -> Option<Step> {
        let operands = (self.op(a), self.op(b));
        if let (Op::Compare(..), Op::Compare(..)) | (Op::FloatCompare(..), Op::FloatCompare(..)) =
            operands
        {
            return self.combine_comparisons(op, a, b);
        }
        if !self.once(a) || !self.once(b) {
            return None;
        }
        match operands {
            (Op::Binary(inner, first), Op::Binary(same, second)) if inner == same => {
                let distributes = matches!((inner, op), (And, Or | Xor) | (Or, And));
                if distributes && let Some([shared, p, q]) = shared_operand(first, second) {
                    let rest = self.make_binary(op, p, q);
                    return Some(self.to_binary(inner, shared, rest));
                }
                if first[1] != second[1] {
                    return None;
                }
                if inner.is_shift() {
                    let unshifted = self.make_binary(op, first[0], second[0]);
                    return Some(self.to_binary(inner, unshifted, first[1]));
                }
                (inner == Xor && op != Xor && self.int(first[1]) == Some(-1)).then(|| {
                    let dual =
                        self.make_binary(if op == And { Or } else { And }, first[0], second[0]);
                    self.to_binary(Xor, dual, first[1])
                })
            }
            (Op::Unary(inner, x), Op::Unary(same, y)) if inner == same => {
                let moves_bits =
                    matches!(inner, Widen(_) | Unary::SignExtend(_) | Unary::SwapBytes(_));
                moves_bits.then(|| {
                    let combined = self.make_binary(op, x, y);
                    self.to_unary(inner, combined)
                })
            }
            _ => None,
        }
    }

    /// `op` puts together `x`, which is a shift, and `y`.
    pub(super) fn rotation(&mut self, op: Binary, x: Value, y: Value) -> Option<Step> {
        let (Op::Binary(first, [value, amount]), Op::Binary(second, [same, rest])) =
            (self.op(x), self.op(y))
        else {
            return None;
        };
        if value != same || !matches!((first, second), (Shl, Shr) | (Shr, Shl)) {
            return None;
        }
        let bits = i64::from(self.type_of(value).width().bits());
        let rotate = if first == Shr {
            RotateRight
        } else {
            Binary::RotateLeft
        };
        if let (Some(amount), Some(rest)) = (self.int(amount), self.int(rest)) {
            let add_up = (amount & (bits - 1)) + (rest & (bits - 1)) == bits;
            return add_up.then(|| self.to_binary_int(rotate, value, amount));
        }
        // Where both shift by nothing, only this leaves the value as it is.
        (op == Or && self.negated_amount(rest, bits) == Some(amount))
            .then(|| self.to_binary(rotate, value, amount))
    }

    /// The amount that adds up with `amount` to a multiple of `bits`.
    pub(super) fn negated_amount(&self, amount: Value, bits: i64) -> Option<Value> {
        match self.op(amount) {
            Op::Unary(Neg, negated) => Some(negated),
            Op::Binary(Sub, [whole, part]) => (self.int(whole)? % bits == 0).then_some(part),
            _ => None,
        }
    }
}
