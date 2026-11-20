pub(crate) use crate::native::{load_shared, opaque_lanes, store_shared};
use crate::portable;
pub(crate) use crate::portable::masked::*;
pub use crate::portable::{bit_indices, prefix_xor};
use bun_simd_trusted::{SharedOutU8, SharedU8, shared};
use core::simd::u8x64;

crate::isa::vector_types!(crate::neon::Neon<true>, 16);
crate::native::x256_in_halves!("neon");

#[inline]
#[target_feature(enable = "sve")]
pub(crate) fn load_shared_masked<const TO_LAST: bool>(from: &[SharedU8]) -> u8x64 {
    match TO_LAST {
        true => portable::load_shared_masked::<true>(from),
        false => shared::load16_masked(from).resize(0),
    }
}

#[inline]
#[target_feature(enable = "sve")]
pub(crate) fn store_shared_masked<const FROM_LAST: bool>(v: u8x64, to: &[SharedOutU8]) {
    match FROM_LAST {
        true => portable::store_shared_masked::<true>(v, to),
        false => shared::store16_masked(v.resize(0), to),
    }
}
