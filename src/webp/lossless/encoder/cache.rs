//! Which pixels a color cache has by the time they come up, for all sizes of cache at once.

use core::hint::select_unpredictable;

use crate::array::At;
use crate::error::Result;
use crate::lossless::{Argb, color_cache_key};
use crate::vec;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.h#L28
pub(super) const MAX_BITS: u32 = 10;

/// `bits` is 1 to `MAX_BITS`.
#[inline(always)]
pub(super) const fn key(argb: Argb, bits: u32) -> usize {
    color_cache_key(argb, MAX_BITS) >> ((MAX_BITS - bits) % 16)
}

const HALF_BITS: u32 = MAX_BITS / 2;

/// A binary tree with a leaf for each number of `HALF_BITS`, and a bit for each of the other nodes that tells which of its
/// children was last gone through. The root is bit 1, the children of bit `i` are `2 * i` and `2 * i + 1`.
#[derive(Clone, Copy)]
struct Tree(u32);

/// The nodes on the way to each leaf, and those of them where it leads to the second child.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static PATHS: [(u32, u32); 1 << HALF_BITS] = {
    let mut paths = [(0, 0); _];
    let mut leaf = 0;
    while leaf < paths.len() {
        let mut child = 1 << HALF_BITS | leaf as u32;
        while child > 1 {
            paths[leaf].0 |= 1 << (child / 2);
            paths[leaf].1 |= (child % 2) << (child / 2);
            child /= 2;
        }
        leaf += 1;
    }
    paths
};

impl Tree {
    /// Returns the nodes where the way was another one the last time.
    #[inline(always)]
    fn go_to(&mut self, leaf: usize) -> u32 {
        let (nodes, turns) = *PATHS.at(leaf);
        let changed = (self.0 ^ turns) & nodes;
        self.0 ^= changed;
        changed
    }
}

/// For each pixel, the fewest bits with which it is in the cache, or `max_bits + 1`. Every pixel goes through the cache
/// however it is stored. A smaller cache has what the largest has if nothing whose key starts the same has come since.
pub(super) fn bits_needed(pixels: &[Argb], max_bits: u32) -> Result<Vec<u8>> {
    let mut needed = vec::filled(1, pixels.len())?;
    if max_bits == 0 {
        return Ok(needed);
    }
    let too_many = max_bits as u8 + 1;
    // By the last node that has changed, those for the low bits coming after those for the high bits.
    let by_node: [u8; 2 << HALF_BITS] = core::array::from_fn(|node| {
        let depth = (node as u32 % 32).max(1).ilog2() + node as u32 / 32 * HALF_BITS;
        too_many.min(depth as u8 + 1)
    });
    let mut largest = vec::array::<_, { 1 << MAX_BITS }>(0)?;
    let (mut by_high_bits, mut by_low_bits) = (Tree(0), [Tree(0); 1 << HALF_BITS]);
    let mut previous = 0;
    for (&pixel, needed) in pixels.iter().zip(&mut needed) {
        if pixel == previous {
            continue;
        }
        previous = pixel;
        let key = key(pixel, MAX_BITS);
        let (high, low) = (key >> HALF_BITS, key % (1 << HALF_BITS));
        let changed = u64::from(by_low_bits.at_mut(high).go_to(low)) << 32
            | u64::from(by_high_bits.go_to(high));
        let is_there = core::mem::replace(largest.at_mut(key), pixel) == pixel;
        let if_there = *by_node.at((changed | 1).ilog2() as usize);
        *needed = select_unpredictable(is_there, if_there, too_many);
    }
    Ok(needed)
}
