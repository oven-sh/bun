//! What is known of an integer wherever it is defined.

use bun_engine_asm::{Cond, Sign, Size, Width};

use crate::ir::{Binary, Unary};

/// Limits, which are included, and bits. The upper half of an integer of 32 bits counts as zero.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct Facts {
    pub(super) min: i64,
    pub(super) max: i64,
    pub(super) zeros: u64,
    pub(super) ones: u64,
}

pub(super) const fn all_ones(width: Width) -> u64 {
    u64::MAX >> (64 - width.bits())
}

pub(super) const fn sign_bit(width: Width) -> u64 {
    1 << (width.bits() - 1)
}

pub(super) const fn greatest(width: Width) -> i64 {
    (all_ones(width) >> 1) as i64
}

pub(super) const fn least(width: Width) -> i64 {
    !greatest(width)
}

pub(super) const fn extend_sign(width: Width, bits: u64) -> i64 {
    let unused = 64 - width.bits();
    (bits << unused) as i64 >> unused
}

/// `count` is at most 64.
pub(super) const fn low_bits(count: u32) -> u64 {
    if count == 0 {
        0
    } else {
        u64::MAX >> (64 - count)
    }
}

/// The highest bit that is set and all below it.
pub(super) const fn up_to_highest(bits: u64) -> u64 {
    low_bits(64 - bits.leading_zeros())
}

impl Facts {
    pub(super) const BOOLEAN: Self = Self {
        min: 0,
        max: 1,
        zeros: !1,
        ones: 0,
    };

    pub(super) const fn none(width: Width) -> Self {
        Self {
            min: least(width),
            max: greatest(width),
            zeros: !all_ones(width),
            ones: 0,
        }
    }

    pub(super) const fn constant(width: Width, value: i64) -> Self {
        let bits = value as u64 & all_ones(width);
        Self {
            min: value,
            max: value,
            zeros: !bits,
            ones: bits,
        }
    }

    fn of_bits(width: Width, zeros: u64, ones: u64) -> Self {
        Self::none(width).with_bits(width, zeros, ones)
    }

    pub(super) fn of_range(width: Width, min: i64, max: i64) -> Self {
        Self {
            min,
            max,
            ..Self::none(width)
        }
        .reconciled(width)
    }

    /// Nothing, if a limit does not fit.
    fn of_wide_range(width: Width, min: i128, max: i128) -> Self {
        if min >= least(width).into() && max <= greatest(width).into() {
            Self {
                min: min as i64,
                max: max as i64,
                ..Self::none(width)
            }
        } else {
            Self::none(width)
        }
    }

    pub(super) fn of_unsigned_range(width: Width, min: u64, max: u64) -> Self {
        if (min ^ max) & sign_bit(width) == 0 {
            Self::of_range(width, extend_sign(width, min), extend_sign(width, max))
        } else {
            Self::none(width)
        }
    }

    pub(super) fn of_size(width: Width, size: Size, sign: Sign) -> Self {
        let max = low_bits(size.bits().into());
        match sign {
            Sign::Unsigned => Self::of_unsigned_range(width, 0, max),
            Sign::Signed => Self::of_range(width, !(max >> 1) as i64, (max >> 1) as i64),
        }
    }

    fn with_bits(self, width: Width, zeros: u64, ones: u64) -> Self {
        let (zeros, ones) = (zeros | !all_ones(width), ones & all_ones(width));
        Self {
            zeros,
            ones,
            ..self
        }
        .reconciled(width)
    }

    /// Lets the bits tighten the limits and the limits tell bits.
    fn reconciled(mut self, width: Width) -> Self {
        let (sign, mask) = (sign_bit(width), all_ones(width));
        self.min = self
            .min
            .max(extend_sign(width, self.ones | sign & !self.zeros));
        self.max = self
            .max
            .min(extend_sign(width, !self.zeros & !(sign & !self.ones)));
        let (low, high) = (self.min as u64 & mask, self.max as u64 & mask);
        let common = !up_to_highest(low ^ high);
        self.zeros |= !low & common;
        self.ones |= low & common;
        // Only code that never runs contradicts itself.
        if self.min > self.max || self.zeros & self.ones != 0 {
            Self::none(width)
        } else {
            self
        }
    }

    /// With its sign extended.
    #[inline]
    pub(super) fn only_value(self) -> Option<i64> {
        (self.min == self.max).then_some(self.min)
    }

    /// The bits that may be set.
    #[inline]
    pub(super) fn possible(self) -> u64 {
        !self.zeros
    }

