//! The number `f16`.

use core::ops::{Add, Div, Mul, Neg, Rem, Sub};

/// A floating-point number of 16 bits: binary16 of IEEE 754, with 11 bits of precision.
///
/// Arithmetic rounds to the nearest value, and ties go to the even one. [`bitcast_slice`](crate::mem::bitcast_slice) makes a slice
/// of these from one of `u16`.
///
/// ```
/// # use bun_simd::f16;
/// let third = f16::from_f32(1.0 / 3.0);
/// assert_eq!((third.to_bits(), third.to_f32()), (0x3555, 0.33325195));
/// ```
#[derive(Copy, Clone, Default)]
#[repr(transparent)]
#[allow(non_camel_case_types)]
#[doc(alias("half", "float16", "float16_t", "binary16"))]
pub struct f16(u16);

impl f16 {
    /// The lowest value that is finite.
    pub const MIN: f16 = f16(0xfbff);
    /// The highest value that is finite.
    pub const MAX: f16 = f16(0x7bff);
    /// The least normal value above zero.
    pub const MIN_POSITIVE: f16 = f16(0x0400);
    /// The difference between 1 and the next value.
    pub const EPSILON: f16 = f16(0x1400);
    /// Infinity.
    pub const INFINITY: f16 = f16(0x7c00);
    /// Negative infinity.
    pub const NEG_INFINITY: f16 = f16(0xfc00);
    /// Not a number.
    pub const NAN: f16 = f16(0x7e00);

    /// The number with these bits.
    #[inline(always)]
    pub const fn from_bits(bits: u16) -> Self {
        Self(bits)
    }
    /// The bits of the number.
    #[inline(always)]
    pub const fn to_bits(self) -> u16 {
        self.0
    }
    /// The nearest value.
    #[inline]
    pub const fn from_f32(value: f32) -> Self {
        Self::from_f64(value as f64)
    }
    /// The nearest value.
    #[inline]
    pub const fn from_f64(value: f64) -> Self {
        let (sign, rest) = ((value.to_bits() >> 48) as u16 & 0x8000, value.to_bits() & !0 >> 1);
        let (power, digits) = ((rest >> 52) as i64 - 1023, rest & !0 >> 12 | 1 << 52);
        Self(
            sign | if rest > 0x7ff << 52 {
                0x7e00 | (rest >> 42) as u16 & 0x3ff
            } else if power > 15 {
                0x7c00
            } else if power < -25 {
                0
            } else {
                // The first digit adds one to the exponent, and so does a carry.
                let (exponent, dropped) = if power < -14 { (0, 28 - power) } else { ((power + 14) as u64, 42) };
                ((exponent << 10) + ((digits + (1 << (dropped - 1)) - 1 + (digits >> dropped & 1)) >> dropped)) as u16
            },
        )
    }
    /// The same value.
    #[inline]
    pub const fn to_f32(self) -> f32 {
        let (sign, rest) = ((self.0 as u32 & 0x8000) << 16, self.0 as u32 & 0x7fff);
        f32::from_bits(
            sign | if rest > 0x7c00 {
                0x7fc0_0000 | rest << 13
            } else if rest == 0x7c00 {
                0x7f80_0000
            } else if rest >= 0x400 {
                (rest << 13) + (112 << 23)
            } else {
                (rest as f32 * f32::from_bits(103 << 23)).to_bits()
            },
        )
    }
    /// The same value.
    #[inline(always)]
    pub const fn to_f64(self) -> f64 {
        self.to_f32() as f64
    }
    /// Whether it is not a number.
    #[inline(always)]
    pub const fn is_nan(self) -> bool {
        self.0 & 0x7fff > 0x7c00
    }
}

impl From<f16> for f32 {
    #[inline(always)]
    fn from(value: f16) -> f32 {
        value.to_f32()
    }
}
impl From<f16> for f64 {
    #[inline(always)]
    fn from(value: f16) -> f64 {
        value.to_f64()
    }
}
impl PartialEq for f16 {
    #[inline(always)]
    fn eq(&self, other: &Self) -> bool {
        self.to_f32() == other.to_f32()
    }
}
impl PartialOrd for f16 {
    #[inline(always)]
    fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
        self.to_f32().partial_cmp(&other.to_f32())
    }
}
impl Neg for f16 {
    type Output = Self;
    #[inline(always)]
    fn neg(self) -> Self {
        Self(self.0 ^ 0x8000)
    }
}
macro_rules! as_f32 { ([$($trait:ident $f:ident)*] [$($fmt:ident)*]) => {
    $(impl $trait for f16 {
        type Output = Self;
        #[inline]
        fn $f(self, other: Self) -> Self { Self::from_f32(self.to_f32().$f(other.to_f32())) }
    })*
    $(impl core::fmt::$fmt for f16 {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { self.to_f32().fmt(f) }
    })*
}; }
as_f32!([Add add Sub sub Mul mul Div div Rem rem] [Debug Display LowerExp UpperExp]);
