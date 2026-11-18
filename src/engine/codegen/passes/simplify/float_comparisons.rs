//! Comparisons of floats.

use bun_engine_asm::FloatCond::{
    Eq, EqOrUnordered, Ge, GeOrUnordered, Gt, GtOrUnordered, Le, LeOrUnordered, Lt, LtOrUnordered,
    Ne, NeOrUnordered, Ordered, Unordered,
};
use bun_engine_asm::{Cond, FloatCond, Sign};

use super::Simplifier;
use super::rewrite::Step;
use crate::ir::Unary::{Abs, CanonicalizeNan, Neg, Promote};
use crate::ir::{Op, Type, Value, evaluate};

/// For operands that are ordered. `None` for the tests whether they are.
fn for_integers(cond: FloatCond) -> Option<Cond> {
    Some(match cond {
        Eq | EqOrUnordered => Cond::Eq,
        Ne | NeOrUnordered => Cond::Ne,
        Lt | LtOrUnordered => Cond::Lt,
        Le | LeOrUnordered => Cond::Le,
        Gt | GtOrUnordered => Cond::Gt,
        Ge | GeOrUnordered => Cond::Ge,
        Ordered | Unordered => return None,
    })
}

impl Simplifier<'_> {
    pub(super) fn float_compare(&mut self, cond: FloatCond, a: Value, b: Value) -> Step {
        let ty = self.type_of(a);
        if let (Some(x), Some(y)) = (self.bits(a), self.bits(b)) {
            return self.is_bool(evaluate::float_compare(cond, ty, x, y));
        }
        if a == b {
            return self.by_whether_nan(cond, cond.holds(0.0, 0.0), a);
        }
        match (self.op(a), self.op(b)) {
            (Op::Unary(CanonicalizeNan, x), _) => return self.to_float_compare(cond, x, b),
            (_, Op::Unary(CanonicalizeNan, y)) => return self.to_float_compare(cond, a, y),
            (Op::Unary(Promote, x), Op::Unary(Promote, y)) => {
                return self.to_float_compare(cond, x, y);
            }
            (Op::Unary(Neg, x), Op::Unary(Neg, y)) => return self.to_float_compare(cond, y, x),
            _ => {}
        }
        if let Some(c) = self.float(b)
            && let Some(step) = self.compare_with_number(cond, a, c)
        {
            return step;
        }
        if let (Some(cond), Some(x), Some(y)) = (
            for_integers(cond),
            self.exact_integer(a),
            self.exact_integer(b),
        ) {
            let (x, y) = (self.make_i64(x), self.make_i64(y));
            return self.to_compare(cond, x, y);
        }
        match (self.is_never_nan(a), self.is_never_nan(b), cond) {
            (true, _, Ordered | Unordered) => self.to_float_compare(cond, b, b),
            (_, true, Ordered | Unordered) => self.to_float_compare(cond, a, a),
            (true, true, _) if self.cheapest_for_numbers(cond) != cond => {
                self.to_float_compare(self.cheapest_for_numbers(cond), a, b)
            }
            _ => Step::Keep,
        }
    }

    /// One flag tells equality, and it is set for unordered operands on x86-64 only.
    fn cheapest_for_numbers(&self, cond: FloatCond) -> FloatCond {
        match cond {
            Eq | EqOrUnordered => {
                if self.target.is_x64() {
                    EqOrUnordered
                } else {
                    Eq
                }
            }
            Ne | NeOrUnordered => {
                if self.target.is_x64() {
                    Ne
                } else {
                    NeOrUnordered
                }
            }
            LtOrUnordered => Lt,
            LeOrUnordered => Le,
            GtOrUnordered => Gt,
            GeOrUnordered => Ge,
            _ => cond,
        }
    }

    /// The other operand is no NaN, unless it is `a` too, and the result is known for the case that neither is.
    fn by_whether_nan(&mut self, cond: FloatCond, if_number: bool, a: Value) -> Step {
        if if_number == cond.holds(f64::NAN, 0.0) || self.is_never_nan(a) {
            return self.is_bool(if_number);
        }
        let test = if if_number { Ordered } else { Unordered };
        match self.op(a) {
            Op::Unary(Neg | Abs | Promote | CanonicalizeNan, x) => {
                self.to_float_compare(test, x, x)
            }
            _ if test != cond => self.to_float_compare(test, a, a),
            _ => Step::Keep,
        }
    }

    fn compare_with_number(&mut self, cond: FloatCond, a: Value, c: f64) -> Option<Step> {
        let ty = self.type_of(a);
        if c.is_nan() {
            return Some(self.is_bool(cond.holds(0.0, c)));
        }
        let cond_of_numbers = for_integers(cond)?;
        let least = if self.as_unary(Abs, a).is_some() {
            0.0
        } else {
            f64::NEG_INFINITY
        };
        let at_ends = [least, f64::INFINITY].map(|end| cond.holds(end, c));
        let is_monotonic = !matches!(cond_of_numbers, Cond::Eq | Cond::Ne) || c < least;
        if is_monotonic && at_ends[0] == at_ends[1] {
            return Some(self.by_whether_nan(cond, at_ends[0], a));
        }
        match self.op(a) {
            Op::Unary(Neg, x) => {
                let bits = if ty == Type::F32 {
                    (-c as f32).to_bits().into()
                } else {
                    (-c).to_bits()
                };
                let negated = self.constant(ty, bits);
                Some(self.to_float_compare(cond.commuted(), x, negated))
            }
            Op::Unary(Promote, x) if f64::from(c as f32) == c => {
                let narrow = self.constant(Type::F32, (c as f32).to_bits().into());
                Some(self.to_float_compare(cond, x, narrow))
            }
            _ => {
                let integer = self.exact_integer(a)?;
                Some(self.compare_integer_with_number(cond_of_numbers, integer, c))
            }
        }
    }

    fn compare_integer_with_number(&mut self, cond: Cond, integer: (Value, Sign), c: f64) -> Step {
        let limit = match cond {
            Cond::Eq | Cond::Ne if c.fract() != 0.0 => return self.is_bool(cond == Cond::Ne),
            Cond::Lt | Cond::Ge => c.ceil(),
            _ => c.floor(),
        };
        let wide = self.make_i64(integer);
        // What saturates is still beyond the integers that floats hold exactly.
        self.to_compare_int(cond, wide, limit as i64)
    }
}
