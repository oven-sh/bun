//! Each type of core::arch keeps its bits, on each target.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

macro_rules! types { ($name:ident $w:ident $bytes:literal: $($arch:ident)*) => { cases! {
    $name [u8 f32] $bytes..=$bytes, |d, _, _, _, io| {
        let d = d.isa().of::<T, $w>();
        let a = io.load(d, 0);
        [$(d.from(Into::<$arch>::into(a)), d.from(<$arch>::from(a))),*].map(#[inline(always)] |v| v.cast_unsigned())
    } => |m| m.a.repeat(2 * [$(stringify!($arch)),*].len());
} }; }

#[cfg(target_arch = "x86_64")]
mod x86 {
    use super::*;
    use core::arch::x86_64::*;
    types!(b16 B16 16: __m128i __m128 __m128d);
    types!(b32 B32 32: __m256i __m256 __m256d);
    types!(b64 B64 64: __m512i __m512 __m512d);
}

#[cfg(all(target_arch = "aarch64", target_endian = "little"))]
mod arm {
    use super::*;
    use core::arch::aarch64::*;
    types!(b8 B8 8: uint8x8_t int8x8_t poly8x8_t uint16x4_t int16x4_t poly16x4_t uint32x2_t int32x2_t float32x2_t uint64x1_t int64x1_t
        poly64x1_t float64x1_t);
    types!(b16 B16 16: uint8x16_t int8x16_t poly8x16_t uint16x8_t int16x8_t poly16x8_t uint32x4_t int32x4_t float32x4_t uint64x2_t
        int64x2_t poly64x2_t float64x2_t);
}
