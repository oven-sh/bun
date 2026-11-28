//! The types of NEON, also where arrays take their place.
use super::{bits::pod, *};
use core::arch::aarch64::*;

pod!(uint8x8_t int8x8_t uint16x4_t int16x4_t uint32x2_t int32x2_t uint64x1_t int64x1_t float32x2_t float64x1_t float16x4_t float16x8_t
    uint8x16_t int8x16_t uint16x8_t int16x8_t uint32x4_t int32x4_t uint64x2_t int64x2_t float32x4_t float64x2_t
    poly8x8_t poly8x16_t poly16x4_t poly16x8_t poly64x1_t poly64x2_t uint8x16x2_t uint8x16x3_t uint8x16x4_t);

macro_rules! from { ($($v:ident $($t:ident)+;)*) => {$($(
    impl From<$v> for $t { #[inline(always)] fn from(v: $v) -> $t { cast(v) } }
    impl From<$t> for $v { #[inline(always)] fn from(v: $t) -> $v { Simd::of(cast(v)) } }
)+)*}; }
from! {
    u8x8 uint8x8_t poly8x8_t; i8x8 int8x8_t; u16x4 uint16x4_t poly16x4_t; i16x4 int16x4_t; u32x2 uint32x2_t; i32x2 int32x2_t; u64x1 uint64x1_t poly64x1_t; i64x1 int64x1_t;
    f32x2 float32x2_t; f64x1 float64x1_t;
    u8x16 uint8x16_t poly8x16_t; i8x16 int8x16_t; u16x8 uint16x8_t poly16x8_t; i16x8 int16x8_t; u32x4 uint32x4_t; i32x4 int32x4_t; u64x2 uint64x2_t poly64x2_t; i64x2 int64x2_t;
    f32x4 float32x4_t; f64x2 float64x2_t; u8x32 uint8x16x2_t; u8x64 uint8x16x4_t;
}
