//! Limits on the values of integers.

use bun_engine_asm::{Cond, Sign, Size, Width};

use crate::ir::{Binary, Checked, Function, Load, Op, Unary, Value};

/// The value is within both pairs of limits, which are included.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct Bounds {
    pub(super) least: i64,
    pub(super) greatest: i64,
    pub(super) least_unsigned: u64,
    pub(super) greatest_unsigned: u64,
    width: Width,
}

const fn all_ones(width: Width) -> u64 {
    u64::MAX >> (64 - width.bits())
}

const fn greatest_signed(width: Width) -> i64 {
    (all_ones(width) >> 1) as i64
}

const fn extend_sign(width: Width, bits: u64) -> i64 {
    let unused = 64 - width.bits();
    (bits << unused) as i64 >> unused
}

impl Bounds {
    pub(super) const fn any(width: Width) -> Self {
        Self {
            least: !greatest_signed(width),
            greatest: greatest_signed(width),
            least_unsigned: 0,
            greatest_unsigned: all_ones(width),
            width,
        }
    }

    /// With its sign extended.
    pub(super) fn constant(width: Width, value: i64) -> Self {
        let bits = value as u64 & all_ones(width);
        Self {
            least: value,
            greatest: value,
            least_unsigned: bits,
            greatest_unsigned: bits,
            width,
        }
    }

    pub(super) fn signed(width: Width, least: i64, greatest: i64) -> Self {
        Self {
            least,
            greatest,
            ..Self::any(width)
        }
        .tightened()
    }

    pub(super) fn unsigned(width: Width, least_unsigned: u64, greatest_unsigned: u64) -> Self {
        Self {
            least_unsigned,
            greatest_unsigned,
            ..Self::any(width)
        }
        .tightened()
    }