    #[inline]
    pub(super) fn is_boolean(self) -> bool {
        self.possible() <= 1
    }

    #[inline]
    pub(super) fn is_within(self, min: i64, max: i64) -> bool {
        min <= self.min && self.max <= max
    }

    pub(super) fn is_not_zero(self) -> bool {
        self.ones != 0 || self.min > 0 || self.max < 0
    }

    pub(super) fn excludes(self, width: Width, value: i64) -> bool {
        let bits = value as u64 & all_ones(width);
        value < self.min || value > self.max || bits & self.zeros != 0 || !bits & self.ones != 0
    }

    pub(super) fn unsigned_range(self, width: Width) -> (u64, u64) {
        if self.min >= 0 || self.max < 0 {
            (
                self.min as u64 & all_ones(width),
                self.max as u64 & all_ones(width),
            )
        } else {
            (self.ones, self.possible())
        }
    }

    /// The greatest absolute value.
    fn magnitude(self) -> u64 {
        self.min.unsigned_abs().max(self.max.unsigned_abs())
    }

    pub(super) fn or(self, other: Self) -> Self {
        Self {
            min: self.min.min(other.min),
            max: self.max.max(other.max),
            zeros: self.zeros & other.zeros,
            ones: self.ones & other.ones,
        }
    }

    /// Of a value for which the comparison with `other` holds.
    pub(super) fn given(mut self, width: Width, cond: Cond, other: Self) -> Self {
        match cond {
            Cond::Lt => self.max = self.max.min(other.max.saturating_sub(1)),
            Cond::Le => self.max = self.max.min(other.max),
            Cond::Gt => self.min = self.min.max(other.min.saturating_add(1)),
            Cond::Ge => self.min = self.min.max(other.min),
            Cond::Below | Cond::BelowEq if other.min >= 0 => {
                self.min = self.min.max(0);
                self.max = self.max.min(other.max - i64::from(cond == Cond::Below));
            }
            _ => return self,
        }
        self.reconciled(width)
    }

    /// The limits of a sum, difference or product that has all the bits it needs.
    pub(super) fn exact_range(op: Binary, a: Self, b: Self) -> (i128, i128) {
        let [a_min, a_max, b_min, b_max] = [a.min, a.max, b.min, b.max].map(i128::from);
        match op {
            Binary::Add => (a_min + b_min, a_max + b_max),
            Binary::Sub => (a_min - b_max, a_max - b_min),
            _ => {
                debug_assert!(op == Binary::Mul);
                let (p, q, r, s) = (a_min * b_min, a_min * b_max, a_max * b_min, a_max * b_max);
                (p.min(q).min(r.min(s)), p.max(q).max(r.max(s)))
            }
        }
    }

    pub(super) fn cannot_overflow(op: Binary, width: Width, a: Self, b: Self) -> bool {
        let (min, max) = Self::exact_range(op, a, b);
        min >= least(width).into() && max <= greatest(width).into()
    }

    fn bits_of_arithmetic(op: Binary, a: Self, b: Self) -> (u64, u64) {
        if op == Binary::Mul {
            let known_low = |facts: Self| (facts.zeros | facts.ones).trailing_ones();
            let exact = low_bits(known_low(a).min(known_low(b)));
            let product = a.ones.wrapping_mul(b.ones);
            let cleared = (a.zeros.trailing_ones() + b.zeros.trailing_ones()).min(64);
            return (!product & exact | low_bits(cleared), product & exact);
        }
        let (b_zeros, b_ones, carry) = if op == Binary::Add {
            (b.zeros, b.ones, 0)
        } else {
            (b.ones, b.zeros, 1)
        };
        let most = (!a.zeros).wrapping_add(!b_zeros).wrapping_add(carry);
        let fewest = a.ones.wrapping_add(b_ones).wrapping_add(carry);
        let known_carries = !(most ^ a.zeros ^ b_zeros) | fewest ^ a.ones ^ b_ones;
        let known = (a.zeros | a.ones) & (b_zeros | b_ones) & known_carries;
        (!most & known, fewest & known)
    }

    /// Of a sum, difference or product that is known to fit.
    pub(super) fn of_checked(op: Binary, width: Width, a: Self, b: Self) -> Self {
        let (min, max) = Self::exact_range(op, a, b);
        let fit = |limit: i128| limit.clamp(least(width).into(), greatest(width).into());
        let (zeros, ones) = Self::bits_of_arithmetic(op, a, b);
        Self::of_wide_range(width, fit(min), fit(max)).with_bits(width, zeros, ones)
    }

