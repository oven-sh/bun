//! The number `bf16`.

use core::ops::{Add, Div, Mul, Neg, Rem, Sub};

/// A floating-point number of 16 bits: the upper half of an `f32`, with its range and 8 bits of precision.
///
/// Arithmetic rounds to the nearest value, and ties go to the even one. [`bitcast_slice`](crate::mem::bitcast_slice) makes a slice
/// of these from one of `u16`.
///
/// ```
/// # use bun_simd::bf16;
/// let third = bf16::from_f32(1.0 / 3.0);
/// assert_eq!((third.to_bits(), third.to_f32()), (0x3eab, 0.333984375));
/// ```
#[derive(Copy, Clone, Default)]
#[repr(transparent)]
#[allow(non_camel_case_types)]
#[doc(alias("bfloat16", "bfloat16_t", "f16b"))]
pub struct bf16(u16);

impl bf16 {
    /// The lowest value that is finite.
    pub const MIN: bf16 = bf16(0xff7f);
    /// The highest value that is finite.
    pub const MAX: bf16 = bf16(0x7f7f);
    /// The least normal value above zero.
    pub const MIN_POSITIVE: bf16 = bf16(0x0080);
    /// The difference between 1 and the next value.
    pub const EPSILON: bf16 = bf16(0x3c00);
    /// Infinity.
    pub const INFINITY: bf16 = bf16(0x7f80);
    /// Negative infinity.
    pub const NEG_INFINITY: bf16 = bf16(0xff80);
    /// Not a number.
    pub const NAN: bf16 = bf16(0x7fc0);

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
        let bits = value.to_bits();
        Self((if value.is_nan() { bits | 0x0040_0000 } else { bits + 0x7fff + (bits >> 16 & 1) } >> 16) as u16)
    }
    /// The nearest value.
    #[inline]
    pub const fn from_f64(value: f64) -> Self {
        // Rounded to odd, after which it doesn't matter that there are two steps.
        let near = value as f32;
        // The x87 rounds what it stores.
        #[cfg(all(target_arch = "x86", not(target_feature = "sse2")))]
        let near = core::hint::black_box(near);
        if near as f64 == value || value.is_nan() {
            return Self::from_f32(near);
        }
        Self::from_f32(f32::from_bits((near.to_bits() - ((near as f64).abs() > value.abs()) as u32) | 1))
    }
    #[inline]
    pub(crate) const fn from_i128(value: i128) -> Self {
        let lost = if value.unsigned_abs() >> 53 == 0 { 0 } else { 0x7ff };
        Self::from_f64(((value | ((value & lost) + lost)) & !lost) as f64)
    }
    /// The same value.
    #[inline(always)]
    pub const fn to_f32(self) -> f32 {
        f32::from_bits((self.0 as u32) << 16)
    }
    /// The same value.
    #[inline(always)]
    pub const fn to_f64(self) -> f64 {
        self.to_f32() as f64
    }
    /// Whether it is not a number.
    #[inline(always)]
    pub const fn is_nan(self) -> bool {
        self.0 & 0x7fff > 0x7f80
    }
}

impl From<bf16> for f32 {
    #[inline(always)]
    fn from(value: bf16) -> f32 {
        value.to_f32()
    }
}
impl From<bf16> for f64 {
    #[inline(always)]
    fn from(value: bf16) -> f64 {
        value.to_f64()
    }
}
impl PartialEq for bf16 {
    #[inline(always)]
    fn eq(&self, other: &Self) -> bool {
        self.to_f32() == other.to_f32()
    }
}
impl PartialOrd for bf16 {
    #[inline(always)]
    fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
        self.to_f32().partial_cmp(&other.to_f32())
    }
}
impl Neg for bf16 {
    type Output = Self;
    #[inline(always)]
    fn neg(self) -> Self {
        Self(self.0 ^ 0x8000)
    }
}
macro_rules! as_f32 { ([$($trait:ident $f:ident)*] [$($fmt:ident)*]) => {
    $(impl $trait for bf16 {
        type Output = Self;
        #[inline]
        fn $f(self, other: Self) -> Self { Self::from_f32(self.to_f32().$f(other.to_f32())) }
    })*
    $(impl core::fmt::$fmt for bf16 {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { self.to_f32().fmt(f) }
    })*
}; }
as_f32!([Add add Sub sub Mul mul Div div Rem rem] [Debug Display LowerExp UpperExp]);
