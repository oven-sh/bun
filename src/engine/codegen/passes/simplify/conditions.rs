//! Two comparisons that amount to one, and values of which only counts whether they are zero.

use bun_engine_asm::Cond::{Above, AboveEq, Below, BelowEq, Eq, Ge, Le, Lt, Ne};
use bun_engine_asm::{Cond, FloatCond, Width};

use super::Simplifier;
use super::facts::{all_ones, extend_sign, sign_bit};
use super::rewrite::Step;
use crate::ir::Binary::{Add, And, Mul, Or, RotateLeft, RotateRight, Shl, Xor};
use crate::ir::Unary::{CountOnes, Neg, Widen};
use crate::ir::{Binary, Op, Value};

const LESS: u8 = 1;
const EQUAL: u8 = 2;
const GREATER: u8 = 4;
const UNORDERED: u8 = 8;

fn outcomes(cond: Cond) -> u8 {
    let holds = |lhs, outcome| if cond.holds32(lhs, 1) { outcome } else { 0 };
    holds(0, LESS) | holds(1, EQUAL) | holds(2, GREATER)
}

pub(super) fn float_outcomes(cond: FloatCond) -> u8 {
    let holds = |lhs, outcome| if cond.holds(lhs, 1.0) { outcome } else { 0 };
    holds(0.0, LESS) | holds(1.0, EQUAL) | holds(2.0, GREATER) | holds(f64::NAN, UNORDERED)
}

fn combine(op: Binary, first: u8, second: u8) -> u8 {
    match op {
        And => first & second,
        Or => first | second,
        _ => first ^ second,
    }
}

/// The values from `first` up to `first + span`, going on at zero after the greatest. It is neither empty nor full.
#[derive(Clone, Copy)]
struct Arc {
    first: u64,
    span: u64,
}

enum Part {
    Nothing,
    One(Arc),
    Two,
}

impl Arc {
    /// `None` if the comparison always or never holds.
    fn satisfying(cond: Cond, width: Width, c: u64) -> Option<Self> {
        let ones = all_ones(width);
        let lowest = if cond.is_signed() { sign_bit(width) } else { 0 };
        let rank = c.wrapping_sub(lowest) & ones;
        match cond {
            Eq => Some(Self { first: c, span: 0 }),
            Lt | Below => Some(Self {
                first: lowest,
                span: rank.checked_sub(1)?,
            }),
            Le | BelowEq => (rank != ones).then_some(Self {
                first: lowest,
                span: rank,
            }),
            _ => Some(Self::satisfying(cond.inverted(), width, c)?.complement(width)),
        }
    }

    fn complement(self, width: Width) -> Self {
        let ones = all_ones(width);
        Self {
            first: self.first.wrapping_add(self.span).wrapping_add(1) & ones,
            span: ones - self.span - 1,
        }
    }

    fn intersection(self, other: Self, width: Width) -> Part {
        let ones = all_ones(width);
        let distance = other.first.wrapping_sub(self.first) & ones;
        let from_start_of_other = (distance <= self.span).then(|| Self {
            first: other.first,
            span: other.span.min(self.span - distance),
        });
        let from_own_start = other
            .span
            .checked_sub(ones - distance)
            .and_then(|past| past.checked_sub(1));
        let from_own_start = from_own_start.map(|span| Self {
            first: self.first,
            span: span.min(self.span),
        });
        match (from_start_of_other, from_own_start) {
            (None, None) => Part::Nothing,
            (Some(part), None) | (None, Some(part)) => Part::One(part),
            _ => Part::Two,
        }
    }
}

