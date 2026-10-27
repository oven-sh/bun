//! `color_cache_utils.c`: the last colour seen for each value of a hash.

use crate::util::{Checked, OutOfMemory, SliceExt, try_vec};

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
    /// `hash_bits` is 1 to 11.
    pub(crate) fn new(hash_bits: u32) -> Result<Self, OutOfMemory> {
        debug_assert!((1..=11).contains(&hash_bits));
        Ok(Self {
            colors: try_vec(0, 1 << hash_bits)?,
            hash_shift: 32 - hash_bits,
        })
    }

    #[inline]
    pub(crate) fn lookup(&self, key: u32) -> Checked<u32> {
        self.colors.at(key as usize)
    }

    #[inline]
    pub(crate) fn set(&mut self, key: u32, argb: u32) -> Checked {
        self.colors.put(key as usize, argb)
    }

    #[inline]
    pub(crate) fn insert(&mut self, argb: u32) -> Checked {
        self.set(hash_pix(argb, self.hash_shift), argb)
    }

    /// The key of `argb` if the cache holds it.
    #[inline]
    pub(crate) fn contains(&self, argb: u32) -> Checked<Option<u32>> {
        let key = hash_pix(argb, self.hash_shift);
        Ok((self.lookup(key)? == argb).then_some(key))
    }
}
