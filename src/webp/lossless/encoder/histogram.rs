//! How often each symbol of the five alphabets occurs.

use core::ops::Range;

use super::cache;
use super::entropy::{self, Cost, Estimate, ONE_BIT};
use super::prefix::{self, Prefixed};
use crate::array::At;
use crate::lossless::{Argb, DISTANCE_CODES, LENGTH_CODES, LITERAL_CODES};
use crate::slice::InBounds;

/// Symbols for which a `u64` has a bit each.
pub(super) const BLOCK_LEN: usize = 64;

/// Not 0, so that all symbols have a neighbor on either side.
const RED: usize = BLOCK_LEN;
const BLUE: usize = RED + LITERAL_CODES;
const ALPHA: usize = BLUE + LITERAL_CODES;
pub(super) const DISTANCE: usize = ALPHA + LITERAL_CODES;
pub(super) const GREEN: usize = DISTANCE + DISTANCE_CODES.next_multiple_of(BLOCK_LEN);
pub(super) const LENGTH: usize = GREEN + LITERAL_CODES;
pub(super) const CACHE: usize = LENGTH + LENGTH_CODES;
pub(super) const BLOCKS: usize = (CACHE + (1 << cache::MAX_BITS)).div_ceil(BLOCK_LEN);

/// Something for each symbol. The alphabet whose size varies is last, so that nothing behind its end is ever touched.
pub(super) type BySymbol<T> = [T; BLOCKS * BLOCK_LEN];

/// Where it is in a `BySymbol`.
#[derive(Clone, Copy)]
pub(super) struct Alphabet {
    start: usize,
    pub(super) len: usize,
}

impl Alphabet {
    /// In the order of their codes in the file.
    pub(super) const fn all(cache_bits: u32) -> [Self; 5] {
        const fn new(start: usize, len: usize) -> Alphabet {
            Alphabet { start, len }
        }
        let cache_len = if cache_bits > 0 { 1 << cache_bits } else { 0 };
        [
            new(GREEN, LITERAL_CODES + LENGTH_CODES + cache_len),
            new(RED, LITERAL_CODES),
            new(BLUE, LITERAL_CODES),
            new(ALPHA, LITERAL_CODES),
            new(DISTANCE, DISTANCE_CODES),
        ]
    }

    pub(super) const fn symbols(self) -> Range<usize> {
        self.start..self.start + self.len
    }

    pub(super) const fn blocks(self) -> Range<usize> {
        self.start / BLOCK_LEN..(self.start + self.len).div_ceil(BLOCK_LEN)
    }
}

/// In the order they are stored in.
#[inline(always)]
pub(super) const fn literal_symbols(argb: Argb) -> [usize; 4] {
    let [blue, green, red, alpha] = argb.to_le_bytes();
    [
        GREEN + green as usize,
        RED + red as usize,
        BLUE + blue as usize,
        ALPHA + alpha as usize,
    ]
}

#[derive(Clone, Copy)]
pub(super) struct Histogram {
    pub(super) counts: BySymbol<u32>,
}

impl Histogram {
    pub(super) const EMPTY: Self = Self { counts: [0; _] };

    #[inline(always)]
    pub(super) fn add(&mut self, symbol: usize) {
        *self.counts.at_mut(symbol) += 1;
    }

    #[inline(always)]
    pub(super) fn add_literal(&mut self, argb: Argb) {
        for symbol in literal_symbols(argb) {
            self.add(symbol);
        }
    }

    #[inline(always)]
    pub(super) fn add_copy(&mut self, len: usize, distance: u32) {
        self.add(LENGTH + Prefixed::new(len as u32).symbol);
        self.add(DISTANCE + Prefixed::new(distance).symbol);
    }

    pub(super) fn blocks(&self, blocks: Range<usize>) -> &[[u32; BLOCK_LEN]] {
        self.counts.as_chunks().0.part(blocks)
    }

    fn get(&self, symbols: Range<usize>) -> &[u32] {
        self.counts.part(symbols)
    }

    pub(super) fn get_mut(&mut self, symbols: Range<usize>) -> &mut [u32] {
        self.counts.part_mut(symbols)
    }

    fn alphabet_cost(&self, alphabet: Alphabet) -> Cost {
        let blocks = self.blocks(alphabet.blocks()).iter();
        let blocks = blocks.map(|block| (entropy::non_zero(block), |i| *block.at(i)));
        Estimate::new(alphabet.len, blocks).cost(alphabet.len)
    }

    /// How many bits of lengths and distances are stored as they are.
    pub(super) fn extra_bits(&self) -> u64 {
        let of = |symbols| -> u64 {
            let counts = self.get(symbols).iter().enumerate();
            counts
                .map(|(symbol, &count)| u64::from(count) * u64::from(prefix::extra_len(symbol)))
                .sum()
        };
        of(LENGTH..CACHE) + of(DISTANCE..GREEN)
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L395
    pub(super) fn cost(&self, cache_bits: u32) -> Cost {
        let costs = Alphabet::all(cache_bits).map(|alphabet| self.alphabet_cost(alphabet));
        costs.iter().sum::<Cost>() + self.extra_bits() * ONE_BIT
    }
}