impl Simplifier<'_> {
    /// `op` is `And`, `Or` or `Xor`.
    pub(super) fn combine_comparisons(&mut self, op: Binary, a: Value, b: Value) -> Option<Step> {
        match (self.op(a), self.op(b)) {
            (Op::Compare(first, args), Op::Compare(second, others)) if args == others => {
                let is_equality = |cond| matches!(cond, Eq | Ne);
                let agree = first.is_signed() == second.is_signed()
                    || is_equality(first)
                    || is_equality(second);
                let wanted = combine(op, outcomes(first), outcomes(second));
                let is_signed = first.is_signed() || second.is_signed();
                let mut conds = Cond::ALL.into_iter();
                let found = conds.find(|&cond| {
                    outcomes(cond) == wanted && (is_equality(cond) || cond.is_signed() == is_signed)
                });
                agree.then(|| match found {
                    Some(cond) => self.to(Op::Compare(cond, args)),
                    None => self.is_bool(wanted != 0),
                })
            }
            (Op::Compare(first, [x, c]), Op::Compare(second, [y, d])) => {
                if x == y
                    && op != Xor
                    && let (Some(c), Some(d)) = (self.bits(c), self.bits(d))
                {
                    return self.combine_limits(op, [a, b], x, (first, c), (second, d));
                }
                if !self.once(a) || !self.once(b) || self.type_of(x) != self.type_of(y) {
                    return None;
                }
                if c == d && self.int(c) == Some(0) {
                    return self.combine_tests_of_zero(op, (first, x), (second, y));
                }
                self.combine_to_bounds_check(op, [a, b])
            }
            (Op::FloatCompare(first, args), Op::FloatCompare(second, others)) if args == others => {
                let wanted = combine(op, float_outcomes(first), float_outcomes(second));
                let mut conds = FloatCond::ALL.into_iter();
                Some(match conds.find(|&cond| float_outcomes(cond) == wanted) {
                    Some(cond) => self.to(Op::FloatCompare(cond, args)),
                    None => self.is_bool(wanted != 0),
                })
            }
            (Op::FloatCompare(first, [x, same]), Op::FloatCompare(second, [y, other])) => {
                let tests_nan = matches!(
                    (op, first),
                    (And, FloatCond::Ordered) | (Or, FloatCond::Unordered)
                );
                let fits = first == second
                    && x == same
                    && y == other
                    && self.type_of(x) == self.type_of(y);
                (tests_nan && fits).then(|| self.to_float_compare(first, x, y))
            }
            _ => None,
        }
    }

    fn combine_limits(
        &mut self,
        op: Binary,
        comparisons: [Value; 2],
        x: Value,
        (first, c): (Cond, u64),
        (second, d): (Cond, u64),
    ) -> Option<Step> {
        let width = self.type_of(x).width();
        let flip = |arc: Arc| if op == Or { arc.complement(width) } else { arc };
        let (p, q) = (
            Arc::satisfying(first, width, c)?,
            Arc::satisfying(second, width, d)?,
        );
        let arc = match flip(p).intersection(flip(q), width) {
            Part::Nothing => return Some(self.is_bool(op == Or)),
            Part::One(part) => flip(part),
            Part::Two => return None,
        };
        let (ones, sign) = (all_ones(width), sign_bit(width));
        let (last, outside) = (
            arc.first.wrapping_add(arc.span) & ones,
            arc.complement(width),
        );
        let (cond, limit) = if arc.span == 0 {
            (Eq, arc.first)
        } else if outside.span == 0 {
            (Ne, outside.first)
        } else if arc.first == 0 || arc.first == sign {
            (if arc.first == 0 { Below } else { Lt }, outside.first)
        } else if last == ones || last == sign - 1 {
            (if last == ones { AboveEq } else { Ge }, arc.first)
        } else if comparisons.iter().all(|&comparison| self.once(comparison)) {
            let (cond, tested) = if arc.span <= outside.span {
                (BelowEq, arc)
            } else {
                (Above, outside)
            };
            let moved =
                self.make_binary_int(Add, x, extend_sign(width, tested.first).wrapping_neg());
            return Some(self.to_compare_int(cond, moved, tested.span as i64));
        } else {
            return None;
        };
        Some(self.to_compare_int(cond, x, limit as i64))
    }

    fn combine_tests_of_zero(
        &mut self,
        op: Binary,
        (first, x): (Cond, Value),
        (second, y): (Cond, Value),
    ) -> Option<Step> {
        let (joint, cond) = match (op, first, second) {
            (And, Eq, Eq) | (Or, Ne, Ne) | (And, Ge, Ge) | (Or, Lt, Lt) => (Or, first),
            (And, Lt, Lt) | (Or, Ge, Ge) => (And, first),
            (Xor, Lt | Ge, Lt | Ge) => (Xor, if first == second { Lt } else { Ge }),
            _ => return None,
        };
        let both = self.make_binary(joint, x, y);
        Some(self.to_compare_int(cond, both, 0))
    }

    /// `0 <= index && index < length`, or the opposite.
    fn combine_to_bounds_check(&mut self, op: Binary, [a, b]: [Value; 2]) -> Option<Step> {
        let flip = |cond: Cond| if op == And { cond } else { cond.inverted() };
        [(a, b), (b, a)].into_iter().find_map(|(lower, upper)| {
            let (Op::Compare(lower, [index, zero]), Op::Compare(upper, [p, q])) =
                (self.op(lower), self.op(upper))
            else {
                return None;
            };
            let (upper, length) = if p == index {
                (upper, q)
            } else {
                (upper.commuted(), p)
            };
            let unsigned = match flip(upper) {
                Lt | Below => Below,
                Le | BelowEq => BelowEq,
                _ => return None,
            };
            let fits = op != Xor
                && flip(lower) == Ge
                && self.int(zero) == Some(0)
                && (p == index || q == index);
            (fits && self.is_not_negative(length))
                .then(|| self.to_compare(flip(unsigned), index, length))
        })
    }

    /// An operand that is zero if and only if `value` is.
    pub(super) fn same_truth(&mut self, value: Value) -> Option<Value> {
        let inner = match self.op(value) {
            Op::Compare(Ne, [x, zero]) if self.int(zero) == Some(0) => x,
            Op::Unary(Widen(_) | Neg | CountOnes, x)
            | Op::Binary(RotateLeft | RotateRight, [x, _]) => x,
            Op::Binary(Mul, [x, odd]) if self.int(odd)? & 1 != 0 => x,
            Op::Binary(Shl, _) => {
                let (x, amount) = self.as_shift(Shl, value)?;
                let kept = all_ones(self.type_of(x).width()) >> amount;
                (self.facts(x).possible() & !kept == 0).then_some(x)?
            }
            Op::Select([condition, then, or]) if self.int(or) == Some(0) => {
                self.facts(then).is_not_zero().then_some(condition)?
            }
            _ => return None,
        };
        self.hit();
        Some(inner)
    }
}