    /// Anything, if a limit does not fit.
    fn signed_if_fits(width: Width, least: i128, greatest: i128) -> Self {
        let any = Self::any(width);
        if least >= any.least.into() && greatest <= any.greatest.into() {
            Self::signed(width, least as i64, greatest as i64)
        } else {
            any
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.least > self.greatest || self.least_unsigned > self.greatest_unsigned
    }

    /// With its sign extended.
    pub(super) fn only_value(&self) -> Option<i64> {
        (self.least == self.greatest).then_some(self.least)
    }

    pub(super) fn contains(&self, value: i64) -> bool {
        (self.least..=self.greatest).contains(&value)
            && (self.least_unsigned..=self.greatest_unsigned)
                .contains(&(value as u64 & all_ones(self.width)))
    }

    pub(super) fn is_boolean(&self) -> bool {
        self.greatest_unsigned <= 1
    }

    /// The values that are not negative and those that are have the same order with and without sign.
    fn tightened(self) -> Self {
        let (mask, middle) = (all_ones(self.width), greatest_signed(self.width) as u64);
        let unsigned = |value: i64| value as u64 & mask;
        let positive = (
            unsigned(self.least.max(0)).max(self.least_unsigned),
            unsigned(self.greatest.max(0)).min(self.greatest_unsigned),
        );
        let negative = (
            unsigned(self.least.min(-1)).max(self.least_unsigned),
            unsigned(self.greatest.min(-1)).min(self.greatest_unsigned),
        );
        let has_positive = self.greatest >= 0 && positive.0 <= positive.1;
        let has_negative = self.least < 0 && negative.0 <= negative.1;
        debug_assert!(!has_positive || positive.1 <= middle);
        let (lowest, highest) = match (has_negative, has_positive) {
            (true, true) => (negative, positive),
            (true, false) => (negative, negative),
            (false, true) => (positive, positive),
            (false, false) => {
                return Self {
                    least: 0,
                    greatest: -1,
                    ..self
                };
            }
        };
        Self {
            least: extend_sign(self.width, lowest.0),
            greatest: extend_sign(self.width, highest.1),
            least_unsigned: highest.0,
            greatest_unsigned: lowest.1,
            width: self.width,
        }
    }

    pub(super) fn intersection(&self, other: &Self) -> Self {
        Self {
            least: self.least.max(other.least),
            greatest: self.greatest.min(other.greatest),
            least_unsigned: self.least_unsigned.max(other.least_unsigned),
            greatest_unsigned: self.greatest_unsigned.min(other.greatest_unsigned),
            width: self.width,
        }
        .tightened()
    }

    pub(super) fn hull(&self, other: &Self) -> Self {
        Self {
            least: self.least.min(other.least),
            greatest: self.greatest.max(other.greatest),
            least_unsigned: self.least_unsigned.min(other.least_unsigned),
            greatest_unsigned: self.greatest_unsigned.max(other.greatest_unsigned),
            width: self.width,
        }
    }

    /// Those of the values for which `cond` holds with some value in `other` on the right.
    pub(super) fn where_holds(&self, cond: Cond, other: &Self) -> Self {
        debug_assert!(!self.is_empty() && !other.is_empty());
        let mut result = *self;
        match cond {
            Cond::Eq => return self.intersection(other),
            Cond::Ne => {
                let Some(value) = other.only_value() else {
                    return result;
                };
                if self.only_value() == Some(value) {
                    (result.least, result.greatest) = (0, -1);
                    return result;
                }
                result.least += i64::from(self.least == value);
                result.greatest -= i64::from(self.greatest == value);
                result.least_unsigned += u64::from(self.least_unsigned == other.least_unsigned);
                result.greatest_unsigned -=
                    u64::from(self.greatest_unsigned == other.least_unsigned);
            }
            Cond::Le => result.greatest = self.greatest.min(other.greatest),
            Cond::Ge => result.least = self.least.max(other.least),
            Cond::BelowEq => {
                result.greatest_unsigned = self.greatest_unsigned.min(other.greatest_unsigned);
            }
            Cond::AboveEq => result.least_unsigned = self.least_unsigned.max(other.least_unsigned),
            // A limit that saturates belongs to a condition that never holds, from which anything follows.
            Cond::Lt => result.greatest = self.greatest.min(other.greatest.saturating_sub(1)),
            Cond::Gt => result.least = self.least.max(other.least.saturating_add(1)),
            Cond::Below => {
                let limit = other.greatest_unsigned.saturating_sub(1);
                result.greatest_unsigned = self.greatest_unsigned.min(limit);
            }
            Cond::Above => {
                let limit = other.least_unsigned.saturating_add(1);
                result.least_unsigned = self.least_unsigned.max(limit);
            }
        }
        result.tightened()
    }

    /// The exact result of the operation lies between these.
    fn exact(op: Checked, a: &Self, b: &Self) -> (i128, i128) {
        let [a0, a1, b0, b1] = [a.least, a.greatest, b.least, b.greatest].map(i128::from);
        match op {
            Checked::Add => (a0 + b0, a1 + b1),
            Checked::Sub => (a0 - b1, a1 - b0),
            Checked::Mul => {
                let corners = [a0 * b0, a0 * b1, a1 * b0, a1 * b1];
                let (least, greatest) = (corners.iter().min(), corners.iter().max());
                (*least.unwrap(), *greatest.unwrap())
            }
        }
    }

    pub(super) fn wrapping(op: Checked, a: &Self, b: &Self) -> Self {
        let (least, greatest) = Self::exact(op, a, b);
        Self::signed_if_fits(a.width, least, greatest)
    }

    pub(super) fn always_fits(op: Checked, a: &Self, b: &Self) -> bool {
        let (least, greatest) = Self::exact(op, a, b);
        let any = Self::any(a.width);
        least >= any.least.into() && greatest <= any.greatest.into()
    }

    /// Of an integer, given those of its operands.
    pub(super) fn of(
        function: &Function,
        value: Value,
        mut of_operand: impl FnMut(Value) -> Self,
    ) -> Self {
        let width = function.type_of(value).width();
        let up_to = |greatest| Self::unsigned(width, 0, greatest);
        let extended = |size: Size| {
            let half = 1 << (size.bits() - 1);
            Self::signed(width, -half, half - 1)
        };
        match *function.op(value) {
            Op::Const32(constant) => Self::constant(width, constant.into()),
            Op::Const64(constant) => Self::constant(width, constant.get() as i64),
            Op::Compare(..) | Op::FloatCompare(..) => up_to(1),
            Op::Load {
                kind: Load::Narrow(size, Sign::Unsigned),
                ..
            } => up_to((1 << size.bits()) - 1),
            Op::Load {
                kind: Load::Narrow(size, Sign::Signed),
                ..
            }
            | Op::Unary(Unary::SignExtend(size), _) => extended(size),
            Op::Unary(
                Unary::CountLeadingZeros | Unary::CountTrailingZeros | Unary::CountOnes,
                _,
            ) => up_to(width.bits().into()),
            Op::Unary(Unary::Widen(Sign::Signed), operand) => {
                let narrow = of_operand(operand);
                Self::signed(width, narrow.least, narrow.greatest)
            }
            Op::Unary(Unary::Widen(Sign::Unsigned), operand) => {
                let narrow = of_operand(operand);
                Self::unsigned(width, narrow.least_unsigned, narrow.greatest_unsigned)
            }
            Op::Unary(Unary::Wrap, operand) => {
                let wide = of_operand(operand);
                if wide.greatest_unsigned >> 32 == wide.least_unsigned >> 32 {
                    let low = |bits: u64| bits & all_ones(width);
                    Self::unsigned(width, low(wide.least_unsigned), low(wide.greatest_unsigned))
                } else {
                    Self::signed_if_fits(width, wide.least.into(), wide.greatest.into())
                }
            }
            Op::Unary(Unary::FitsIn(count), operand) => {
                let promised = up_to((1 << count) - 1);
                let both = of_operand(operand).intersection(&promised);
                if both.is_empty() { promised } else { both }
            }
            Op::Select([_, then, or]) => of_operand(then).hull(&of_operand(or)),
            Op::Checked(op, [lhs, rhs], _) => {
                let (least, greatest) = Self::exact(op, &of_operand(lhs), &of_operand(rhs));
                let any = Self::any(width);
                let clamp = |limit: i128| limit.clamp(any.least.into(), any.greatest.into()) as i64;
                Self::signed(width, clamp(least), clamp(greatest))
            }
            Op::Binary(op, [lhs, rhs]) => {
                Self::of_binary(op, width, || (of_operand(lhs), of_operand(rhs)))
            }
            _ => Self::any(width),
        }
    }

    fn of_binary(op: Binary, width: Width, operands: impl FnOnce() -> (Self, Self)) -> Self {
        let wrapping = match op {
            Binary::Add => Checked::Add,
            Binary::Sub => Checked::Sub,
            Binary::Mul => Checked::Mul,
            Binary::And
            | Binary::Or
            | Binary::Xor
            | Binary::Shl
            | Binary::Shr
            | Binary::Sar
            | Binary::UnsignedDiv
            | Binary::UnsignedRem
            | Binary::Rem
            | Binary::TotalRem => return Self::of_other_binary(op, width, operands()),
            _ => return Self::any(width),
        };
        let (a, b) = operands();
        Self::wrapping(wrapping, &a, &b)
    }

    fn of_other_binary(op: Binary, width: Width, (a, b): (Self, Self)) -> Self {
        let amount = b
            .only_value()
            .map(|amount| amount as u32 % u32::from(width.bits()));
        let bits_of_either = || {
            let greatest = a.greatest_unsigned | b.greatest_unsigned;
            u64::MAX.unbounded_shr(greatest.leading_zeros())
        };
        match (op, amount) {
            (Binary::And, _) => {
                Self::unsigned(width, 0, a.greatest_unsigned.min(b.greatest_unsigned))
            }
            (Binary::Or, _) => Self::unsigned(
                width,
                a.least_unsigned.max(b.least_unsigned),
                bits_of_either(),
            ),
            (Binary::Xor, _) => Self::unsigned(width, 0, bits_of_either()),
            (Binary::Shl, Some(amount)) => Self::signed_if_fits(
                width,
                i128::from(a.least) << amount,
                i128::from(a.greatest) << amount,
            ),
            (Binary::Shr, Some(amount)) => Self::unsigned(
                width,
                a.least_unsigned >> amount,
                a.greatest_unsigned >> amount,
            ),
            (Binary::Sar, Some(amount)) => {
                Self::signed(width, a.least >> amount, a.greatest >> amount)
            }
            (Binary::Shr | Binary::UnsignedDiv, _) => Self::unsigned(width, 0, a.greatest_unsigned),
            (Binary::Sar, None) => Self::signed(width, a.least.min(0), a.greatest.max(-1)),
            (Binary::UnsignedRem, _) => {
                let below_divisor = b.greatest_unsigned.saturating_sub(1);
                Self::unsigned(width, 0, a.greatest_unsigned.min(below_divisor))
            }
            (Binary::Rem | Binary::TotalRem, _) => {
                let magnitude = b.least.unsigned_abs().max(b.greatest.unsigned_abs());
                let limit = magnitude.saturating_sub(1) as i64;
                Self::signed(
                    width,
                    a.least.min(0).max(-limit),
                    a.greatest.max(0).min(limit),
                )
            }
            _ => Self::any(width),
        }
    }

    /// From the instruction and those that give its operands.
    pub(super) fn evident(function: &Function, value: Value) -> Self {
        Self::of(function, value, |operand| {
            Self::of(function, operand, |leaf| {
                let width = function.type_of(leaf).width();
                match function.int_constant(leaf) {
                    Some(known) => Self::constant(width, known),
                    None => Self::any(width),
                }
            })
        })
    }
}
