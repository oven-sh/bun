//! `color_cache_utils.c`: the last color seen for each value of a hash.

use crate::Result;
use crate::util::{Checked, SliceExt, try_vec};
use crate::vp8l::common::MAX_CACHE_BITS;

/// `VP8LHashPix`: the top `32 - shift` bits of the hash.
#[inline]
pub(crate) const fn hash_pix(argb: u32, shift: u32) -> u32 {
    argb.wrapping_mul(0x1e35_a7bd) >> shift
}

pub(crate) struct ColorCache {
    colors: Vec<u32>,
    hash_shift: u32,
}

impl ColorCache {
    pub(crate) fn new(cache_bits: u32) -> Result<Self> {
        debug_assert!((1..=MAX_CACHE_BITS).contains(&cache_bits));
        Ok(Self {
            colors: try_vec(0, 1 << cache_bits)?,
            hash_shift: 32 - cache_bits,
        })
    }

    #[inline]
    pub(crate) fn lookup(&self, key: u32) -> Checked<u32> {
        self.colors.at(key as usize)
    }

    #[inline]
    pub(crate) fn insert(&mut self, argb: u32) -> Checked {
        self.colors
            .put(hash_pix(argb, self.hash_shift) as usize, argb)
    }

    /// The key of `argb` if the cache holds it. If not, the cache takes it in.
    #[inline]
    pub(crate) fn hit_or_insert(&mut self, argb: u32) -> Checked<Option<u32>> {
        let key = hash_pix(argb, self.hash_shift);
        let color = self.colors.at_mut(key as usize)?;
        Ok((core::mem::replace(color, argb) == argb).then_some(key))
    }
}
