//! Shared by x86-64 and AArch64.
use crate::{SharedU8, portable};
use bun_simd_trusted::shared::{load4, load8, load16, store4, store8, store16};
use core::simd::{Simd, u8x64};
use core::sync::atomic::AtomicU8;

/// Panics unless `bytes` has `K * N` bytes.
#[inline(always)]
pub(crate) fn as_group<B, const N: usize, const K: usize>(bytes: &[B]) -> &[[B; N]; K] {
    bytes.as_chunks().0.as_array().unwrap()
}

#[inline]
#[cfg_attr(target_arch = "x86_64", target_feature(enable = "sse2"))]
#[cfg_attr(target_arch = "aarch64", target_feature(enable = "neon"))]
pub(crate) fn load_shared<A, const K: usize, const AT: usize>(from: &[SharedU8]) -> u8x64 {
    match const { size_of::<A>() } {
        16 => load16::<K, AT>(as_group(from)).resize(0),
        8 => Simd::from_array(load8::<K, AT>(as_group(from)).to_ne_bytes()).resize(0),
        4 => Simd::from_array(load4::<K, AT>(as_group(from)).to_ne_bytes()).resize(0),
        _ => portable::load_shared::<A, K, AT>(from),
    }
}

#[inline]
#[cfg_attr(target_arch = "x86_64", target_feature(enable = "sse2"))]
#[cfg_attr(target_arch = "aarch64", target_feature(enable = "neon"))]
pub(crate) fn store_shared<const N: usize, const K: usize, const AT: usize>(
    v: Simd<u8, N>,
    to: &[AtomicU8],
) {
    match N {
        16 => store16::<K, AT>(v.resize(0), as_group(to)),
        8 => store8::<K, AT>(u64::from_ne_bytes(v.resize(0).to_array()), as_group(to)),
        4 => store4::<K, AT>(u32::from_ne_bytes(v.resize(0).to_array()), as_group(to)),
        _ => portable::store_shared::<N, K, AT>(v, to),
    }
}
