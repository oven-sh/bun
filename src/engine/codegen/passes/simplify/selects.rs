//! Choices between two values.

use bun_engine_asm::{Cond, FloatCond};

use super::Simplifier;
use super::rewrite::{Step, shared_operand};
use crate::ir::Binary::{Add, And, Or, Sar, Shl, Xor};
use crate::ir::Unary::{CanonicalizeNan, Neg, Widen};
use crate::ir::{Op, Type, Value, evaluate};

impl Simplifier<'_> {
    /// For a choice between constants: does to each what is done to the result.
    #[inline]
    pub(super) fn apply_to_choices(
        &mut self,
        value: Value,
        ty: Type,
        apply: impl Fn(u64) -> Option<u64>,
    ) -> Option<Step> {
        let Op::Select([condition, then, or]) = self.op(value) else {
            return None;
        };
        let (then, or) = (apply(self.bits(then)?)?, apply(self.bits(or)?)?);
        self.once(value).then(|| {
            let (then, or) = (self.constant(ty, then), self.constant(ty, or));
            self.to_select(condition, then, or)
        })
    }

    pub(super) fn select(&mut self, ty: Type, condition: Value, then: Value, or: Value) -> Step {
        if then == or {
            return self.is(then);
        }
        let facts = self.facts(condition);
        if facts.is_not_zero() || facts.possible() == 0 {
            return self.is(if facts.possible() == 0 { or } else { then });
        }
        if let Some(inner) = self.same_truth(condition) {
            return self.to_select(inner, then, or);
        }
        match self.op(condition) {
            Op::Compare(Cond::Eq, [x, zero]) if self.int(zero) == Some(0) => {
                return self.to_select(x, or, then);
            }
            Op::Binary(Xor, [x, one]) if self.int(one) == Some(1) && facts.is_boolean() => {
                return self.to_select(x, or, then);
            }
            Op::Compare(cond @ (Cond::Eq | Cond::Ne), [x, y])
                if [then, or] == [x, y] || [then, or] == [y, x] =>
            {
                return self.is(if cond == Cond::Eq { or } else { then });
            }
            Op::FloatCompare(cond @ (FloatCond::Ordered | FloatCond::Unordered), [x, same])
                if x == same && ty == Type::F64 =>
            {
                let (number, nan) = if cond == FloatCond::Ordered {
                    (then, or)
                } else {
                    (or, then)
                };
                if number == x && self.bits(nan) == Some(evaluate::CANONICAL_NAN) {
                    return self.to_unary(CanonicalizeNan, x);
                }
            }
            _ => {}
        }
        match (self.op(then), self.op(or)) {
            (Op::Select([same, inner, _]), _) if same == condition => {
                self.to_select(condition, inner, or)
            }
            (_, Op::Select([same, _, inner])) if same == condition => {
                self.to_select(condition, then, inner)
            }
            _ if !ty.is_int() => Step::Keep,
            _ if or == condition => {
                let zero = self.constant(ty, 0);
                self.to_select(condition, then, zero)
            }
            _ if then == condition && self.int(or) == Some(0) => self.is(then),
            (Op::Binary(op, first), Op::Binary(same, second))
                if op == same && self.once(then) && self.once(or) =>
            {
                if op.is_commutative()
                    && let Some([shared, p, q]) = shared_operand(first, second)
                {
                    let chosen = self.make(Op::Select([condition, p, q]), ty);
                    self.to_binary(op, shared, chosen)
                } else if first[1] == second[1] {
                    let chosen = self.make(Op::Select([condition, first[0], second[0]]), ty);
                    self.to_binary(op, chosen, first[1])
                } else {
                    Step::Keep
                }
            }
            (Op::Unary(op @ Widen(_), p), Op::Unary(same, q)) if op == same => {
                let chosen = self.make(Op::Select([condition, p, q]), Type::I32);
                self.to_unary(op, chosen)
            }
            _ => match (self.int(then), self.int(or)) {
                (Some(then), Some(or)) => self.select_constants(ty, condition, then, or),
                (None, None) => Step::Keep,
                _ => self.select_boolean(ty, condition, then, or),
            },
        }
    }

    /// An I32 that is 1 if whether `condition` is zero is as `is_zero` says, and else 0.
    fn make_boolean(&mut self, condition: Value, is_zero: bool) -> Value {
        self.make_compare_int(if is_zero { Cond::Eq } else { Cond::Ne }, condition, 0)
    }

    fn select_constants(&mut self, ty: Type, condition: Value, then: i64, or: i64) -> Step {
        let top = i64::from(ty.width().bits()) - 1;
        if let (Op::Compare(cond @ (Cond::Lt | Cond::Ge), [x, zero]), (-1, 0) | (0, -1)) =
            (self.op(condition), (then, or))
            && self.int(zero) == Some(0)
            && self.type_of(x) == ty
            && (cond == Cond::Lt) == (then == -1)
        {
            return self.to_binary_int(Sar, x, top);
        }
        let (is_zero, added, base) = match then.wrapping_sub(or) {
            _ if or == 0 => (false, then, 0),
            _ if then == 0 => (true, or, 0),
            1 => (false, 1, or),
            -1 => (true, 1, then),
            _ => return Step::Keep,
        };
        if added != -1 && !(added > 0 && added.count_ones() == 1) {
            return Step::Keep;
        }
        let boolean = self.make_boolean(condition, is_zero);
        let boolean = self.make_of_type(ty, boolean);
        if added == -1 {
            self.to_unary(Neg, boolean)
        } else if base == 0 {
            self.to_binary_int(Shl, boolean, added.trailing_zeros().into())
        } else {
            self.to_binary_int(Add, boolean, base)
        }
    }

    /// One of the two is a constant.
    fn select_boolean(&mut self, ty: Type, condition: Value, then: Value, or: Value) -> Step {
        let (op, is_zero, other) = match (self.int(then), self.int(or)) {
            (_, Some(0)) => (And, false, then),
            (_, Some(1)) => (Or, true, then),
            (Some(0), _) => (And, true, or),
            (Some(1), _) => (Or, false, or),
            _ => return Step::Keep,
        };
        if ty != Type::I32 || !self.is_boolean(other) {
            return Step::Keep;
        }
        let boolean = self.make_boolean(condition, is_zero);
        self.to_binary(op, boolean, other)
    }
}
