//! Loads after which a vector stays in its register, even if the build checks preconditions.
use core::mem::transmute_neo;
use core::simd::{Mask, Simd, SimdElement, cmp::SimdPartialOrd, num::SimdUint};

#[inline(always)]
pub const fn from_array<T: SimdElement, const N: usize>(lanes: [T; N]) -> Simd<T, N> {
    // SAFETY: a vector is its lanes in order. `transmute_neo` asserts that the sizes are equal.
    unsafe { transmute_neo(lanes) }
}

#[inline(always)]
pub(crate) fn lanes_before<T: SimdElement, const N: usize>(len: usize) -> Mask<T::Mask, N> {
    const { assert!(N < 256) };
    let (index, len) = (from_array(core::array::from_fn(|i| i as u8)), len.min(N));
    // SVE would have to widen a mask of bytes.
    match size_of::<T>() {
        1 => index.simd_lt(Simd::splat(len as u8)).cast(),
        2 => index.cast().simd_lt(Simd::splat(len as u16)).cast(),
        4 => index.cast().simd_lt(Simd::splat(len as u32)).cast(),
        _ => index.cast().simd_lt(Simd::splat(len as u64)).cast(),
    }
}

#[inline(always)]
pub fn load_or_default<T: SimdElement + Default, const N: usize>(from: &[T]) -> Simd<T, N> {
    let (enable, or) = (lanes_before::<T, N>(from.len()), Simd::splat(T::default()));
    // SAFETY: `from` has all the lanes that are enabled.
    unsafe { Simd::load_select_ptr(from.as_ptr(), enable, or) }
}
