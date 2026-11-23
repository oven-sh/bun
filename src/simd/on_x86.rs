//! Steps that only x86 takes. They change no value, but the code that LLVM makes.

use crate::raw::Raw;
#[cfg(target_feature = "avx512f")]
use crate::simd::u8x64;
use crate::{Isa, Lane, Simd, Width, pattern as p};
use core::hint::select_unpredictable;

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// By the token or the flags.
    const LONG_REGISTERS: bool = S::AVX512F || cfg!(target_feature = "avx512f");
    const PERMUTES: bool = Self::LONG_REGISTERS && W::BYTES == 64;
    /// `black_box`, in registers of 64 bytes if it is in such.
    #[inline(always)]
    fn covered(self) -> Self {
        #[cfg(target_feature = "avx512f")]
        return_if!(W::BYTES >= 64 && S::REGISTER < 64 && S::LEVEL >= crate::simd::AVX512, |v: Self = self| {
            let one = always!(|[it]: [u8x64; 1]| u8x64::of(crate::simd::accessed::<S, _>(it.0)));
            v.with_bytes(choose! { W::BYTES > 64 => W::by_64([v.bytes()], one), _ => W::from64(one([W::to64(v.bytes())])) })
        });
        self.black_box()
    }
    /// The same, but for a constant.
    #[inline(always)]
    pub(crate) fn veiled(self) -> Self {
        select_unpredictable(are_known!(self.raw), self, self.covered())
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn assembled(self) -> Self {
        choose! { Self::PERMUTES => self.veiled(), _ => self }
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn picked(self) -> Self {
        choose! { Self::LONG_REGISTERS && S::REGISTER < 64 && W::BYTES > 64 => self.covered(), _ => self.assembled() }
    }
    #[inline(always)]
    pub(crate) fn shuffled<const OP: u8, const K: usize>(self) -> Self {
        choose! {
            Self::LONG_REGISTERS && W::BYTES > 64 => self.covered(),
            Self::PERMUTES && (p::moves_words(OP, K, size_of::<T>()) || p::reorders(OP, K, size_of::<T>()) || p::spreads(OP, K, size_of::<T>()) && !matches!(OP, p::STRIDE | p::SHUFFLE4)) => self.veiled(),
            Self::REPEATS && matches!(OP, p::BROADCAST | p::BROADCAST_LANE | p::BROADCAST_LAST) => self.veiled(),
            _ => self,
        }
    }
    #[inline(always)]
    pub(crate) fn looked_up(self, indices: Simd<T::Unsigned, W, S>) -> Self {
        choose! {
            Self::PERMUTES && (size_of::<T>() == 8 || !crate::OPTIMIZED) => self.covered(),
            Self::PERMUTES => self.to_look_up(indices),
            Simd::<f32, W, S>::REPEATS && T::BITS == 32 && !crate::OPTIMIZED => self.covered(),
            _ => self,
        }
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn to_shuffle<const OP: u8, const K: usize>(self) -> Self {
        choose! {
            Self::LONG_REGISTERS && W::BYTES > 64 && matches!(OP, p::BROADCAST_LANE | p::BROADCAST_LAST) => self.covered(),
            Self::PERMUTES && (p::spreads(OP, K, size_of::<T>()) || matches!(OP, p::BROADCAST_LANE | p::BROADCAST_BLOCK) && K > 0) => self.veiled(),
            Self::LONG_REGISTERS && W::BYTES == 32 && size_of::<T>() == 1 && matches!(OP, p::BROADCAST_LANE | p::BROADCAST_LAST) => self.veiled(),
            _ => self,
        }
    }
    #[inline(always)]
    pub(crate) fn to_look_up(self, indices: Simd<T::Unsigned, W, S>) -> Self {
        choose! {
            Self::PERMUTES && size_of::<T>() < 8 && !crate::OPTIMIZED => self.covered(),
            Self::PERMUTES && size_of::<T>() < 8 => select_unpredictable(indices.cross(), self.veiled(), self),
            _ => self,
        }
    }
    /// For `to_look_up`.
    #[inline(always)]
    fn cross(self) -> bool {
        let (all, block) =
            (self.reinterpret::<u64>().raw.to_array(), !0 / (!0u64 >> (64 - T::BITS)) * (128 / T::BITS as u64));
        let (mut other, mut low) = (0, all);
        unrolled!(8, for i in 0..const 8 {
            other |= (all.as_ref()[i] ^ (i as u64 / 2 * block)) & (3 * block);
            low.as_mut()[i] &= !0 / (!0u64 >> (64 - T::BITS)) * (512 / T::BITS as u64 - 1);
        });
        are_known!(self.reinterpret::<u64>().with(Raw::from_array(low)).raw) & (other != 0)
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn blended(self) -> Self {
        choose! { S::AVX2 => self.black_box(), _ => self }
    }
    const REPEATS: bool = T::IS_FLOAT
        && (T::BITS >= 32 && (W::BYTES <= 16 || S::REGISTER == 16) || !crate::OPTIMIZED)
        && (S::AVX2 || S::LISTED.has("avx") || cfg!(target_feature = "avx"));
    /// The same value.
    #[inline(always)]
    pub(crate) fn repeated(self, value: T) -> Self {
        return_if!(Self::REPEATS, if is_known!(value) { self } else { self.black_box() });
        self
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn made(self) -> Self {
        choose! { Self::REPEATS => self.veiled(), _ => self }
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn swizzled(self) -> Self {
        choose! { Simd::<f32, W, S>::REPEATS && T::BITS == 32 && crate::OPTIMIZED => self.veiled(), _ => self }
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn part_of<X: Width>(self) -> Self {
        choose! { Self::REPEATS && !Simd::<T, X, S>::REPEATS => self.veiled(), _ => self }
    }
    /// The same value.
    #[inline(always)]
    pub(crate) fn in_parts(self) -> Self {
        choose! { W::BYTES == 16 && T::BITS >= 32 => self.veiled(), _ => self }
    }
}
