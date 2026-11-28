//! Conversions to and from the types of `core::arch`. They keep all bits, and take no instruction.

#[allow(unused_imports)]
use crate::simd::prelude::*;
#[allow(unused_imports)]
use crate::{B8, B16, B32, B64, Isa, Lane, Tag, Width};

/// A vector type of `core::arch` that is as wide as `W`.
pub(crate) trait Arch<W: Width>: Copy {
    fn to_bytes(self) -> W::U8;
    fn from_bytes(bytes: W::U8) -> Self;
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// The result of an intrinsic.
    #[inline(always)]
    pub(crate) fn from_arch(self, v: impl Arch<W>) -> crate::Simd<T, W, S> {
        crate::Simd::<u8, W, S>::new(self.simd(), v.to_bytes()).bitcast()
    }
}

impl<S: Isa, T: Lane, W: Width> crate::Simd<T, W, S> {
    /// The operand of an intrinsic. `into` does the same.
    #[inline(always)]
    pub(crate) fn to_arch<A: Arch<W>>(self) -> A {
        A::from_bytes(self.bytes())
    }
}

#[allow(unused_macros)]
macro_rules! arch {
    ($($w:ident { $($arch:ident $simd:ident)* })*) => {$($(
        impl Arch<$w> for $arch {
            #[inline(always)]
            fn to_bytes(self) -> <$w as crate::width::Repr>::U8 {
                crate::endian::ToBytes::to_le_bytes($simd::from(self))
            }
            #[inline(always)]
            fn from_bytes(bytes: <$w as crate::width::Repr>::U8) -> Self {
                <$simd as crate::endian::ToBytes>::from_le_bytes(bytes).into()
            }
        }
        #[doc(hidden)]
        impl<S: Isa, T: Lane> crate::IntoSimd<T, $w, S> for $arch {
            #[inline(always)]
            fn into_simd(self, s: S) -> crate::Simd<T, $w, S> {
                s.fixed().from_arch(self)
            }
        }
        impl<S: Isa, T: Lane> From<$arch> for crate::Simd<T, $w, S> {
            #[inline(always)]
            fn from(v: $arch) -> Self {
                S::default().fixed().from_arch(v)
            }
        }
        impl<S: Isa, T: Lane> From<crate::Simd<T, $w, S>> for $arch {
            #[inline(always)]
            fn from(v: crate::Simd<T, $w, S>) -> Self {
                v.to_arch()
            }
        }
    )*)*};
}

cfg_select! {
    all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2") => {
        #[cfg(target_arch = "x86")]
        use core::arch::x86::*;
        #[cfg(target_arch = "x86_64")]
        use core::arch::x86_64::*;
        arch! {
            B16 { __m128i u8x16 __m128 f32x4 __m128d f64x2 }
            B32 { __m256i u8x32 __m256 f32x8 __m256d f64x4 }
            B64 { __m512i u8x64 __m512 f32x16 __m512d f64x8 }
        }
    }
    all(target_arch = "aarch64", target_feature = "neon", target_endian = "little") => {
        use core::arch::aarch64::*;
        arch! {
            B8 {
                uint8x8_t u8x8 int8x8_t i8x8 poly8x8_t u8x8 uint16x4_t u16x4 int16x4_t i16x4 poly16x4_t u16x4 uint32x2_t u32x2
                int32x2_t i32x2 float32x2_t f32x2 uint64x1_t u64x1 int64x1_t i64x1 poly64x1_t u64x1 float64x1_t f64x1
            }
            B16 {
                uint8x16_t u8x16 int8x16_t i8x16 poly8x16_t u8x16 uint16x8_t u16x8 int16x8_t i16x8 poly16x8_t u16x8 uint32x4_t u32x4
                int32x4_t i32x4 float32x4_t f32x4 uint64x2_t u64x2 int64x2_t i64x2 poly64x2_t u64x2 float64x2_t f64x2
            }
        }
    }
    all(target_arch = "wasm32", target_feature = "simd128") => {
        use core::arch::wasm32::v128;
        arch! { B16 { v128 u8x16 } }
    }
    _ => {}
}
