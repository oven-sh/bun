//! The constants that fit in an instruction, as they are encoded.

use super::assembler::sf;
use super::opcode::AddSub;
use crate::operand::{FloatWidth, Width};

/// For `add`, `sub` and the comparisons: 12 bits, which may be shifted left by 12.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ArithmeticImm(pub(super) u32);

impl ArithmeticImm {
    pub const ZERO: Self = Self(0);
    pub const ONE: Self = Self(1 << 10);

    #[inline]
    pub const fn new(value: u64) -> Option<Self> {
        if value < 1 << 12 {
            Some(Self((value as u32) << 10))
        } else if value & !0xff_f000 == 0 {
            Some(Self(1 << 22 | (value as u32) >> 2))
        } else {
            None
        }
    }
}

#[inline(always)]
pub(super) fn signed(width: Width, value: i64) -> i64 {
    match width {
        Width::W32 => (value as i32).into(),
        Width::W64 => value,
    }
}

impl AddSub {
    /// This with `value`, or the opposite with its negative. Of 32 bits, the low half of `value` counts.
    #[inline(always)]
    pub fn with_constant(self, width: Width, value: i64) -> Option<(Self, ArithmeticImm)> {
        let value = signed(width, value);
        let op = if value < 0 { self.opposite() } else { self };
        Some((op, ArithmeticImm::new(value.unsigned_abs())?))
    }
}

/// For the logical instructions: a run of ones that is rotated within 2 to 64 bits and repeated. It knows its width.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct BitmaskImm(pub(super) u32);

impl BitmaskImm {
    /// Of 32 bits, the low half of `value` counts.
    #[inline]
    pub const fn new(width: Width, value: u64) -> Option<Self> {
        let value = match width {
            Width::W32 => value << 32 | value & 0xffff_ffff,
            Width::W64 => value,
        };
        if value == 0 || value == u64::MAX {
            return None;
        }
        let first_one_after_a_zero = (value & (value + 1)).trailing_zeros();
        let unrotated = value.rotate_right(first_one_after_a_zero);
        let ones = unrotated.trailing_ones();
        let period = ones + unrotated.leading_zeros();
        if value.rotate_right(period) != value {
            return None;
        }
        let rotation = first_one_after_a_zero.wrapping_neg() & (period - 1);
        let period_and_ones = (2 * period).wrapping_neg() & 63 | (ones - 1);
        Some(Self(
            sf(width) | (period >> 6) << 22 | rotation << 16 | period_and_ones << 10,
        ))
    }
}

/// For `fmov`: ±(16 to 31)/16 times 2 to the −3 to 4. It knows its width.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct FloatImm(pub(super) u32);

impl FloatImm {
    /// A float of 32 bits is in the low half of `bits`.
    #[inline]
    pub const fn new(width: FloatWidth, bits: u64) -> Option<Self> {
        let (sign, below_sign, last_bit, least) = match width {
            FloatWidth::F32 => (bits >> 31 & 1, bits & 0x7fff_ffff, 19, 0x3e00_0000),
            FloatWidth::F64 => (bits >> 63, bits & i64::MAX as u64, 48, 0x3fc0 << 48),
        };
        let above_least = below_sign.wrapping_sub(least);
        if above_least & !(0x7f << last_bit) != 0 {
            return None;
        }
        let imm8 = (sign << 7 | above_least >> last_bit ^ 0x40) as u32;
        Some(Self((width as u32) << 22 | imm8 << 13))
    }
}
