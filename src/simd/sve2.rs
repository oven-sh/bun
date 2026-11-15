pub(crate) use crate::native::{load_shared, store_shared};
pub use crate::portable::{bit_indices, prefix_xor};
use bun_simd_trusted::{SharedU8, shared};
use core::simd::{Simd, u8x64};
use core::sync::atomic::AtomicU8;

crate::isa::vector_types!(crate::neon::Neon<true>, 16);

#[inline]
#[target_feature(enable = "sve")]
pub(crate) fn load_shared_masked(from: &[SharedU8]) -> u8x64 {
    shared::load16_masked(from).resize(0)
}

#[inline]
#[target_feature(enable = "sve")]
pub(crate) fn store_shared_masked<const N: usize>(v: Simd<u8, N>, to: &[AtomicU8]) {
    shared::store16_masked(v.resize(0), to);
}