    fn of_shift(op: Binary, width: Width, a: Self, amount: Self) -> Self {
        let counted = u64::from(width.bits()) - 1;
        let (fewest, most) = if amount.is_within(0, counted as i64) {
            (amount.min as u32, amount.max as u32)
        } else {
            (
                (amount.ones & counted) as u32,
                (amount.possible() & counted) as u32,
            )
        };
        let is_exact = fewest == most;
        let if_exact = |bits: u64| if is_exact { bits } else { 0 };
        match op {
            Binary::Shl => {
                let (min, max) = (i128::from(a.min), i128::from(a.max));
                let range = Self::of_wide_range(
                    width,
                    (min << fewest).min(min << most),
                    (max << fewest).max(max << most),
                );
                let cleared = low_bits((a.zeros.trailing_ones() + fewest).min(64));
                range.with_bits(
                    width,
                    if_exact(a.zeros << most) | cleared,
                    if_exact(a.ones << most),
                )
            }
            Binary::Shr => {
                let (min, max) = a.unsigned_range(width);
                let range = Self::of_unsigned_range(width, min >> most, max >> fewest);
                let zeros = if_exact(!(a.possible() >> most));
                range.with_bits(
                    width,
                    range.zeros | zeros,
                    range.ones | if_exact(a.ones >> most),
                )
            }
            Binary::Sar => {
                let shift = |bits: u64| if_exact((extend_sign(width, bits) >> most) as u64);
                let min = (a.min >> fewest).min(a.min >> most);
                let max = (a.max >> fewest).max(a.max >> most);
                Self { min, max, ..a }.with_bits(width, shift(a.zeros), shift(a.ones))
            }
            _ if is_exact => {
                let bits = u32::from(width.bits());
                let right = if op == Binary::RotateRight {
                    most
                } else {
                    (bits - most) % bits
                };
                let rotate = |x: u64| (x & all_ones(width)) >> right | x << ((bits - right) % bits);
                Self::of_bits(width, rotate(a.zeros), rotate(a.ones))
            }
            _ => Self::none(width),
        }
    }

    fn of_division(op: Binary, width: Width, a: Self, b: Self) -> Self {
        let ((a_min, a_max), (b_min, b_max)) = (a.unsigned_range(width), b.unsigned_range(width));
        match op {
            Binary::UnsignedDiv => {
                Self::of_unsigned_range(width, a_min / b_max.max(1), a_max / b_min.max(1))
            }
            Binary::UnsignedRem => {
                Self::of_unsigned_range(width, 0, a_max.min(b_max.saturating_sub(1)))
            }
            Binary::Div | Binary::TotalDiv if b.min > 0 => Self::of_range(
                width,
                (a.min / b.min).min(a.min / b.max),
                (a.max / b.min).max(a.max / b.max),
            ),
            Binary::Div | Binary::TotalDiv => {
                let limit = i128::from(a.magnitude());
                Self::of_wide_range(width, -limit, limit).reconciled(width)
            }
            _ => {
                let limit = b.magnitude().saturating_sub(1) as i64;
                Self::of_range(width, a.min.clamp(-limit, 0), a.max.clamp(0, limit))
            }
        }
    }

    pub(super) fn of_binary(op: Binary, width: Width, a: Self, b: Self) -> Self {
        match op {
            Binary::Add | Binary::Sub | Binary::Mul => {
                let (min, max) = Self::exact_range(op, a, b);
                let (zeros, ones) = Self::bits_of_arithmetic(op, a, b);
                Self::of_wide_range(width, min, max).with_bits(width, zeros, ones)
            }
            Binary::And => {
                let limit = |facts: Self| {
                    if facts.min >= 0 {
                        facts.max
                    } else {
                        greatest(width)
                    }
                };
                let range = Self {
                    max: limit(a).min(limit(b)),
                    ..Self::none(width)
                };
                range.with_bits(width, a.zeros | b.zeros, a.ones & b.ones)
            }
            Binary::Or => {
                let min = if a.min >= 0 && b.min >= 0 {
                    a.min.max(b.min)
                } else {
                    least(width)
                };
                let range = Self {
                    min,
                    ..Self::none(width)
                };
                range.with_bits(width, a.zeros & b.zeros, a.ones | b.ones)
            }
            Binary::Xor => Self::of_bits(
                width,
                a.zeros & b.zeros | a.ones & b.ones,
                a.zeros & b.ones | a.ones & b.zeros,
            ),
            Binary::MulHigh(Sign::Signed) => {
                let (min, max) = Self::exact_range(Binary::Mul, a, b);
                Self::of_range(
                    width,
                    (min >> width.bits()) as i64,
                    (max >> width.bits()) as i64,
                )
            }
            Binary::MulHigh(Sign::Unsigned) => {
                let high =
                    |a: u64, b: u64| ((u128::from(a) * u128::from(b)) >> width.bits()) as u64;
                let (a, b) = (a.unsigned_range(width), b.unsigned_range(width));
                Self::of_unsigned_range(width, high(a.0, b.0), high(a.1, b.1))
            }
            _ if op.is_shift() => Self::of_shift(op, width, a, b),
            _ => Self::of_division(op, width, a, b),
        }
    }

    /// From an integer of the width `from`.
    pub(super) fn of_unary(op: Unary, from: Width, a: Self) -> Self {
        let bits = u32::from(from.bits());
        let of_counts = |min: u32, max: u32| Self::of_range(from, min.into(), max.into());
        match op {
            Unary::Neg => Self::of_binary(Binary::Sub, from, Self::constant(from, 0), a),
            Unary::CountLeadingZeros => {
                let (min, max) = a.unsigned_range(from);
                of_counts(
                    max.leading_zeros() - (64 - bits),
                    min.leading_zeros() - (64 - bits),
                )
            }
            Unary::CountTrailingZeros => {
                let most = bits - u32::from(a.is_not_zero());
                of_counts(
                    a.zeros.trailing_ones().min(bits),
                    a.ones.trailing_zeros().min(most),
                )
            }
            Unary::CountOnes => of_counts(a.ones.count_ones(), a.possible().count_ones()),
            Unary::SwapBytes(size) => {
                let swap = |bits: u64| bits.swap_bytes() >> (64 - size.bits());
                Self::of_bits(from, !swap(a.possible()), swap(a.ones))
            }
            Unary::SignExtend(size) => {
                let unused = 64 - size.bits();
                let extend = |bits: u64| ((bits << unused) as i64 >> unused) as u64;
                let range = Self::of_size(from, size, Sign::Signed);
                let range = if a.is_within(range.min, range.max) {
                    a
                } else {
                    range
                };
                range.with_bits(from, extend(a.zeros), extend(a.ones))
            }
            Unary::Widen(Sign::Signed) => {
                a.with_bits(Width::W64, a.zeros as i32 as u64, a.ones as i32 as u64)
            }
            Unary::Widen(Sign::Unsigned) => {
                let (min, max) = a.unsigned_range(from);
                Self {
                    min: min as i64,
                    max: max as i64,
                    ..a
                }
            }
            Unary::Wrap => {
                let (min, max) = (a.min as i32, a.max as i32);
                let is_one_run = a.max.abs_diff(a.min) <= u32::MAX.into() && min <= max;
                let range = if is_one_run {
                    Self {
                        min: min.into(),
                        max: max.into(),
                        ..a
                    }
                } else {
                    Self::none(Width::W32)
                };
                range.with_bits(Width::W32, a.zeros, a.ones)
            }
            Unary::FitsIn(count) => a.with_bits(from, a.zeros | !low_bits(count.into()), a.ones),
            _ => unreachable!("not from integers to integers"),
        }
    }

    /// Whether the comparison holds, if that is certain.
    pub(super) fn decide(cond: Cond, width: Width, a: Self, b: Self) -> Option<bool> {
        fn is_less<T: Ord + Copy>(a: (T, T), b: (T, T)) -> Option<bool> {
            if a.1 < b.0 {
                Some(true)
            } else {
                (a.0 >= b.1).then_some(false)
            }
        }
        match cond {
            Cond::Eq if a.max < b.min || b.max < a.min => Some(false),
            Cond::Eq if a.ones & b.zeros | a.zeros & b.ones != 0 => Some(false),
            Cond::Eq => (a.min == a.max && b.min == b.max).then_some(true),
            Cond::Lt => is_less((a.min, a.max), (b.min, b.max)),
            Cond::Gt => is_less((b.min, b.max), (a.min, a.max)),
            Cond::Below => is_less(a.unsigned_range(width), b.unsigned_range(width)),
            Cond::Above => is_less(b.unsigned_range(width), a.unsigned_range(width)),
            _ => Self::decide(cond.inverted(), width, a, b).map(|holds| !holds),
        }
    }
}
